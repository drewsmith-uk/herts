import { liveQuery } from 'dexie';
import { db, getState, useApp, mutatePlugin, resolvePluginOperation, api, rebuild, sync } from './data';
export { liveQuery };
export function pluginLocal(id: string, generation = getState().plugins.entries.find(e => e.manifest.id === id)?.generation ?? 0) {
    const prefix = `${id}:${generation}:`;
    function guard() { if ((getState().plugins.entries.find(e => e.manifest.id === id)?.generation ?? 0) !== generation)
        throw new Error('This plugin was reset. Old edits cannot be restored.'); }
    const table = (kind: string) => ({
        async get(key: string) { const row = await db.pluginLocal.get(`${prefix}${kind}:${key}`); return kind === 'kv' ? (row ? { key, value: row.value } : undefined) : row?.value; },
        async put(value: any) { guard(); const key = kind === 'kv' ? value.key : value.id || value.itemId; await db.transaction('rw', db.pluginLocal, db.kv, async () => { if (((await db.kv.get(`plugin-generation:${id}`))?.value ?? 0) !== generation)
            throw new Error('This plugin was reset. Old edits cannot be restored.'); await db.pluginLocal.put({ key: `${prefix}${kind}:${key}`, value: kind === 'kv' ? value.value : value }); }); return key; },
        async delete(key: string) { guard(); await db.pluginLocal.delete(`${prefix}${kind}:${key}`); },
        async toArray() { const rows = await db.pluginLocal.where('key').startsWith(`${prefix}${kind}:`).toArray(); return rows.map(r => kind === 'kv' ? { key: r.key.slice(`${prefix}${kind}:`.length), value: r.value } : r.value); },
    });
    return { kv: table('kv'), drafts: table('draft'), articles: table('article') };
}
export function pluginRecords<T = Record<string, unknown>>(id: string): T { return (getState().pluginData[id]?.records || {}) as T; }
export function usePluginRecords<T = Record<string, unknown>>(id: string): T { return (useApp().pluginData[id]?.records || {}) as T; }
export async function pluginQuery(id: string, query: string, input: unknown) { return api(`/plugins/${id}/queries/${query}`, input); }
export { mutatePlugin, resolvePluginOperation, sync, rebuild };
