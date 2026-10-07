import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Gateway, GatewayError } from '../server/gateway';
import { Store } from '../server/store';
import { Actions } from '../server/actions';
import { Bots } from '../server/bots';
import { RemoteActions } from '../server/plugins/remoteActions';
import { BotBackend } from './bots-fixture';
import type { ActionEffects } from '../shared/bots';
const cleanups: (() => void)[] = [];
afterEach(() => { for (const close of cleanups.splice(0)) close(); });
function fixture() {
  const backend = new BotBackend(), store = new Store(':memory:'); store.bindProfiles('default');
  const gateway = new Gateway('', '', [], () => store.contexts().flatMap(c => c.aliases)); gateway.online = true; gateway.epoch = 'fixture-epoch';
  gateway.connect = async () => {}; (gateway as any).request = backend.rpc.bind(backend); gateway.http = backend.http.bind(backend);
  gateway.botChats = (profile, id) => store.contexts().some(c => c.botChat && c.profile === profile && c.aliases.includes(id));
  const actions = new Actions(store, gateway, '/tmp'), bots = new Bots(store, gateway, actions), remote = new RemoteActions(store);
  cleanups.push(() => { remote.close(); actions.close(); gateway.close(); store.close(); });
  const effects = (): ActionEffects => ({ id: randomUUID(), check() {}, effect: (_, fn) => fn() });
  return { backend, store, gateway, actions, bots, remote, effects };
}
const settle = async (f: () => boolean) => { for (let n = 0; n < 100 && !f(); n++) await new Promise(r => setTimeout(r, 5)); expect(f()).toBe(true); };
describe('Bots integration', () => {
  it('keeps recovery history identifiable without copying private form content or burying it under successful opens', async () => {
    const f = fixture(), id = randomUUID();
    f.remote.start('bots', { id, generation: 0, command: 'routine', input: { profile: 'research', id: 'daily', action: 'run', prompt: 'private instructions', soul: 'private persona' } }, () => {}, async () => { throw new GatewayError('Unconfirmed run', true); });
    await settle(() => f.remote.get('bots', id)?.state === 'unknown');
    for (let n = 0; n < 35; n++) {
      const open = randomUUID(); f.remote.start('bots', { id: open, generation: 0, command: 'open', input: { name: 'research' } }, () => {}, async () => undefined);
      await settle(() => f.remote.get('bots', open)?.state === 'finished');
    }
    const history = f.remote.list('bots');
    expect(history[0].id).toBe(id);
    expect(history[0].subject).toEqual({ profile: 'research', routineId: 'daily', operation: 'run' });
    expect(JSON.stringify(history)).not.toContain('private instructions');
    expect(JSON.stringify(history)).not.toContain('private persona');
  });
  it('stamps legacy conversation bindings without changing their IDs or references', () => {
    const store = new Store(':memory:'), id = randomUUID();
    try {
      store.saveContext({ id, title: 'Existing', link: { key: 'same-id', storedId: 'same-id', title: 'Existing', source: 'desktop' }, aliases: ['same-id'] });
      store.saveBinding(id, { runtimeId: 'runtime', storedId: 'same-id', epoch: 'epoch', generation: 'generation', seq: 1, monitored: true, known: true, ready: true });
      store.bindProfiles('personal'); store.bindProfiles('personal');
      expect(store.context(id)).toMatchObject({ id, profile: 'personal', aliases: ['same-id'], link: { profile: 'personal', storedId: 'same-id' } });
      expect(store.binding(id)).toMatchObject({ profile: 'personal', runtimeId: 'runtime', generation: 'generation' });
      expect(store.db.pragma('user_version', { simple: true })).toBe(7);
    } finally { store.close(); }
  });
  it('refreshes from backend changes and releases its subscriptions', () => {
    const f = fixture(); let calls = 0;
    const dispose = f.bots.onChange(() => { calls++; });
    f.gateway.emit('event', { type: 'sessions.changed' }); f.gateway.emit('connected');
    f.gateway.emit('event', { type: 'message.delta' }); expect(calls).toBe(2);
    dispose(); f.gateway.emit('event', { type: 'sessions.changed' }); expect(calls).toBe(2);
  });
  it('registers an existing profile for Bot Mode without sending a prompt', async () => {
    const f = fixture(); f.backend.profiles.get('research').ui_meta = {};
    await f.bots.openBot('research', f.effects());
    expect(f.backend.calls.find(c => c.method === 'profiles.configure')?.params.ui_meta).toEqual({ 'hermes-bots': { title: 'research' } });
    expect(f.backend.calls.some(c => c.method === 'prompt.submit')).toBe(false);
  });
  it('fails closed on unsupported, ambiguous and excluded canonical identities', async () => {
    const f = fixture(); const rpc = f.backend.rpc.bind(f.backend);
    (f.gateway as any).request = async (method: string, params: any) => method === 'profiles.list' ? { profiles: [] } : rpc(method, params);
    await expect(f.bots.openBot('research', f.effects())).rejects.toThrow('Update Hermes');
    (f.gateway as any).request = async (method: string, params: any) => { const r = await rpc(method, params); return method === 'session.list' ? { sessions: [...r.sessions, ...r.sessions] } : r; };
    await expect(f.bots.openBot('research', f.effects())).rejects.toThrow('ambiguous');
    (f.gateway as any).request = rpc;
    const c = await f.bots.openBot('research', f.effects()); (f.gateway as any).excluded = ['bot-chat'];
    await expect(f.gateway.history(c.link!.storedId, 0)).rejects.toThrow('ownership');
    (f.gateway as any).excluded = []; f.backend.chats.get('research').source = 'worker';
    await expect(f.bots.openBot('research', f.effects())).rejects.toThrow('source');
    await expect(f.gateway.history(c.link!.storedId, 0)).rejects.toThrow('ownership');
    expect(f.backend.calls.some(c => c.method === 'session.create' || c.method === 'prompt.submit')).toBe(false);
  });
  it('opens the existing hidden canonical chats without prompts and isolates identical IDs across profiles', async () => {
    const f = fixture();
    const a = await f.bots.openBot('default', f.effects()), b = await f.bots.openBot('research', f.effects());
    expect(a.id).not.toBe(b.id); expect(a.link!.storedId).not.toBe(b.link!.storedId);
    expect((await f.gateway.history(a.link!.storedId, 0)).messages[0].content).toBe('Hello from default.');
    expect((await f.gateway.history(b.link!.storedId, 0)).messages[0].content).toBe('Hello from research.');
    expect((await f.gateway.history(a.link!.storedId, 0)).messages[0].content).toBe('Hello from default.');
    expect(f.backend.calls.some(c => c.method === 'prompt.submit')).toBe(false);
    expect(f.gateway.profile).toBe('default');
  });
  it('recognises a retained canonical chat even if Hermes lists it as visible', async () => {
    const f = fixture(), c = await f.bots.openBot('research', f.effects());
    f.backend.chats.get('research').hidden = false;
    expect((await f.gateway.conversation(c.link!.storedId)).botChat).toBe(true);
  });
  it('routes simultaneous sends, settings and recovery to each owning profile', async () => {
    const f = fixture();
    const contexts = await Promise.all(['default', 'research'].map(p => f.bots.openBot(p, f.effects())));
    for (const c of contexts) f.actions.start({ id: randomUUID(), contextId: c.id, kind: 'send', text: `For ${c.profile}` });
    await settle(() => f.backend.calls.filter(c => c.method === 'prompt.submit').length === 2);
    await settle(() => f.actions.dispatching.size === 0);
    for (const c of contexts) {
      expect(f.backend.chats.get(c.profile!).messages.some((m: any) => m.content === `For ${c.profile}`)).toBe(true);
      expect(f.store.binding(c.id)?.profile).toBe(c.profile);
      expect((await f.actions.settings.view(c.id)).available).toBe(true);
      await f.actions.reconcile(c.id);
    }
  });
  it('keeps approval and stop controls attached to the selected bot runtime', async () => {
    const f = fixture(), contexts = await Promise.all(['default', 'research'].map(p => f.bots.openBot(p, f.effects())));
    for (const c of contexts) f.actions.start({ id: randomUUID(), contextId: c.id, kind: 'send', text: `For ${c.profile}` });
    await settle(() => f.backend.calls.filter(c => c.method === 'prompt.submit').length === 2 && f.actions.dispatching.size === 0);
    const rpc = f.backend.rpc.bind(f.backend); let approved = false;
    (f.gateway as any).request = async (method: string, params: any) => {
      if (method === 'approval.pending') return { approvals: !approved && params.session_id === 'bot-runtime:research' ? [{ request_id: 'consent', description: 'Synthetic approval' }] : [] };
      if (method === 'approval.respond') { f.backend.calls.push({ method, params }); approved = true; return { resolved: 1 }; }
      return rpc(method, params);
    };
    await f.actions.reconcile(contexts[1].id);
    const main = f.actions.main(contexts[1].id)!, binding = f.store.binding(contexts[1].id)!;
    expect(main.state).toBe('awaiting_input');
    const decision = f.actions.start({ id: randomUUID(), contextId: contexts[1].id, kind: 'approve', targetId: main.id, generation: binding.generation, approvalId: 'consent' });
    await settle(() => f.store.action(decision.id)?.receipt === 'accepted');
    await settle(() => f.actions.dispatching.size === 0);
    const stop = f.actions.start({ id: randomUUID(), contextId: contexts[1].id, kind: 'stop', targetId: main.id, generation: binding.generation });
    await settle(() => f.store.action(stop.id)?.receipt === 'accepted');
    await settle(() => f.actions.dispatching.size === 0);
    expect(f.backend.calls.filter(c => ['approval.respond', 'session.interrupt'].includes(c.method)).map(c => c.params.session_id)).toEqual(['bot-runtime:research', 'bot-runtime:research']);
    expect(f.store.actions(contexts[0].id)).toHaveLength(1);
  });
  it('adopts a compacted canonical chat and never replaces a previously known missing chat', async () => {
    const f = fixture(), c = await f.bots.openBot('research', f.effects());
    f.backend.chats.get('research').id = 'bot-tip'; f.backend.chats.get('research')._lineage_ids.push('bot-tip');
    const moved = await f.bots.openBot('research', f.effects()); expect(moved.id).toBe(c.id); expect(moved.link!.storedId).toContain('bot-tip');
    Object.assign(f.backend.chats.get('research'), { id: 'unrelated', _lineage_ids: ['unrelated'] });
    await expect(f.bots.openBot('research', f.effects())).rejects.toThrow('identity changed');
    expect(f.store.context(c.id)?.link?.storedId).toBe(moved.link!.storedId);
    f.backend.chats.delete('research');
    await expect(f.bots.openBot('research', f.effects())).rejects.toThrow('no replacement');
    expect(f.backend.calls.filter(c => c.method === 'session.create')).toHaveLength(0);
  });
  it('creates one bot and introduction despite duplicate operation submissions', async () => {
    const f = fixture(), input = { id: randomUUID(), generation: 0, command: 'create', input: { name: 'writer', title: 'Writer', description: 'Writes', mirrorCredentials: false } };
    const run = (effects: ActionEffects) => f.bots.createBot(input.input, effects);
    f.remote.start('bots', input, () => {}, run); f.remote.start('bots', input, () => {}, run);
    await settle(() => f.remote.get('bots', input.id)?.state !== 'pending');
    expect(f.remote.get('bots', input.id)?.state).toBe('finished');
    await settle(() => f.actions.dispatching.size === 0);
    expect(f.backend.calls.filter(c => c.method === 'profiles.create')).toHaveLength(1);
    expect(f.backend.calls.filter(c => c.method === 'prompt.submit')).toHaveLength(1);
    await f.bots.openBot('writer', f.effects()); expect(f.backend.calls.filter(c => c.method === 'prompt.submit')).toHaveLength(1);
  });
  it('does not repeat an unconfirmed empty-chat creation when navigation opens the bot again', async () => {
    const f = fixture(); f.backend.chats.delete('research');
    const rpc = f.backend.rpc.bind(f.backend); let attempts = 0;
    (f.gateway as any).request = async (method: string, params: any) => {
      if (method === 'session.create') { attempts++; throw new GatewayError('Reply lost', true); }
      return rpc(method, params);
    };
    await expect(f.bots.openBot('research', f.effects())).rejects.toThrow('Reply lost');
    await expect(f.bots.openBot('research', f.effects())).rejects.toThrow('No creation was repeated');
    expect(attempts).toBe(1);
    // Desktop can establish the canonical row, which is then adopted normally.
    f.backend.chats.set('research', new BotBackend().chats.get('research'));
    expect((await f.bots.openBot('research', f.effects())).profile).toBe('research');
    expect(attempts).toBe(1);
  });
  it('preserves uncertain effects and rejects reused operation IDs, including after restart', async () => {
    const f = fixture(), input = { id: randomUUID(), generation: 0, command: 'routine', input: { action: 'run' } }; let count = 0;
    f.remote.start('bots', input, () => {}, e => e.effect('run', async () => { count++; throw new GatewayError('Reply lost', true); }));
    await settle(() => f.remote.get('bots', input.id)?.state === 'unknown');
    const restarted = new RemoteActions(f.store);
    restarted.start('bots', input, () => {}, async () => { count++; }); expect(count).toBe(1);
    expect(() => restarted.start('bots', { ...input, input: {} }, () => {}, async () => {})).toThrow('reused');
  });
  it('stops later effects after disable/reset while retaining the dispatched receipt', async () => {
    const f = fixture(); let active = true, finish!: () => void, second = false;
    const input = { id: randomUUID(), generation: 0, command: 'create', input: {} };
    f.remote.start('bots', input, () => { if (!active) throw new Error('Paused'); }, async e => {
      await e.effect('first', () => new Promise<void>(resolve => { finish = resolve; }));
      await e.effect('second', async () => { second = true; });
    });
    await settle(() => !!finish); active = false; finish();
    await settle(() => f.remote.get('bots', input.id)?.state !== 'pending'); expect(second).toBe(false);
    expect(f.store.db.prepare('SELECT * FROM plugin_remote_steps WHERE action_id=?').all(input.id)).toHaveLength(1);
  });
  it('scopes routine edits and runs and does not mutate anything while listing', async () => {
    const f = fixture();
    const before = structuredClone(f.backend.jobs.get('default'));
    const listed = await f.bots.routines('research'); expect(listed.timezone).toBe('Europe/London'); expect(JSON.stringify(listed)).not.toContain('must-not-reach-browser');
    await f.bots.changeRoutine('update', { profile: 'research', id: 'daily', expectedRevision:listed.jobs[0].revision, name: 'New title', prompt: 'New instructions', schedule: '0 10 * * *' }, f.effects());
    expect(f.backend.jobs.get('default')).toEqual(before); expect(f.backend.jobs.get('research')![0].deliver).toBe('bot-chat');
    await f.bots.changeRoutine('pause', { profile: 'research', id: 'daily' }, f.effects());
    await f.bots.changeRoutine('run', { profile: 'research', id: 'daily' }, f.effects());
    expect(f.backend.jobs.get('research')![0].enabled).toBe(true);
    expect((await f.bots.routineRuns('research', 'daily'))[0].preview).toBe('A useful briefing.');
    await expect(f.bots.changeRoutine('remove', { profile: 'research', id: 'missing' }, f.effects())).rejects.toThrow('no longer');
  });
  it('does not overwrite concurrent Desktop metadata and reports partial configuration', async () => {
    const f = fixture(), detail = await f.bots.describeBot('research');
    f.backend.profiles.get('research').ui_meta_revisions['hermes-bots']++;
    await expect(f.bots.configureBot({ name: 'research', title: 'Changed', description: '', revision: detail.revision }, f.effects())).rejects.toThrow('changed');
    expect(f.backend.calls.filter(c => c.method === 'profiles.configure')).toHaveLength(0);
  });
  it('rejects stale routine edits and serializes concurrent Herts updates', async()=>{
    const f=fixture(),original=(await f.bots.routines('research')).jobs[0];
    const input={profile:'research',id:'daily',name:'Changed name',prompt:original.prompt,schedule:original.schedule,expectedRevision:original.revision};
    const results=await Promise.allSettled([f.bots.changeRoutine('update',input,f.effects()),f.bots.changeRoutine('update',{...input,name:'Stale name'},f.effects())]);
    expect(results.map(r=>r.status)).toEqual(['fulfilled','rejected']);
    const writes=f.backend.calls.filter(c=>c.method==='PUT /api/cron/jobs/daily');
    expect(writes).toHaveLength(1);expect(writes[0].params.body.updates).toEqual({name:'Changed name'});
    const current=f.backend.jobs.get('research')![0];current.prompt='Changed on Desktop';current.deliver='local';
    await expect(f.bots.changeRoutine('update',input,f.effects())).rejects.toThrow('changed in Hermes');
    expect(current.prompt).toBe('Changed on Desktop');expect(current.deliver).toBe('local');
  });
  it('filters action history before pagination and pins unreviewed outcomes',async()=>{
    const f=fixture(),unknown=randomUUID();
    f.remote.start('bots',{id:unknown,generation:0,command:'routine',input:{profile:'research',id:'daily',name:'Research briefing',action:'run'}},()=>{},async()=>{throw new GatewayError('Unknown',true);});
    await settle(()=>f.remote.get('bots',unknown)?.state==='unknown');
    for(let n=0;n<70;n++){const id=randomUUID();f.remote.start('bots',{id,generation:0,command:'configure',input:{name:n%2?'default':'research',hidden:true}},()=>{},async()=>{});await settle(()=>f.remote.get('bots',id)?.state==='finished');}
    const first=f.remote.list('bots','research'),next=f.remote.list('bots','research',30);
    expect(first).toHaveLength(31);expect(next).toHaveLength(6);expect(first[0].id).toBe(unknown);expect(next[0].id).toBe(unknown);
    expect(first.every(r=>r.subject?.profile==='research')).toBe(true);expect(first[1].subject?.operation).toBe('hide');
    f.remote.review('bots',unknown);expect(f.remote.get('bots',unknown)).toMatchObject({state:'unknown',reviewedAt:expect.any(Number)});
    expect(f.remote.list('bots','research').some(r=>r.id===unknown)).toBe(false);
    expect(f.remote.list('bots','research',30).some(r=>r.id===unknown)).toBe(true);
  });
  it('reads aloud only an assistant message verified in this routine and profile',async()=>{
    const f=fixture();await f.bots.routineSpeech('research','daily','run-1',0,0);
    expect(f.backend.calls.find(c=>c.method==='POST /api/audio/speak')?.params).toEqual({profile:'research',body:{text:'Hello from research.'}});
    await expect(f.bots.routineSpeech('research','daily','other-run',0,0)).rejects.toThrow('not in');
    await expect(f.bots.routineSpeech('research','daily','run-1',0,99)).rejects.toThrow('no longer');
  });

});
