import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { applyReadingOp, emptyReading, normalizeUrl, retainsArticle, type ConversationContext, type ReadingOp, type ReadingState, type Article } from '../shared/reading.js';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { LegacyFeatures } from './legacyFeatures.js';
import { emptySettings, type SettingsState } from '../shared/sessionSettings.js';
import { applyTaskOp, applySpaceOp, withSpaces, applyConversationVisibility, emptySnapshot, Conflict, type Snapshot, type TaskOp, type SpaceOp, type Task, type Link, type Action, type Binding, type Upload, type ConversationVisibilityOp } from '../shared/model.js';

export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class Store extends LegacyFeatures {
  db: Database.Database;
  readonly legacyInstallation: boolean;
  constructor(path: string) {
    super();
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path);
    if(Number(this.db.pragma('user_version',{simple:true}))>6){this.db.close();throw new Error('This database needs a newer Herts version.');}
    this.legacyInstallation = Number(this.db.pragma('user_version', { simple: true })) > 0;
    this.db.pragma('journal_mode = WAL'); this.db.pragma('synchronous = FULL'); this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, link_key TEXT UNIQUE, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, hash TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS actions (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bindings (task_id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS notices (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS deliveries (notice_id TEXT NOT NULL, subscription_id TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(notice_id,subscription_id));
      CREATE TABLE IF NOT EXISTS control_receipts (key TEXT PRIMARY KEY, action_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS contexts (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS context_aliases (alias TEXT PRIMARY KEY, context_id TEXT NOT NULL REFERENCES contexts(id));
      CREATE TABLE IF NOT EXISTS reading_items (id TEXT PRIMARY KEY, context_id TEXT NOT NULL REFERENCES contexts(id), url_key TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(context_id,url_key));
      CREATE TABLE IF NOT EXISTS articles (item_id TEXT PRIMARY KEY REFERENCES reading_items(id), data TEXT NOT NULL);
    `);
    if (path !== ':memory:') chmodSync(path, 0o600);
    if (!this.getMeta('snapshot')) this.setMeta('snapshot', { lists: emptySnapshot().lists, revision: 0 });
    if ((this.db.pragma('user_version', { simple: true }) as number) < 2) this.db.transaction(() => {
      for (const task of this.snapshot().tasks) {
        const context = task.link ? this.ensureContext(task.link, [], task.id) : this.saveContext({ id: task.id, title: task.title, link: null, aliases: [] });
        task.contextId = context.id; this.saveTask(task);
      }
      // Legacy IDs and receipt payload hashes remain unchanged. New contexts use the
      // same IDs, retaining bindings, action targets, drafts and notification receipts.
      this.db.pragma('user_version = 2');
    })();
    if ((this.db.pragma('user_version', { simple: true }) as number) < 3) this.db.transaction(() => {
      const snapshot = withSpaces(this.snapshot());
      for (const task of snapshot.tasks) this.saveTask(task);
      this.saveTaskState(snapshot);
      this.db.pragma('user_version = 3');
    })();
    if ((this.db.pragma('user_version', { simple: true }) as number) < 4) this.db.transaction(() => {
      this.saveTaskState(this.snapshot());
      this.db.pragma('user_version = 4');
    })();
    if ((this.db.pragma('user_version', { simple: true }) as number) < 5) this.db.transaction(() => {
      this.db.exec(`
        ALTER TABLE subscriptions ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE subscriptions ADD COLUMN invalid INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE subscriptions ADD COLUMN last_error TEXT;
        ALTER TABLE subscriptions ADD COLUMN last_accepted INTEGER;
        CREATE TABLE notification_tests (id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL, data TEXT NOT NULL);
      `);
      this.db.pragma('user_version = 5');
    })();
  }
  getMeta<T = any>(key: string): T | undefined { const r = this.db.prepare('SELECT value FROM meta WHERE key=?').get(key) as any; return r ? JSON.parse(r.value) : undefined; }
  sessionSettings(): SettingsState { return this.getMeta<SettingsState>('session-settings') || emptySettings(); }
  saveSessionSettings(settings: SettingsState) { this.setMeta('session-settings', settings); this.bumpRevision(); this.emit('change', { type: 'settings' }); }
  coreSnapshot(){return{revision:this.getMeta<any>('snapshot')?.revision||0,contexts:this.contexts(),hiddenConversations:this.getMeta<string[]>('hiddenConversations')||[],sessionSettings:this.sessionSettings()};}
  setMeta(key: string, value: unknown) { this.db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run(key, JSON.stringify(value)); }
  setConversationVisibility(op: ConversationVisibilityOp) {
    const result = this.db.transaction(() => {
      const prior = this.receipt(op.id, op); if (prior) return prior;
      this.setMeta('hiddenConversations', applyConversationVisibility(this.getMeta<string[]>('hiddenConversations') || [], op));
      const meta = this.getMeta('snapshot'); meta.revision++; this.setMeta('snapshot', meta);
      const result = { accepted: true, id: op.id }; this.saveReceipt(op.id, op, result); return result;
    })();
    this.emit('change', { type: 'conversations' }); return result;
  }
  receipt(id: string, payload: unknown): any {
    const r = this.db.prepare('SELECT * FROM receipts WHERE id=?').get(id) as any;
    if (!r) return undefined;
    if (r.hash !== digest(payload)) throw new Conflict('An operation ID cannot be reused for different content.');
    return JSON.parse(r.data);
  }
  saveReceipt(id: string, payload: unknown, data: unknown) { this.db.prepare('INSERT INTO receipts VALUES (?,?,?)').run(id, digest(payload), JSON.stringify(data)); }
  contexts(): ConversationContext[] { return (this.db.prepare('SELECT data FROM contexts').all() as any[]).map(r => JSON.parse(r.data)); }
  context(id: string): ConversationContext | undefined {
    const ref = this.db.prepare("SELECT name FROM sqlite_master WHERE name='context_references'").get() ? this.db.prepare('SELECT context_id FROM context_references WHERE id=?').get(id) as any : undefined;
    const key = ref?.context_id || (this.db.prepare("SELECT name FROM sqlite_master WHERE name='context_references'").get() ? id : this.task(id)?.contextId || id);
    const r = this.db.prepare('SELECT data FROM contexts WHERE id=?').get(key) as any; return r && JSON.parse(r.data);
  }
  saveContext(context: ConversationContext) {
    this.db.prepare('INSERT OR REPLACE INTO contexts VALUES (?,?)').run(context.id, JSON.stringify(context));
    for (const alias of context.aliases) this.db.prepare('INSERT INTO context_aliases VALUES (?,?) ON CONFLICT(alias) DO UPDATE SET context_id=excluded.context_id').run(alias, context.id);
    return context;
  }
  ensureContext(link: Link, aliases: string[] = [], preferred: string = randomUUID()): ConversationContext {
    const ids = [...new Set([link.key, link.storedId, ...aliases])];
    const matches = ids.flatMap(alias => { const r = this.db.prepare('SELECT context_id FROM context_aliases WHERE alias=?').get(alias) as any; return r ? [r.context_id as string] : []; });
    if (new Set(matches).size > 1) throw new Conflict('Conversation identities overlap. Refresh before linking.');
    const existing = matches[0] && this.context(matches[0]);
    return this.saveContext(existing ? { ...existing, link, aliases: [...new Set([...existing.aliases, ...ids])] } : { id: preferred, title: link.title, link, aliases: ids });
  }
  openConversation(link: Link, aliases: string[] = []): ConversationContext {
    let changed = false;
    const context = this.db.transaction(() => {
      const ids = [link.key, link.storedId, ...aliases];
      const previous = this.contexts().find(c => c.aliases.some(alias => ids.includes(alias)));
      const context = this.ensureContext(link, aliases);
      changed = JSON.stringify(previous) !== JSON.stringify(context);
      if (changed) this.bumpRevision();
      return context;
    })();
    if (changed) this.emit('change', { type: 'contexts' });
    return context;
  }
  linkNew(contextId: string, link: Link) {
    this.db.transaction(() => {
      const context = this.context(contextId); if (!context) throw new Conflict('Conversation reference not found.');
      if (context.link && context.link.key !== link.key) throw new Conflict('This item already has a conversation.');
      const linked = this.ensureContext(link, context.aliases, context.id);
      if (linked.id !== context.id) throw new Conflict('Conversation already linked.');
      this.updateLegacyLinks(context.id,link);
      this.bumpRevision();
    })(); this.emit('change', { type: 'contexts' });
  }
  bumpRevision() { const meta = this.getMeta('snapshot'); meta.revision++; this.setMeta('snapshot', meta); }
  actions(taskId?: string): Action[] { return (taskId ? this.db.prepare('SELECT data FROM actions WHERE task_id=? ORDER BY rowid DESC').all(this.context(taskId)?.id || taskId) : this.db.prepare('SELECT data FROM actions ORDER BY rowid DESC').all()).map((r: any) => JSON.parse(r.data)); }
  action(id: string): Action | undefined { const r = this.db.prepare('SELECT data FROM actions WHERE id=?').get(id) as any; return r && JSON.parse(r.data); }
  saveAction(action: Action) { action.updatedAt = Date.now(); this.db.prepare('INSERT INTO actions VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(action.id, action.taskId, JSON.stringify(action)); this.emit('change', { type: 'action', action }); }
  binding(taskId: string): Binding | undefined { const r = this.db.prepare('SELECT data FROM bindings WHERE task_id=?').get(this.context(taskId)?.id || taskId) as any; return r && JSON.parse(r.data); }
  bindings(): [string, Binding][] { return (this.db.prepare('SELECT * FROM bindings').all() as any[]).map(r => [r.task_id, JSON.parse(r.data)]); }
  saveBinding(taskId: string, binding: Binding) { this.db.prepare('INSERT OR REPLACE INTO bindings VALUES (?,?)').run(taskId, JSON.stringify(binding)); }
  upload(id: string): Upload | undefined { const r = this.db.prepare('SELECT data FROM uploads WHERE id=?').get(id) as any; return r && JSON.parse(r.data); }
  saveUpload(u: Upload) { this.db.prepare('INSERT OR REPLACE INTO uploads VALUES (?,?)').run(u.id, JSON.stringify(u)); }
  notify(id: string, taskId: string, kind: string) { this.db.prepare('INSERT OR IGNORE INTO notices VALUES (?,?,?,?)').run(id, taskId, kind, Date.now()); this.emit('notice'); }
  close() { this.db.close(); }
}
