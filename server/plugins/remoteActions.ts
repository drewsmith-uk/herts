import { GatewayError } from '../gateway.js';
import { digest, type Store } from '../store.js';
import type { ActionEffects, RemoteAction } from '../../shared/bots.js';
import { Conflict } from '../../shared/core.js';

/** Deliberate online actions, outside the offline command queue and reset generations. */
export class RemoteActions {
  private closed = false;
  close() { this.closed = true; }
  constructor(private store: Store) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS plugin_remote_actions (id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL, hash TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS plugin_remote_steps (action_id TEXT NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(action_id,name));`);
    for (const row of store.db.prepare('SELECT data FROM plugin_remote_actions').all() as { data: string }[]) {
      const action: RemoteAction = JSON.parse(row.data);
      if (action.state === 'pending') this.save({ ...action, state: 'unknown', error: 'Herts restarted before this action was confirmed. Refresh Hermes state before taking another action.' });
    }
  }
  get(pluginId: string, id: string): RemoteAction | undefined {
    const row = this.store.db.prepare('SELECT data FROM plugin_remote_actions WHERE id=? AND plugin_id=?').get(id, pluginId) as { data: string } | undefined;
    return row && JSON.parse(row.data);
  }
  list(pluginId: string, profile?:string, offset=0) {
    const rows=(this.store.db.prepare("SELECT data FROM plugin_remote_actions WHERE plugin_id=? ORDER BY rowid DESC").all(pluginId) as {data:string}[]).map(row=>JSON.parse(row.data) as RemoteAction);
    const relevant=rows.filter(a=>(!profile || a.subject?.profile===profile || !a.subject) && !(pluginId==='bots' && a.command==='open' && a.state==='finished'));
    // Unresolved actions remain visible regardless of the completed-history page.
    return [...relevant.filter(a=>a.state==='pending'||a.state==='unknown'&&!a.reviewedAt),...relevant.filter(a=>a.state!=='pending'&&(a.state!=='unknown'||a.reviewedAt)).slice(offset,offset+30)];
  }
  review(pluginId:string,id:string){const action=this.get(pluginId,id);if(!action)throw new Conflict('Action not found.');if(action.state!=='unknown')throw new Conflict('Only unconfirmed actions need review.');const reviewed={...action,reviewedAt:Date.now()};this.save(reviewed);return reviewed;}
  private save(action: RemoteAction) { if (this.closed) return; this.store.db.prepare('UPDATE plugin_remote_actions SET data=? WHERE id=?').run(JSON.stringify(action), action.id); this.store.emit('change', { type: 'plugin-action' }); }
  start(pluginId: string, input: { id: string; generation: number; command: string; input: unknown }, check: () => void, run: (effects: ActionEffects) => Promise<unknown>): RemoteAction {
    const hash = digest({ pluginId, ...input });
    const prior = this.store.db.prepare('SELECT hash,data FROM plugin_remote_actions WHERE id=?').get(input.id) as { hash: string; data: string } | undefined;
    if (prior) { if (prior.hash !== hash) throw new Conflict('An operation ID cannot be reused for different content.'); return JSON.parse(prior.data); }
    check();
    const action: RemoteAction = { id: input.id, pluginId, command: input.command, state: 'pending', createdAt: Date.now() };
    // Recovery labels contain identifiers only, never the submitted persona or instructions.
    const value = input.input as Record<string, unknown> | null;
    if (pluginId === 'bots' && value && typeof value === 'object') {
      const profile = input.command === 'routine' ? value.profile : value.name;
      if (typeof profile === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(profile)) action.subject = {
        profile,
        ...(input.command==='configure' && typeof value.hidden==='boolean'?{operation:value.hidden?'hide':'unhide'}:{}),
        ...(input.command === 'routine' && typeof value.id === 'string' ? { routineId: value.id.slice(0, 200) } : {}),
        ...(input.command === 'routine' && typeof value.action === 'string' && ['create', 'update', 'pause', 'resume', 'remove', 'run'].includes(value.action) ? { operation: value.action } : {}),
        ...(typeof value.title === 'string' ? { title: value.title.slice(0, 100) } : input.command === 'routine' && typeof value.name === 'string' ? { title: value.name.slice(0, 200) } : {}),
      };
    }
    this.store.db.prepare('INSERT INTO plugin_remote_actions VALUES (?,?,?,?)').run(input.id, pluginId, hash, JSON.stringify(action));

    const effects: ActionEffects = { id: input.id, check, effect: async (name, fn) => {
      if (this.closed) throw new GatewayError('Herts is stopping; check the action after restarting.', true);
      check();
      const old = this.store.db.prepare('SELECT data FROM plugin_remote_steps WHERE action_id=? AND name=?').get(input.id, name) as { data: string } | undefined;
      if (old) { const value = JSON.parse(old.data); if (value.state === 'finished') return value.result; throw new GatewayError('This remote step is unconfirmed and will not be repeated.', true); }
      this.store.db.prepare('INSERT INTO plugin_remote_steps VALUES (?,?,?)').run(input.id, name, JSON.stringify({ state: 'pending' }));
      const result = await fn();
      if (this.closed) throw new GatewayError('Herts stopped before this step was confirmed.', true);
      this.store.db.prepare('UPDATE plugin_remote_steps SET data=? WHERE action_id=? AND name=?').run(JSON.stringify({ state: 'finished', result }), input.id, name);
      return result;
    } };
    void Promise.resolve().then(() => run(effects)).then(result => {const id=(result as any)?.id;if(action.command==='routine'&&action.subject?.operation==='create'&&typeof id==='string')action.subject.routineId=id;this.save({ ...action, state: 'finished', result });}).catch(error => {
      if (this.closed) return;
      const unfinished = this.store.db.prepare("SELECT 1 FROM plugin_remote_steps WHERE action_id=? AND json_extract(data,'$.state')='pending'").get(input.id);
      const uncertain = error instanceof GatewayError ? error.uncertain : !!unfinished;
      this.save({ ...action, state: uncertain ? 'unknown' : 'failed', error: error instanceof Error ? error.message : 'The action could not be confirmed.' });
    });
    return action;
  }
}
