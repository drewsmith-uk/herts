import { z } from 'zod';
import type { ServerPlugin, ServerServices, Transaction } from '@herts/plugin-api/server';
import { Conflict } from '@herts/plugin-api/types';
import { applyReadingOp, emptyReading, normalizeUrl, retainsArticle, type ReadingOp, type ReadingState, type Article } from './model.js';
const uuid = z.string().uuid();
const schema = z.object({ id: uuid, itemId: uuid, kind: z.enum(['create', 'title', 'read', 'reorder', 'offline', 'settings']), at: z.number().int().positive(), contextId: uuid.optional(), conversationId: z.string().min(1).max(300).optional(), url: z.string().max(8192).optional(), title: z.string().max(2000).optional(), baseTitle: z.string().max(8192).optional(), read: z.boolean().optional(), baseReadAt: z.number().nullable().optional(), beforeId: uuid.nullable().optional(), listVersion: z.number().int().nonnegative().optional(), offline: z.enum(['auto', 'keep', 'remove']).optional(), autoDownload: z.boolean().optional() }).strict().superRefine((v, ctx) => {
    if ((v.kind === 'create' && (!v.url || !v.contextId)) || (v.kind === 'title' && (!v.title?.trim() || v.baseTitle === undefined)) || (v.kind === 'read' && (v.read === undefined || v.baseReadAt === undefined)) || (v.kind === 'reorder' && v.listVersion === undefined) || (v.kind === 'offline' && !v.offline) || (v.kind === 'settings' && v.autoDownload === undefined))
        ctx.addIssue({ code: 'custom', message: 'Required reading-list fields are missing.' });
});
export default function activate(api: ServerServices): ServerPlugin {
    const reading = () => api.get<ReadingState>('state') || emptyReading();
    const active = new Map<string, {
        version: number;
        controller: AbortController;
        promise: Promise<Article>;
    }>();
    let stopChanges: (() => void) | undefined;
    async function get(id: string): Promise<Article> {
        api.signal.throwIfAborted();
        const item = reading().items.find(i => i.id === id);
        if (!item)
            throw new Conflict('Reading item not found.');
        const cached = api.get<Article>(`private:article:${id}`);
        if (cached?.version === item.downloadVersion)
            return cached;
        const previous = active.get(id);
        if (previous?.version === item.downloadVersion)
            return previous.promise;
        if (previous) {
            previous.controller.abort();
            await previous.promise.catch(() => { });
        }
        const controller = new AbortController(), abort = () => controller.abort();
        api.signal.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(abort, 20000);
        const promise = (async () => {
            let article: Article;
            try {
                const fetched = await api.web.fetchHtml(item.url, controller.signal);
                controller.signal.throwIfAborted();
                article = { ...api.web.extractArticle(fetched.html, fetched.url), itemId: item.id, version: item.downloadVersion };
            }
            catch (error) {
                if (api.signal.aborted)
                    throw error;
                article = { itemId: id, version: item.downloadVersion, url: item.url, title: '', byline: '', siteName: new URL(item.url).hostname, html: '', text: '', fetchedAt: Date.now(), status: 'unavailable', warning: controller.signal.aborted ? 'Download interrupted. Retry when connected.' : error instanceof Error ? error.message : 'Unavailable offline.' };
            }
            finally {
                clearTimeout(timer);
                api.signal.removeEventListener('abort', abort);
            }
            if (!api.signal.aborted)
                api.transaction(tx => {
                    const state = tx.get<ReadingState>('state') || emptyReading(), current = state.items.find(i => i.id === id);
                    if (!current || !retainsArticle(current, state) || current.downloadVersion !== article.version)
                        return;
                    tx.put(`private:article:${id}`, article);
                    if (article.title && current.title === current.url) {
                        current.title = article.title.slice(0, 2000);
                        tx.put('state', state);
                    }
                });
            return article;
        })();
        active.set(id, { version: item.downloadVersion, controller, promise });
        try {
            return await promise;
        }
        finally {
            if (active.get(id)?.promise === promise)
                active.delete(id);
        }
    }
    function prepare() {
        if (api.signal.aborted)
            return;
        const state = reading();
        for (const [id, job] of active) {
            const item = state.items.find(i => i.id === id);
            if (!item || !retainsArticle(item, state) || item.downloadVersion !== job.version)
                job.controller.abort();
        }
        for (const item of state.items) {
            if (active.size >= 2)
                break;
            if (retainsArticle(item, state) && !active.has(item.id) && !api.get(`private:article:${item.id}`))
                void get(item.id).catch(() => { });
        }
    }
    return {
        migrate: (_from, tx) => { if (!tx.get('state'))
            tx.put('state', emptyReading()); },
        commands: { reading: {
                prepare: async (input) => {
                    const op = schema.parse(input);
                    if (op.kind === 'create' && op.conversationId) {
                        try {
                            return await api.resolveConversation(op.conversationId);
                        }
                        catch (error) {
                            if (!api.contexts().some(c => c.aliases.includes(op.conversationId!)))
                                throw error;
                        }
                    }
                },
                apply(input, tx, conversation) {
                    const op = schema.parse(input) as ReadingOp;
                    let actual = { ...op, itemId: tx.get<string>(`alias:${op.itemId}`) || op.itemId };
                    if (op.kind === 'create') {
                        const context = op.conversationId ? (conversation ? tx.ensureContext(conversation, op.contextId) : tx.contexts().find(c => c.aliases.includes(op.conversationId!))) : tx.createContext({ id: op.contextId!, title: op.title?.trim() || op.url!, link: null, aliases: [] });
                        if (!context)
                            throw new Conflict('Connect to Hermes to save this conversation link.');
                        actual = { ...op, contextId: context.id };
                        tx.reference(op.itemId, context.id);
                        const existing = (tx.get<ReadingState>('state') || emptyReading()).items.find(i => i.contextId === context.id && i.urlKey === normalizeUrl(op.url!));
                        if (existing) {
                            tx.put(`alias:${op.itemId}`, existing.id);
                            return { accepted: true, itemId: existing.id };
                        }
                    }
                    const next = applyReadingOp(tx.get<ReadingState>('state') || emptyReading(), actual);
                    tx.put('state', next);
                    for (const [key, article] of tx.entries<Article>('private:article:')) {
                        const item = next.items.find(i => i.id === article.itemId);
                        if (!item || !retainsArticle(item, next) || item.downloadVersion !== article.version)
                            tx.delete(key);
                    }
                    return { accepted: true, itemId: actual.itemId };
                },
            } },
        queries: { article: input => get(uuid.parse(input.id)) },
        start() { stopChanges = api.onChange(prepare); api.interval(prepare, 15000); prepare(); },
        dispose() { stopChanges?.(); for (const job of active.values())
            job.controller.abort(); },
        conversation(context) { const item = reading().items.find(i => i.contextId === context.id); return item ? { title: item.title, route: `/reading-item/${item.id}` } : undefined; },
    };
}
