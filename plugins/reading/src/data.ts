import { useCore, getCore, pluginLocal, mutatePlugin, resolvePluginOperation, pluginQuery, conversationDrafts, submit, sync, publish, rebuild, type CoreState } from '@herts/plugin-api/client';
import { normalizeUrl, emptyReading, retainsArticle, type ReadingState, type ReadingOp, type Article } from './model';
export { sync, publish };
const copies: Record<string, Article> = {}, errors: Record<string, {
    version: number;
    message: string;
}> = {};
let generation = -1;
function adapt(core: CoreState) {
    const nextGeneration = core.plugins.entries.find(e => e.manifest.id === 'reading')?.generation ?? 0;
    if (generation !== nextGeneration) {
        for (const key of Object.keys(copies))
            delete copies[key];
        for (const key of Object.keys(errors))
            delete errors[key];
        generation = nextGeneration;
    }
    const reading = (core.pluginData.reading?.records.state || emptyReading()) as ReadingState;
    for (const [id, article] of Object.entries(core.pluginData.reading?.records.state ? copies : {})) {
        const item = reading.items.find(i => i.id === id);
        if (!item || !retainsArticle(item, reading) || article.version !== item.downloadVersion) {
            delete copies[id];
            void pluginLocal('reading').articles.delete(id);
        }
    }
    return { ...core, snapshot: { ...core.snapshot, reading }, remote: { ...core.remote, reading: (core.pluginRemote.reading?.records.state || emptyReading()) as ReadingState }, readingPending: core.pluginPending.filter(p => p.pluginId === 'reading').map(p => ({ op: p.operation.input as ReadingOp, order: p.order, conflict: p.conflict })), articleCopies: { ...copies }, articleErrors: { ...errors } };
}
const current = () => adapt(getCore());
export function useApp() { return adapt(useCore()); }
export const db = { get kv() { return pluginLocal('reading').kv; }, get drafts() { return pluginLocal('reading').drafts; }, get articles() { return pluginLocal('reading').articles; } };
export async function mutateReading(op: ReadingOp) { return mutatePlugin('reading', 'reading', op, op.contextId || current().snapshot.reading.items.find(i => i.id === op.itemId)?.contextId); }
export async function addReading(raw: string, title = '', conversationId?: string, entryId?: string) {
    const url = normalizeUrl(raw), state = current(), context = conversationId ? state.snapshot.contexts.find(c => c.aliases.includes(conversationId)) : undefined;
    const cleanTitle = title.trim().slice(0, 2000);
    // A pasted URL in the optional title must not disguise a different link.
    // Validate before creating a draft, queueing a reading item or sending it.
    if (/^https?:\/\/\S+$/i.test(cleanTitle) && normalizeUrl(cleanTitle) !== url)
        throw new Error('The title is a different link. Check the Link field, then clear the title or enter a descriptive title.');
    const prepared = entryId && state.snapshot.reading.items.find(item => item.id === entryId);
    if (prepared) {
        if (prepared.urlKey !== url) throw new Error('This draft has already been saved with a different link. Open the saved item or start a new reading entry for this link.');
        return prepared.id;
    }
    const existing = context && state.snapshot.reading.items.find(i => i.contextId === context.id && i.urlKey === url);
    if (existing)
        return existing.id;
    const pending = conversationId && state.readingPending.find(p => p.op.kind === 'create' && p.op.url === url && (p.op.conversationId === conversationId || context && p.op.contextId === context.id));
    if (pending)
        return pending.op.itemId;
    const itemId = entryId || crypto.randomUUID(), contextId = context?.id || entryId || crypto.randomUUID();
    if (!conversationId && !entryId)
        await conversationDrafts.put({ id: contextId, text: url, files: [] });
    await mutateReading({ id: crypto.randomUUID(), itemId, contextId, kind: 'create', url, title: cleanTitle || url, ...(conversationId ? { conversationId } : {}), at: Date.now() });
    return itemId;
}
export async function readingChange(itemId: string, change: Partial<ReadingOp> & Pick<ReadingOp, 'kind'>) { const state = current(), item = state.snapshot.reading.items.find(i => i.id === itemId); return mutateReading({ id: crypto.randomUUID(), itemId, at: Date.now(), ...change, ...(change.kind === 'title' ? { baseTitle: change.baseTitle ?? item?.title } : {}), ...(change.kind === 'read' ? { baseReadAt: item?.readAt ?? null } : {}), ...(change.kind === 'reorder' ? { listVersion: state.snapshot.reading.unread.version } : {}) }); }
export async function resolveReadingConflict(id: string, keep: boolean) { const state = current(), pending = state.readingPending.find(p => p.op.id === id); if (!pending)
    return; const item = state.remote.reading.items.find(i => i.id === pending.op.itemId); return resolvePluginOperation(id, keep ? { ...pending.op, baseReadAt: item?.readAt ?? null, listVersion: state.remote.reading.unread.version, ...(pending.op.kind === 'title' ? { baseTitle: item?.title } : {}) } : undefined); }
export async function getArticle(id: string): Promise<Article> {
    const local = pluginLocal('reading'), startGeneration = current().plugins.entries.find(e => e.manifest.id === 'reading')?.generation;
    const cached = await local.articles.get(id);
    if (cached) {
        copies[id] = cached;
        return cached;
    }
    const article = await pluginQuery('reading', 'article', { id }) as Article;
    const state = current(), item = state.snapshot.reading.items.find(i => i.id === id);
    if (state.plugins.entries.find(e => e.manifest.id === 'reading')?.generation !== startGeneration)
        throw new Error('Reading data was reset.');
    if (item && retainsArticle(item, state.snapshot.reading) && item.downloadVersion === article.version && !state.readingPending.some(p => p.op.itemId === id || p.op.kind === 'settings')) {
        try {
            await local.articles.put(article);
            copies[id] = article;
            delete errors[id];
        }
        catch {
            errors[id] = { version: article.version, message: 'Could not save the article on this device. Free some storage and retry the download.' };
        }
    }
    await rebuild();
    return article;
}
let downloading = false;
export function startReading() {
    let stopped = false;
    current();
    async function download() {
        if (stopped || downloading)
            return;
        downloading = true;
        try {
            for (const article of await db.articles.toArray())
                copies[article.itemId] = article;
            const state = current();
            if (!state.online)
                return;
            for (const item of state.snapshot.reading.items) {
                if (stopped)
                    break;
                if (retainsArticle(item, state.snapshot.reading) && !copies[item.id] && !state.readingPending.some(p => p.op.itemId === item.id))
                    try {
                        await getArticle(item.id);
                    }
                    catch { /* Next refresh retries; never sends Hermes prompts. */ }
            }
        }
        finally {
            downloading = false;
        }
    }
    void download();
    const timer = setInterval(() => void download(), 5000);
    return () => { stopped = true; clearInterval(timer); };
}
