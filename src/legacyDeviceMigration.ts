import type { Transaction } from 'dexie';
import { originalSpaceId, withSpaces } from '../shared/model';
export async function migrateDeviceSpaces(tx: Transaction) {
    const capture = await tx.table('drafts').get('capture');
    if (capture) {
        await tx.table('drafts').put({ ...capture, id: `capture:${originalSpaceId}` });
        await tx.table('drafts').delete('capture');
    }
    await tx.table('recordings').where('owner').equals('capture').modify({ owner: `capture:${originalSpaceId}` });
    const saved = await tx.table('kv').get('state');
    if (saved)
        await tx.table('kv').put({ key: 'state', value: { ...saved.value, snapshot: withSpaces(saved.value.snapshot) } });
}
// Original payloads and IDs must survive unchanged: server receipts hash them.
export async function migrateDevice(tx: Transaction) {
    const pending = tx.table('pluginPending');
    for (const [table, pluginId, command] of [['spacePending', 'tasks', 'space'], ['pending', 'tasks', 'task'], ['readingPending', 'reading', 'reading']]) {
        for (const row of await tx.table(table).toArray())
            await pending.put({ id: row.op.id, pluginId, operation: { id: row.op.id, generation: 0, command, input: row.op }, order: row.order, conflict: row.conflict, contextId: row.op.contextId || row.op.taskId });
        await tx.table(table).clear();
    }
    const local = tx.table('pluginLocal');
    for (const row of await tx.table('drafts').toArray()) {
        const pluginId = row.id === 'reading-capture' ? 'reading' : row.id === 'capture' || row.id.startsWith('capture:') ? 'tasks' : undefined;
        if (pluginId) {
            await local.put({ key: `${pluginId}:0:draft:${row.id}`, value: row });
            await tx.table('drafts').delete(row.id);
        }
    }
    for (const row of await tx.table('recordings').toArray())
        if (row.owner === 'capture' || row.owner.startsWith('capture:'))
            await tx.table('recordings').update(row.id, { owner: `plugin:tasks:0:${row.owner}` });
    for (const row of await tx.table('kv').toArray()) {
        const pluginId = row.key.startsWith('reading-alias:') ? 'reading' : row.key.startsWith('link-intent:') || row.key === 'viewed-space' ? 'tasks' : undefined;
        if (pluginId) {
            await local.put({ key: `${pluginId}:0:kv:${row.key}`, value: row.value });
            await tx.table('kv').delete(row.key);
        }
    }
    for (const article of await tx.table('articles').toArray())
        await local.put({ key: `reading:0:article:${article.itemId}`, value: article });
    await tx.table('articles').clear();
}
