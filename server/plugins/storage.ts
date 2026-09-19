import { createHash } from 'node:crypto';
import type { Store } from '../store.js';
import type { PluginData } from '../../shared/plugins.js';
import type { Transaction } from '../../sdk/server.js';
export class PluginError extends Error {
    constructor(message: string, public statusCode = 409) { super(message); }
}
export class PluginStorage {
    constructor(readonly store: Store) {
        store.db.exec(`
      CREATE TABLE IF NOT EXISTS plugin_state (id TEXT PRIMARY KEY, generation INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0, schema_version INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS plugin_records (plugin_id TEXT NOT NULL, key TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(plugin_id,key));
      CREATE TABLE IF NOT EXISTS plugin_receipts (plugin_id TEXT NOT NULL, generation INTEGER NOT NULL, id TEXT NOT NULL, hash TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(plugin_id,generation,id));
      CREATE TABLE IF NOT EXISTS plugin_notices (id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL, generation INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS plugin_resources (plugin_id TEXT NOT NULL, generation INTEGER NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY(plugin_id,kind,id));
      CREATE TABLE IF NOT EXISTS context_references (id TEXT PRIMARY KEY, context_id TEXT NOT NULL);
    `);
    }
    ensure(id: string) { this.store.db.prepare('INSERT OR IGNORE INTO plugin_state(id) VALUES (?)').run(id); }
    metadata(id: string) {
        this.ensure(id);
        const row = this.store.db.prepare('SELECT * FROM plugin_state WHERE id=?').get(id) as any;
        return { generation: row.generation, revision: row.revision, schemaVersion: row.schema_version };
    }
    data(id: string): PluginData {
        const rows = this.store.db.prepare("SELECT key,data FROM plugin_records WHERE plugin_id=? AND substr(key,1,8)!='private:' ORDER BY rowid").all(id) as any[];
        return { ...this.metadata(id), records: Object.fromEntries(rows.map(row => [row.key, JSON.parse(row.data)])) };
    }
    entries<T = unknown>(id: string, prefix = ''): [
        string,
        T
    ][] {
        return (this.store.db.prepare('SELECT key,data FROM plugin_records WHERE plugin_id=? ORDER BY rowid').all(id) as any[])
            .filter(row => row.key.startsWith(prefix)).map(row => [row.key, JSON.parse(row.data)]);
    }
    get<T>(id: string, key: string): T | undefined {
        const row = this.store.db.prepare('SELECT data FROM plugin_records WHERE plugin_id=? AND key=?').get(id, key) as any;
        return row ? JSON.parse(row.data) : undefined;
    }
    transaction<T>(id: string, generation: number, guard: () => void, fn: (tx: Transaction) => T): T {
        const value = this.store.db.transaction(() => {
            guard();
            if (this.metadata(id).generation !== generation)
                throw new PluginError('This plugin was reset. Old changes cannot be restored.', 410);
            let active = true;
            const methods = this.transactionView(id);
            const tx = Object.fromEntries(Object.entries(methods).map(([key, method]) => [key, (...args: any[]) => {
                if (!active) throw new PluginError('This transaction has finished. Start a new transaction before writing.');
                return (method as Function)(...args);
            }])) as unknown as Transaction;
            try {
                const result = fn(tx);
                if (result && typeof (result as any).then === 'function')
                    throw new Error('Plugin transactions must be synchronous. Prepare network work before committing.');
                this.store.db.prepare('UPDATE plugin_state SET revision=revision+1 WHERE id=?').run(id);
                this.store.bumpRevision();
                return result;
            } finally { active = false; }
        })();
        this.store.emit('change', { type: 'plugin', id });
        this.store.emit('notice');
        return value;
    }
    transactionView(id: string): Transaction {
        const key = (value: string) => { if (!value || value.length > 2048)
            throw new PluginError('Invalid storage key.', 400); return value; };
        return {
            get: <T>(k: string) => this.get<T>(id, k), entries: <T>(prefix?: string) => this.entries<T>(id, prefix),
            put: (k, value) => { this.store.db.prepare('INSERT INTO plugin_records VALUES (?,?,?) ON CONFLICT(plugin_id,key) DO UPDATE SET data=excluded.data').run(id, key(k), JSON.stringify(value)); },
            delete: k => { this.store.db.prepare('DELETE FROM plugin_records WHERE plugin_id=? AND key=?').run(id, key(k)); },
            contexts: () => this.store.contexts(), context: key => this.store.context(key),
            createContext: context => {
                const prior = this.store.context(context.id);
                if (prior) {
                    if (JSON.stringify(prior) !== JSON.stringify(context))
                        throw new PluginError('Conversation identity is already in use.');
                    return prior;
                }
                return this.store.saveContext(context);
            },
            ensureContext: (c, preferred) => this.store.ensureContext(c.link, c.aliases, preferred),
            reference: (ref, contextId) => {
                const previous = this.store.db.prepare('SELECT context_id FROM context_references WHERE id=?').get(ref) as any;
                if (previous && previous.context_id !== contextId)
                    throw new PluginError('Conversation reference is already in use.');
                this.store.db.prepare('INSERT OR IGNORE INTO context_references VALUES (?,?)').run(ref, contextId);
            },
            notify: notice => {
                if (!notice.route.startsWith('/') || notice.route.startsWith('//'))
                    throw new PluginError('Notification route must belong to Herts.', 400);
                const generation = this.metadata(id).generation;
                const noticeId = `plugin:${id}:${generation}:${notice.id}`;
                this.store.db.prepare('INSERT OR IGNORE INTO plugin_notices VALUES (?,?,?,?)').run(noticeId, id, generation, JSON.stringify(notice));
                this.store.db.prepare('INSERT OR IGNORE INTO notices VALUES (?,?,?,?)').run(noticeId, notice.contextId || noticeId, 'plugin', Date.now());
            },
        };
    }
    receipt(id: string, generation: number, operationId: string, payload: unknown) {
        const row = this.store.db.prepare('SELECT hash,data FROM plugin_receipts WHERE plugin_id=? AND generation=? AND id=?').get(id, generation, operationId) as any;
        if (!row)
            return undefined;
        if (row.hash !== this.hash(payload))
            throw new PluginError('An operation ID cannot be reused for different content.');
        return { value: JSON.parse(row.data) };
    }
    saveReceipt(id: string, generation: number, operationId: string, payload: unknown, value: unknown) {
        this.store.db.prepare('INSERT INTO plugin_receipts VALUES (?,?,?,?,?)').run(id, generation, operationId, this.hash(payload), JSON.stringify(value ?? null));
    }
    hash(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
    reset(id: string) {
        this.ensure(id);
        const coreFiles = new Set(this.store.actions().flatMap(a => a.uploadIds));
        const uploads = (this.store.db.prepare('SELECT data FROM uploads').all() as any[]).map(r => JSON.parse(r.data)).filter(u => u.owner?.startsWith(id + ':'));
        const removed = uploads.filter(u => !coreFiles.has(u.id)).map(u => u.id) as string[];
        this.store.db.transaction(() => {
            for (const upload of uploads) {
                if (coreFiles.has(upload.id)) {
                    delete upload.owner;
                    this.store.saveUpload(upload);
                }
                else
                    this.store.db.prepare('DELETE FROM uploads WHERE id=?').run(upload.id);
            }
            for (const resource of this.store.db.prepare("SELECT id FROM plugin_resources WHERE plugin_id=? AND kind='transcription'").all(id) as any[]) {
                this.store.db.prepare('DELETE FROM receipts WHERE id=?').run(resource.id);
                this.store.db.prepare('DELETE FROM meta WHERE key=?').run(`audio:${resource.id}`);
            }
            this.store.db.prepare('DELETE FROM plugin_resources WHERE plugin_id=?').run(id);
            this.store.db.prepare('DELETE FROM deliveries WHERE notice_id IN (SELECT id FROM plugin_notices WHERE plugin_id=?)').run(id);
            this.store.db.prepare('DELETE FROM notices WHERE id IN (SELECT id FROM plugin_notices WHERE plugin_id=?)').run(id);
            for (const table of ['plugin_notices', 'plugin_records', 'plugin_receipts'])
                this.store.db.prepare(`DELETE FROM ${table} WHERE plugin_id=?`).run(id);
            this.store.db.prepare('UPDATE plugin_state SET generation=generation+1,revision=revision+1,schema_version=0 WHERE id=?').run(id);
            this.store.bumpRevision();
        })();
        return removed;
    }
}
