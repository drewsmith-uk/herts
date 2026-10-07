import { liveQuery } from 'dexie';
import { db, getState, useApp, mutatePlugin, resolvePluginOperation, api, rebuild, sync } from './data';
import { pendingDraft, stageDraft, draftIsCurrent, acknowledgeDraft, pendingDraftKeys, type DraftWrite } from './draftJournal';
export { liveQuery };
export function pluginLocal(id: string, generation = getState().plugins.entries.find(e => e.manifest.id === id)?.generation ?? 0) {
    const prefix = `${id}:${generation}:`;
    function guard() { if ((getState().plugins.entries.find(e => e.manifest.id === id)?.generation ?? 0) !== generation)
        throw new Error('This plugin was reset. Old edits cannot be restored.'); }
    async function commitDraft(key: string, write: DraftWrite) {
        await db.transaction('rw', db.pluginLocal, db.kv, async () => {
            if (((await db.kv.get(`plugin-generation:${id}`))?.value ?? 0) !== generation)
                throw new Error('This plugin was reset. Old edits cannot be restored.');
            if (!draftIsCurrent(key, write)) return;
            if (write.value === null) await db.pluginLocal.delete(key);
            else await db.pluginLocal.put({ key, value: write.value });
        });
        acknowledgeDraft(key, write);
    }
    async function recoverDraft(key: string) {
        let pending;
        while ((pending = pendingDraft(key))) await commitDraft(key, pending);
    }
    const table = (kind: string) => ({
        async get(key: string) { const storageKey = `${prefix}${kind}:${key}`; if (kind === 'draft') await recoverDraft(storageKey); const row = await db.pluginLocal.get(storageKey); return kind === 'kv' ? (row ? { key, value: row.value } : undefined) : row?.value; },
        async put(value: any) { guard(); const key = kind === 'kv' ? value.key : value.id || value.itemId;
            if (kind === 'draft') { const storageKey = `${prefix}${kind}:${key}`; await commitDraft(storageKey, stageDraft(storageKey, value)); return key; }
            await db.transaction('rw', db.pluginLocal, db.kv, async () => { if (((await db.kv.get(`plugin-generation:${id}`))?.value ?? 0) !== generation)
            throw new Error('This plugin was reset. Old edits cannot be restored.'); await db.pluginLocal.put({ key: `${prefix}${kind}:${key}`, value: kind === 'kv' ? value.value : value }); }); return key; },
        async delete(key: string) { guard(); const storageKey = `${prefix}${kind}:${key}`; if (kind === 'draft') await commitDraft(storageKey, stageDraft(storageKey, null)); else await db.pluginLocal.delete(storageKey); },
        async toArray() { if (kind === 'draft') for (const key of pendingDraftKeys(`${prefix}${kind}:`)) await recoverDraft(key); const rows = await db.pluginLocal.where('key').startsWith(`${prefix}${kind}:`).toArray(); return rows.map(r => kind === 'kv' ? { key: r.key.slice(`${prefix}${kind}:`.length), value: r.value } : r.value); },
    });
    return { kv: table('kv'), drafts: table('draft'), articles: table('article'),
        watchDrafts(next:(rows:any[])=>void,error:(error:unknown)=>void){
            // Observe the Dexie read directly. Recovery writes must finish outside
            // the live query's read-only observation scope.
            let closed=false,subscription:{unsubscribe():void}|undefined;
            void (async()=>{for(const key of pendingDraftKeys(`${prefix}draft:`))await recoverDraft(key);
                if(!closed)subscription=liveQuery(()=>db.pluginLocal.where('key').startsWith(`${prefix}draft:`).toArray()).subscribe({next:rows=>next(rows.map(row=>row.value)),error});
            })().catch(error);
            return ()=>{closed=true;subscription?.unsubscribe();};
        },
        async hasRecording(owner: string) { guard(); return (await db.recordings.where('owner').equals(`plugin:${id}:${generation}:${owner}`).count()) > 0; },
    };
}
export function pluginRecords<T = Record<string, unknown>>(id: string): T { return (getState().pluginData[id]?.records || {}) as T; }
export function usePluginRecords<T = Record<string, unknown>>(id: string): T { return (useApp().pluginData[id]?.records || {}) as T; }
export async function pluginQuery(id: string, query: string, input: unknown) { return api(`/plugins/${id}/queries/${query}`, input); }
export { mutatePlugin, resolvePluginOperation, sync, rebuild };

/** Online-only: callers retain the operation ID and inspect status after lost replies. */
export async function performPluginAction(id: string, command: string, input: unknown, operationId: string) {
    const generation = getState().plugins.entries.find(e => e.manifest.id === id)?.generation;
    if (generation === undefined) throw new Error('Plugin is unavailable.');
    return api(`/plugins/${id}/actions`, { id: operationId, generation, command, input });
}
export async function pluginActionStatus(id: string, operationId?: string, options?:{profile?:string;offset?:number}) {
    return api(`/plugins/${id}/actions${operationId ? '/' + encodeURIComponent(operationId) : options ? '?' + new URLSearchParams(Object.entries(options).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)])) : ''}`);
}

export async function reviewPluginAction(id:string,operationId:string){return api(`/plugins/${id}/actions/${encodeURIComponent(operationId)}/review`,{reviewed:true});}
