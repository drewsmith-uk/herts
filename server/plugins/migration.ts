import type { Store } from '../store.js';
import type { PluginStorage } from './storage.js';
// One-time adapter for releases before the public plugin API. The core runtime
// and plugin packages never depend on this legacy storage layout.
export function migrateLegacyPlugins(store: Store, storage: PluginStorage) {
    if (store.getMeta('plugin-data-migrated'))
        return;
    store.db.transaction(() => {
        const snapshot = store.snapshot();
        storage.ensure('tasks');
        storage.ensure('reading');
        const tasks = storage.transactionView('tasks'), reading = storage.transactionView('reading');
        const { tasks: items, lists, spaces, spaceLists, defaultSpaceId, revision } = snapshot;
        if (store.legacyInstallation) {
            tasks.put('state', { tasks: items, lists, spaces, spaceLists, defaultSpaceId, revision });
            reading.put('state', store.reading());
            for (const item of store.reading().items) {
                reading.reference(item.id, item.contextId);
                const article = store.article(item.id);
                if (article)
                    reading.put(`private:article:${item.id}`, article);
            }
            for (const task of items)
                tasks.reference(task.id, task.contextId || task.id);
            for (const notice of store.db.prepare("SELECT * FROM notices WHERE kind='reminder'").all() as any[]) {
                const task = items.find(t => t.id === notice.task_id);
                store.db.prepare('INSERT OR IGNORE INTO plugin_notices VALUES (?,?,?,?)').run(notice.id, 'tasks', 0, JSON.stringify({ id: notice.id, title: task?.title || 'Task reminder', body: 'Your snoozed task is back in Inbox.', route: task ? `/task/${task.id}` : '/tasks', contextId: task?.contextId }));
            }
        }
        // Retire duplicate feature data after the atomic copy, so Reset has one owner.
        store.db.exec('DELETE FROM articles; DELETE FROM reading_items; DELETE FROM tasks;');
        store.setMeta('reading', { unread: { ids: [], version: 0 }, autoDownload: true });
        const blank = { inbox: { ids: [], version: 0 }, next: { ids: [], version: 0 }, waiting: { ids: [], version: 0 }, parked: { ids: [], version: 0 }, snoozed: { ids: [], version: 0 }, done: { ids: [], version: 0 } };
        store.setMeta('snapshot', { revision: snapshot.revision, lists: blank });
        store.setMeta('plugin-data-migrated', true);
        store.db.pragma('user_version = 6');
    })();
}
export function legacyReceipt(store: Store, id: string, command: string, input: any, prepared?: any) {
    if (typeof input?.id !== 'string')
        return undefined;
    let payload: unknown = input;
    if (id === 'tasks' && command === 'link') {
        if (!prepared)
            return undefined;
        const { conversationId, ...rest } = input;
        payload = { op: { ...rest, kind: 'create' }, linkKey: prepared.link.key };
    }
    else if (!((id === 'tasks' && ['task', 'space'].includes(command)) || (id === 'reading' && command === 'reading')))
        return undefined;
    return store.receipt(input?.id, payload);
}
