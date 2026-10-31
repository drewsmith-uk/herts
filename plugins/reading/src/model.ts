import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { RootContent, Root } from 'mdast';
import { Conflict } from '@herts/plugin-api/types';
import type { Conversation, ConversationContext } from '@herts/plugin-api/types';
interface List {
    ids: string[];
    version: number;
}
export interface ReadingItem {
    id: string;
    contextId: string;
    url: string;
    urlKey: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    readAt: number | null;
    offline: 'auto' | 'keep' | 'remove';
    downloadVersion: number;
    articleHold?: string;
}
export interface Article {
    itemId: string;
    version: number;
    url: string;
    title: string;
    byline: string;
    siteName: string;
    html: string;
    text: string;
    fetchedAt: number;
    status: 'saved' | 'excerpt' | 'unavailable';
    warning: string;
}
export interface ReadingState {
    items: ReadingItem[];
    unread: List;
    autoDownload: boolean;
    urlCleanup?: UrlCleanup;
}
export interface ReadingOp {
    id: string;
    itemId: string;
    kind: 'create' | 'title' | 'read' | 'reorder' | 'offline' | 'settings' | 'release';
    at: number;
    contextId?: string;
    conversationId?: string;
    url?: string;
    title?: string;
    read?: boolean;
    restoreReadAt?: number;
    articleHold?: string;
    baseTitle?: string;
    baseReadAt?: number | null;
    beforeId?: string | null;
    listVersion?: number;
    offline?: ReadingItem['offline'];
    autoDownload?: boolean;
    urlCleanup?: UrlCleanup;
}
export const emptyReading = (): ReadingState => ({ items: [], unread: { ids: [], version: 0 }, autoDownload: true, urlCleanup: 'off' });
export function conversationReadingItems(conversation: Conversation, state: ReadingState, contexts: ConversationContext[]) {
    const aliases = new Set([conversation.id, conversation.key, ...conversation.aliases]);
    const linkedContexts = new Set(contexts.filter(context => context.link &&
        [context.link.key, context.link.storedId, ...context.aliases].some(id => aliases.has(id))).map(context => context.id));
    return state.items.filter(item => linkedContexts.has(item.contextId));
}
export function normalizeUrl(raw: string): string {
    let url: URL;
    try {
        url = new URL(raw.trim());
    }
    catch {
        throw new Conflict('Enter a complete http or https link.');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || raw.length > 8192)
        throw new Conflict('Use an http or https link without embedded credentials.');
    return url.href;
}
export type UrlCleanup = 'off' | 'tracking' | 'all';
const trackingKeys = new Set(['fbclid', 'gclid', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'mc_cid', 'mc_eid']);
export function cleanUrl(raw: string, mode: UrlCleanup): string {
    normalizeUrl(raw);
    if (mode === 'off') return raw;
    const hash = raw.indexOf('#'), end = hash < 0 ? raw.length : hash;
    const query = raw.indexOf('?');
    if (query < 0 || query > end) return raw;
    const parts = raw.slice(query + 1, end).split('&');
    const kept = mode === 'all' ? [] : parts.filter(part => {
        const key = [...new URLSearchParams(part).keys()][0]?.toLowerCase() || '';
        return !key.startsWith('utm_') && !trackingKeys.has(key);
    });
    if (kept.length === parts.length) return raw;
    return raw.slice(0, query) + (kept.length ? '?' + kept.join('&') : '') + raw.slice(end);
}
const markdown = unified().use(remarkParse).use(remarkGfm);
function mapUrls(text: string, transform: (url: string) => string): string {
    if (!/https?:\/\//i.test(text)) return text;
    // Keep Markdown delimiters outside URL replacements.
    const boundaries = new Set<number>([0, text.length]);
    function visit(node: Root | RootContent) {
        const start = node.position?.start.offset, end = node.position?.end.offset;
        if (start !== undefined && end !== undefined) {
            if (node.type === 'text') boundaries.add(end);
            if (node.type === 'inlineCode') {
                const closing = text.slice(start, end).match(/`+$/)![0].length;
                boundaries.add(end - closing);
                boundaries.add(end);
            }
        }
        if ('children' in node) for (const child of node.children) visit(child);
    }
    visit(markdown.parse(text));
    const offsets = [...boundaries].sort((a, b) => a - b);
    return offsets.slice(1).map((end, index) => mapUrlText(text.slice(offsets[index], end), transform)).join('');
}
function mapUrlText(text: string, transform: (url: string) => string): string {
    return text.replace(/https?:\/\/[^\s<>"\u201c\u201d]+/gi, match => {
        let candidate = match.replace(/[.,;!?]+$/, '');
        while (candidate.endsWith(')') && (candidate.match(/\)/g)?.length || 0) > (candidate.match(/\(/g)?.length || 0)) candidate = candidate.slice(0, -1);
        try { normalizeUrl(candidate); return transform(candidate) + match.slice(candidate.length); }
        catch { return match; }
    });
}
export function cleanSharedText(text: string, mode: UrlCleanup): string {
    return mode === 'off' ? text : mapUrls(text, url => cleanUrl(url, mode));
}
export function sharedUrls(...parts: string[]): string[] {
    const urls = new Set<string>();
    for (const part of parts) mapUrls(part, url => { urls.add(normalizeUrl(url)); return url; });
    return [...urls];
}
export function retainsArticle(item: ReadingItem, state: ReadingState) { return (item.readAt === null || !!item.articleHold) && (item.offline === 'keep' || (item.offline === 'auto' && state.autoDownload)); }
export function applyReadingOp(input: ReadingState, op: ReadingOp, check = true): ReadingState {
    const s = structuredClone(input);
    const item = s.items.find(i => i.id === op.itemId);
    if (op.kind === 'create') {
        const url = normalizeUrl(op.url!);
        if (item || s.items.some(i => i.contextId === op.contextId && i.urlKey === url))
            return s;
        if (!op.contextId)
            throw new Conflict('Conversation reference is required.');
        s.items.push({ id: op.itemId, contextId: op.contextId, url, urlKey: url, title: op.title?.trim() || url, createdAt: op.at, updatedAt: op.at, readAt: null, offline: 'auto', downloadVersion: 1 });
        s.unread.ids.unshift(op.itemId);
        s.unread.version++;
    }
    else if (op.kind === 'settings') {
        if (op.urlCleanup !== undefined) s.urlCleanup = op.urlCleanup;
        if (op.autoDownload !== undefined && op.autoDownload !== s.autoDownload) {
            s.autoDownload = op.autoDownload;
            for (const i of s.items) if (i.offline === 'auto') i.downloadVersion++;
        }
    }
    else {
        if (!item)
            throw new Conflict('This reading item is not available.');
        if (op.kind === 'title') {
            const title = op.title?.trim();
            if (!title || title.length > 2000)
                throw new Conflict('Enter a title of up to 2000 characters.');
            if (check && item.title !== op.baseTitle && item.title !== title)
                throw new Conflict('This reading title changed on another device.');
            item.title = title;
        }
        else if (op.kind === 'release') {
            if (!op.articleHold || item.articleHold !== op.articleHold) return s;
            delete item.articleHold;
            if (item.readAt !== null) item.downloadVersion++;
        }
        else if (op.kind === 'read') {
            if (check && item.readAt !== op.baseReadAt && (item.readAt !== null) !== op.read)
                throw new Conflict('This item changed on another device.');
            if ((item.readAt !== null) === op.read)
                return s;
            item.readAt = op.read ? op.restoreReadAt ?? op.at : null;
            if (!op.articleHold && !item.articleHold) item.downloadVersion++;
            item.articleHold = op.read ? op.articleHold : undefined;
            s.unread.ids = s.unread.ids.filter(id => id !== item.id);
            if (!op.read) {
                const position = op.beforeId === undefined ? 0 : op.beforeId === null ? s.unread.ids.length : s.unread.ids.indexOf(op.beforeId);
                s.unread.ids.splice(position < 0 ? s.unread.ids.length : position, 0, item.id);
            }
            s.unread.version++;
        }
        else if (op.kind === 'reorder') {
            if (item.readAt !== null)
                throw new Conflict('Read items are ordered by completion time.');
            if (check && op.listVersion !== s.unread.version)
                throw new Conflict('The reading list was reordered on another device.');
            if (op.beforeId && !s.unread.ids.includes(op.beforeId))
                throw new Conflict('The destination position changed.');
            if (op.beforeId === item.id)
                return s;
            s.unread.ids = s.unread.ids.filter(id => id !== item.id);
            s.unread.ids.splice(op.beforeId ? s.unread.ids.indexOf(op.beforeId) : op.beforeId === null ? s.unread.ids.length : 0, 0, item.id);
            s.unread.version++;
        }
        else {
            item.offline = op.offline!;
            item.downloadVersion++;
        }
        item.updatedAt = op.at;
    }
    return s;
}
