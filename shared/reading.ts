import { Conflict, type Link, type List } from './model.js';

export interface ConversationContext { id: string; title: string; link: Link | null; aliases: string[] }
export interface ReadingItem {
  id: string; contextId: string; url: string; urlKey: string; title: string;
  createdAt: number; updatedAt: number; readAt: number | null;
  offline: 'auto' | 'keep' | 'remove'; downloadVersion: number;
}
export interface Article {
  itemId: string; version: number; url: string; title: string; byline: string; siteName: string;
  html: string; text: string; fetchedAt: number; status: 'saved' | 'excerpt' | 'unavailable'; warning: string;
}
export interface ReadingState { items: ReadingItem[]; unread: List; autoDownload: boolean }
export interface ReadingOp {
  id: string; itemId: string; kind: 'create' | 'title' | 'read' | 'reorder' | 'offline' | 'settings'; at: number;
  contextId?: string; conversationId?: string; url?: string; title?: string; read?: boolean;
  baseTitle?: string; baseReadAt?: number | null; beforeId?: string | null; listVersion?: number;
  offline?: ReadingItem['offline']; autoDownload?: boolean;
}
export const emptyReading = (): ReadingState => ({ items: [], unread: { ids: [], version: 0 }, autoDownload: true });
export function normalizeUrl(raw: string): string {
  let url: URL; try { url = new URL(raw.trim()); } catch { throw new Conflict('Enter a complete http or https link.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || raw.length > 8192) throw new Conflict('Use an http or https link without embedded credentials.');
  return url.href;
}
export function sharedUrls(...parts: string[]): string[] {
  const urls = new Set<string>();
  for (const part of parts) for (const match of part.matchAll(/https?:\/\/[^\s<>"\u201c\u201d]+/gi)) {
    let candidate = match[0].replace(/[.,;!?]+$/, '');
    while (candidate.endsWith(')') && (candidate.match(/\)/g)?.length || 0) > (candidate.match(/\(/g)?.length || 0)) candidate = candidate.slice(0, -1);
    try { urls.add(normalizeUrl(candidate)); } catch { /* Ignore non-web or credentialed shares. */ }
  }
  return [...urls];
}
export function retainsArticle(item: ReadingItem, state: ReadingState) { return item.readAt === null && (item.offline === 'keep' || (item.offline === 'auto' && state.autoDownload)); }
export function applyReadingOp(input: ReadingState, op: ReadingOp, check = true): ReadingState {
  const s = structuredClone(input); const item = s.items.find(i => i.id === op.itemId);
  if (op.kind === 'create') {
    const url = normalizeUrl(op.url!);
    if (item || s.items.some(i => i.contextId === op.contextId && i.urlKey === url)) return s;
    if (!op.contextId) throw new Conflict('Conversation reference is required.');
    s.items.push({ id: op.itemId, contextId: op.contextId, url, urlKey: url, title: op.title?.trim() || url, createdAt: op.at, updatedAt: op.at, readAt: null, offline: 'auto', downloadVersion: 1 });
    s.unread.ids.unshift(op.itemId); s.unread.version++;
  } else if (op.kind === 'settings') {
    s.autoDownload = op.autoDownload!;
    for (const i of s.items) if (i.offline === 'auto') i.downloadVersion++;
  } else {
    if (!item) throw new Conflict('This reading item is not available.');
    if (op.kind === 'title') {
      const title = op.title?.trim();
      if (!title || title.length > 2000) throw new Conflict('Enter a title of up to 2000 characters.');
      if (check && item.title !== op.baseTitle && item.title !== title) throw new Conflict('This reading title changed on another device.');
      item.title = title;
    } else if (op.kind === 'read') {
      if (check && item.readAt !== op.baseReadAt && (item.readAt !== null) !== op.read) throw new Conflict('This item changed on another device.');
      if ((item.readAt !== null) === op.read) return s;
      item.readAt = op.read ? op.at : null; item.downloadVersion++;
      s.unread.ids = s.unread.ids.filter(id => id !== item.id);
      if (!op.read) s.unread.ids.unshift(item.id);
      s.unread.version++;
    } else if (op.kind === 'reorder') {
      if (item.readAt !== null) throw new Conflict('Read items are ordered by completion time.');
      if (check && op.listVersion !== s.unread.version) throw new Conflict('The reading list was reordered on another device.');
      if (op.beforeId && !s.unread.ids.includes(op.beforeId)) throw new Conflict('The destination position changed.');
      if (op.beforeId === item.id) return s;
      s.unread.ids = s.unread.ids.filter(id => id !== item.id);
      s.unread.ids.splice(op.beforeId ? s.unread.ids.indexOf(op.beforeId) : op.beforeId === null ? s.unread.ids.length : 0, 0, item.id); s.unread.version++;
    } else { item.offline = op.offline!; item.downloadVersion++; }
    item.updatedAt = op.at;
  }
  return s;
}
