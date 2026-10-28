import { randomUUID } from 'node:crypto';
import type { Store } from './store.js';
import { hasSavedMessage, type Action } from '../shared/core.js';
import { retainRecoveryDetail, type ActionSummary, type ActivitySummary, type ActivityPage, type ActivityDetails } from '../shared/activity.js';

interface IndexedAction { id: string; context_id: string; ordinal: number; recovery: number; target_id: string | null; data: string }
interface Cursor { generation: string; mode: 'snapshot' | 'delta' | 'details'; sequence: number; after?: string; context?: string }
export class ActivityCursorExpired extends Error {
  statusCode = 409;
  constructor() { super('Activity changed. Start a new activity sync.'); }
}
const brief = (action: Action): ActionSummary => ({ id: action.id, kind: action.kind, state: action.state,
  receipt: action.receipt, phase: action.phase, createdAt: action.createdAt, updatedAt: action.updatedAt });

export class ActionActivity {
  readonly generation = randomUUID();
  constructor(private store: Store) {
    const db = store.db;
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS action_index (
          id TEXT PRIMARY KEY, context_id TEXT NOT NULL, ordinal INTEGER NOT NULL UNIQUE,
          main INTEGER NOT NULL, send INTEGER NOT NULL, recovery INTEGER NOT NULL, saved INTEGER NOT NULL,
          target_id TEXT, updated_at INTEGER NOT NULL, data TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS action_index_context ON action_index(context_id, ordinal DESC);
        CREATE INDEX IF NOT EXISTS action_index_main ON action_index(context_id, ordinal DESC) WHERE main=1;
        CREATE INDEX IF NOT EXISTS action_index_send ON action_index(context_id, ordinal DESC) WHERE send=1;
        CREATE INDEX IF NOT EXISTS action_index_recovery ON action_index(context_id, ordinal DESC) WHERE recovery=1;
        CREATE INDEX IF NOT EXISTS action_index_target ON action_index(target_id, ordinal DESC);
        CREATE TABLE IF NOT EXISTS activity_summaries (context_id TEXT PRIMARY KEY, sequence INTEGER NOT NULL, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS activity_changes (sequence INTEGER PRIMARY KEY, context_id TEXT NOT NULL, at INTEGER NOT NULL, data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS activity_changes_time ON activity_changes(at);
      `);
      if (!store.getMeta('activity-index-ready')) {
        let after = 0;
        for (;;) {
          const rows = db.prepare('SELECT rowid, data FROM actions WHERE rowid>? ORDER BY rowid LIMIT 1000').all(after) as { rowid: number; data: string }[];
          if (!rows.length) break;
          for (const row of rows) this.index(JSON.parse(row.data));
          after = rows.at(-1)!.rowid;
        }
        const ids = db.prepare('SELECT id FROM contexts UNION SELECT task_id AS id FROM bindings UNION SELECT context_id AS id FROM action_index').all() as { id: string }[];
        for (const { id } of ids) this.changed(id);
        store.setMeta('activity-index-ready', true);
      }
      if (Number(db.pragma('user_version', { simple: true })) < 9) db.pragma('user_version = 9');
    })();
  }
  private index(action: Action) {
    const db = this.store.db;
    const prior = db.prepare('SELECT ordinal FROM action_index WHERE id=?').get(action.id) as { ordinal: number } | undefined;
    const ordinal = prior?.ordinal ?? (this.store.getMeta<number>('action-ordinal') || 0) + 1;
    if (!prior) this.store.setMeta('action-ordinal', ordinal);
    db.prepare(`INSERT INTO action_index VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      context_id=excluded.context_id, main=excluded.main, send=excluded.send, recovery=excluded.recovery,
      saved=excluded.saved, target_id=excluded.target_id, updated_at=excluded.updated_at, data=excluded.data`).run(
      action.id, action.taskId, ordinal, Number(!action.cancelled && ['send', 'continue'].includes(action.kind)),
      Number(action.kind === 'send'), Number(retainRecoveryDetail(action)), Number(hasSavedMessage(action)),
      action.targetId || null, action.updatedAt, JSON.stringify(brief(action)));
  }
  head() { return this.store.getMeta<number>('activity-sequence') || 0; }
  summary(contextId: string): ActivitySummary {
    const row = this.store.db.prepare('SELECT data FROM activity_summaries WHERE context_id=?').get(contextId) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : { contextId, version: 0, hasSubmission: false, recoveryCount: 0, pendingRecovery: false };
  }
  main(contextId: string) { const id = this.summary(contextId).main?.id; return id ? this.store.action(id) : undefined; }
  recordAction(action: Action) {
    const prior = this.summary(action.taskId);
    this.index(action);
    this.changed(action.taskId, [action.id, prior.main?.id, prior.latestSend?.id].filter((id): id is string => !!id));
  }
  changed(contextId: string, candidates: string[] = []) {
    const db = this.store.db;
    const select = (column: 'main' | 'send') => {
      const row = db.prepare(`SELECT data FROM action_index WHERE context_id=? AND ${column}=1 ORDER BY ordinal DESC LIMIT 1`).get(contextId) as { data: string } | undefined;
      return row ? JSON.parse(row.data) as ActionSummary : undefined;
    };
    const main = select('main'), latestSend = select('send');
    const recovery = db.prepare('SELECT count(*) AS count FROM action_index WHERE context_id=? AND recovery=1').get(contextId) as { count: number };
    const version = this.head() + 1;
    const summary: ActivitySummary = { contextId, version, main, latestSend, hasSubmission: !!main,
      recoveryCount: recovery.count, pendingRecovery: !!this.store.binding(contextId)?.recoveryPending };
    const retired = [...new Set(candidates)].filter(id => {
      if (id === main?.id || id === latestSend?.id) return false;
      const row = db.prepare('SELECT recovery, target_id FROM action_index WHERE id=?').get(id) as IndexedAction | undefined;
      return row && !row.recovery && (!row.target_id || row.target_id !== main?.id);
    });
    this.store.setMeta('activity-sequence', version);
    db.prepare('INSERT INTO activity_summaries VALUES (?,?,?) ON CONFLICT(context_id) DO UPDATE SET sequence=excluded.sequence,data=excluded.data')
      .run(contextId, version, JSON.stringify(summary));
    db.prepare('INSERT INTO activity_changes VALUES (?,?,?,?)').run(version, contextId, Date.now(), JSON.stringify({ summary, retired }));
    this.prune();
  }
  private prune() {
    this.store.db.prepare('DELETE FROM activity_changes WHERE sequence<=? OR at<?').run(this.head() - 10000, Date.now() - 7 * 86400000);
  }
  private token(cursor: Omit<Cursor, 'generation'>) { return Buffer.from(JSON.stringify({ ...cursor, generation: this.generation })).toString('base64url'); }
  private parse(token: string): Cursor {
    try {
      if (token.length > 2048) throw new Error();
      const value = JSON.parse(Buffer.from(token, 'base64url').toString());
      if (value.generation !== this.generation || !Number.isSafeInteger(value.sequence) || value.sequence < 0 || value.sequence > this.head()
        || !['snapshot', 'delta', 'details'].includes(value.mode) || (value.after !== undefined && typeof value.after !== 'string')) throw new Error();
      return value;
    } catch { throw new ActivityCursorExpired(); }
  }
  sync(token?: string, requested = 100): ActivityPage {
    const limit = Math.max(1, Math.min(200, Math.trunc(requested) || 100));
    return this.store.db.transaction(() => {
      this.prune();
      const cursor: Cursor = token ? this.parse(token) : { generation: this.generation, mode: 'snapshot', sequence: this.head(), after: '' };
      const oldest = this.store.db.prepare('SELECT min(sequence) AS sequence FROM activity_changes').get() as { sequence: number | null };
      if (cursor.mode === 'details' || cursor.sequence < (oldest.sequence === null ? this.head() : oldest.sequence - 1)) throw new ActivityCursorExpired();
      if (cursor.mode === 'snapshot') {
        const rows = this.store.db.prepare('SELECT context_id, data FROM activity_summaries WHERE context_id>? ORDER BY context_id LIMIT ?')
          .all(cursor.after || '', limit + 1) as { context_id: string; data: string }[];
        const page = rows.slice(0, limit), more = rows.length > limit;
        return { generation: this.generation, changes: page.map(row => ({ summary: JSON.parse(row.data), retired: [] })),
          cursor: this.token({ mode: more ? 'snapshot' : 'delta', sequence: cursor.sequence, ...(more ? { after: page.at(-1)!.context_id } : {}) }),
          rebase: !token, complete: false, hasMore: true };
      }
      const rows = this.store.db.prepare('SELECT sequence, data FROM activity_changes WHERE sequence>? ORDER BY sequence LIMIT ?')
        .all(cursor.sequence, limit + 1) as { sequence: number; data: string }[];
      const page = rows.slice(0, limit), more = rows.length > limit;
      return { generation: this.generation, changes: page.map(row => JSON.parse(row.data)),
        cursor: this.token({ mode: 'delta', sequence: page.at(-1)?.sequence ?? cursor.sequence }), rebase: false, complete: !more, hasMore: more };
    })();
  }
  details(contextId: string, token?: string, requested = 100): ActivityDetails {
    const summary = this.summary(contextId), limit = Math.max(1, Math.min(200, Math.trunc(requested) || 100));
    const cursor = token ? this.parse(token) : undefined;
    if (cursor && (cursor.mode !== 'details' || cursor.context !== contextId || cursor.sequence !== summary.version)) throw new ActivityCursorExpired();
    const primary = [...new Set([summary.main?.id, summary.latestSend?.id].filter((id): id is string => !!id))];
    const after = cursor?.after ? Number(cursor.after) : Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(after) || after < 0) throw new ActivityCursorExpired();
    const rows = this.store.db.prepare(`SELECT id, ordinal FROM (
      SELECT id, ordinal FROM action_index WHERE context_id=? AND recovery=1 AND ordinal<?
      UNION SELECT id, ordinal FROM action_index WHERE target_id=? AND context_id=? AND ordinal<?
    ) WHERE id NOT IN (?,?) ORDER BY ordinal DESC LIMIT ?`)
      .all(contextId, after, summary.main?.id || '', contextId, after, primary[0] || '', primary[1] || '', limit + 1) as { id: string; ordinal: number }[];
    const page = rows.slice(0, limit), ids = [...(!token ? primary : []), ...page.map(row => row.id)];
    return { generation: this.generation, summary, actions: ids.flatMap(id => { const action = this.store.action(id); return action ? [action] : []; }),
      cursor: rows.length > limit ? this.token({ mode: 'details', sequence: summary.version, context: contextId, after: String(page.at(-1)!.ordinal) }) : null,
      scope: primary };
  }
}
