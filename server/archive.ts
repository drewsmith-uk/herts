import { hasSavedMessage, type Action } from '../shared/core.js';
import type { Store } from './store.js';

const minimumAge = 30 * 86400000;
interface Candidate { id: string; updated_at: number }
export class ActionArchive {
  private after?: Candidate;
  private timer?: NodeJS.Timeout;
  readonly stats = { batches: 0, moved: 0, failures: 0, retained: {} as Record<string, number> };
  constructor(private store: Store) {
    const db = store.db;
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS archived_actions (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, data TEXT NOT NULL, archived_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS archived_actions_context ON archived_actions(task_id);
        CREATE TABLE IF NOT EXISTS action_uploads (action_id TEXT NOT NULL, upload_id TEXT NOT NULL, PRIMARY KEY(action_id,upload_id));
        CREATE INDEX IF NOT EXISTS action_uploads_upload ON action_uploads(upload_id);
        CREATE INDEX IF NOT EXISTS actions_archive_candidates ON actions(json_extract(data,'$.updatedAt'),id)
          WHERE json_extract(data,'$.state')='finished' AND json_extract(data,'$.receipt')='accepted';
      `);
      if (Number(db.pragma('user_version', { simple: true })) < 10) {
        db.exec(`INSERT OR IGNORE INTO action_uploads SELECT a.id,u.value FROM actions a,json_each(a.data,'$.uploadIds') u;
          INSERT OR IGNORE INTO action_uploads SELECT a.id,u.value FROM archived_actions a,json_each(a.data,'$.uploadIds') u;`);
        db.pragma('user_version = 10');
      }
    })();
  }
  hasContext(contextId: string) {
    return !!this.store.db.prepare('SELECT 1 FROM archived_actions WHERE task_id=? LIMIT 1').get(contextId);
  }
  private reason(action: Action, now: number, busy: (contextId: string) => boolean): string | undefined {
    if (action.state !== 'finished' || action.receipt !== 'accepted') return 'unfinished';
    if (action.updatedAt > now - minimumAge) return 'recent';
    const summary = this.store.activity.summary(action.taskId);
    if (action.id === summary.main?.id || action.id === summary.latestSend?.id) return 'current';
    if (hasSavedMessage(action)) return 'saved-message';
    if (action.settings?.inFlight || action.settings?.confirmation && !action.settings.confirmedModel) return 'settings';
    if (this.store.binding(action.taskId)?.recoveryPending || busy(action.taskId)) return 'recovery-or-dispatch';
    if (this.store.db.prepare('SELECT 1 FROM action_index WHERE target_id=? AND recovery=1 LIMIT 1').get(action.id)) return 'dependent-control';
    return undefined;
  }
  batch(now = Date.now(), busy: (contextId: string) => boolean = () => false) {
    const db = this.store.db;
    const rows = db.prepare(`SELECT id,json_extract(data,'$.updatedAt') updated_at FROM actions
      WHERE json_extract(data,'$.state')='finished' AND json_extract(data,'$.receipt')='accepted'
      AND json_extract(data,'$.updatedAt')<=? AND (json_extract(data,'$.updatedAt'),id)>(?,?)
      ORDER BY json_extract(data,'$.updatedAt'),id LIMIT 100`)
      .all(now - minimumAge, this.after?.updated_at ?? -1, this.after?.id || '') as Candidate[];
    const result = this.store.atomic(() => {
      let moved = 0;
      const retained: Record<string, number> = {};
      for (const row of rows) {
        const record = db.prepare('SELECT data FROM actions WHERE id=?').get(row.id) as { data: string } | undefined;
        if (!record) continue;
        const action: Action = JSON.parse(record.data), reason = this.reason(action, now, busy);
        if (reason) { retained[reason] = (retained[reason] || 0) + 1; continue; }
        db.prepare('INSERT INTO archived_actions VALUES (?,?,?,?)').run(action.id, action.taskId, record.data, now);
        db.prepare('DELETE FROM actions WHERE id=?').run(action.id);
        db.prepare('UPDATE action_index SET main=0,send=0,recovery=0,saved=0,target_id=NULL WHERE id=?').run(action.id);
        this.store.activity.changed(action.taskId, [action.id]);
        moved++;
      }
      if (moved) this.store.emit('change', { type: 'activity' });
      return { scanned: rows.length, moved, retained, more: rows.length === 100 };
    });
    this.after = result.more ? rows.at(-1) : undefined;
    this.stats.batches++; this.stats.moved += result.moved;
    for (const [reason, count] of Object.entries(result.retained)) this.stats.retained[reason] = (this.stats.retained[reason] || 0) + count;
    return result;
  }
  start(busy: (contextId: string) => boolean) {
    if (this.timer) return;
    const run = () => {
      let more = false;
      try { more = this.batch(Date.now(), busy).more; }
      catch { this.stats.failures++; }
      this.timer = setTimeout(run, more ? 100 : 3600000); this.timer.unref();
    };
    this.timer = setTimeout(run, 60000); this.timer.unref();
  }
  close() { clearTimeout(this.timer); this.timer = undefined; }
}
