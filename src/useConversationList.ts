import { useEffect, useState } from 'react';
import { messageText, type Conversation } from '../shared/core';
import { api, db, useApp } from './data';

interface Selection { query: string; showAll: boolean; filterKey: string; offset: number }
interface Page { conversations: Conversation[]; hasMore: boolean }
interface Result {
  selection: string;
  rows: Conversation[];
  busy: boolean;
  cached: boolean;
  more: boolean;
  error: string;
}
const cacheKey = ({ query, showAll, filterKey }: Selection, offset: number) => `conversations:plugins:${filterKey}:${showAll}:${query}:${offset}`;
const offsets = (offset: number) => Array.from({ length: offset / 50 + 1 }, (_, i) => i * 50);
const isConversation = (c: any): c is Conversation => !!c && ['key', 'id', 'title', 'preview', 'source'].every(key => typeof c[key] === 'string') && Number.isFinite(c.updatedAt) && Array.isArray(c.aliases) && c.aliases.every((id: unknown) => typeof id === 'string');
function unique(rows: Conversation[]) {
  const found = new Map<string, Conversation>();
  for (const row of rows) if (!found.has(row.key) || found.get(row.key)!.updatedAt <= row.updatedAt) found.set(row.key, row);
  return [...found.values()];
}
function pageRows(pages: Page[]) {
  const last = pages.findIndex(page => !page.hasMore);
  return unique((last < 0 ? pages : pages.slice(0, last + 1)).flatMap(page => page.conversations));
}

async function savedConversations(selection: Selection, fallback = false) {
  const lists = (await db.kv.where('key').startsWith('conversations:').toArray())
    .filter(row => Array.isArray(row.value?.conversations));
  const pages = offsets(selection.offset).map(offset => lists.find(row => row.key === cacheKey(selection, offset))?.value as Page | undefined);
  const exact = pages.filter((page): page is Page => !!page).map(page => ({ ...page, conversations: page.conversations.filter(isConversation) }));
  // Keep an empty result for the selected query instead of adding rows from other cached lists.
  if (!fallback && exact.length) return pageRows(exact);
  const known = new Set(pageRows(exact).map(c => c.key));
  const all = unique(lists.flatMap(row => row.value.conversations).filter(isConversation));
  const query = selection.query.toLowerCase();
  const histories = query ? await db.kv.where('key').startsWith('history:').toArray() : [];
  return all.filter(c => !query || known.has(c.key) || `${c.title} ${c.preview} ${histories
    .filter(entry => c.aliases.some(id => entry.key.startsWith(`history:${id}:`)))
    .flatMap(entry => Array.isArray(entry.value?.messages) ? entry.value.messages : [])
    .filter(message => !!message && typeof message === 'object')
    .map(messageText).join(' ')}`.toLowerCase().includes(query))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function useConversationList({ query, showAll, filterKey, offset }: Selection, version: string) {
  const { online, connectionVersion } = useApp();
  const selection = JSON.stringify([query, showAll, filterKey]);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<Result>({ selection, rows: [], busy: true, cached: false, more: false, error: '' });
  useEffect(() => {
    let alive = true, settled = false;
    const controller = new AbortController();
    const current = { query, showAll, filterKey, offset };
    setResult(old => ({ selection, rows: old.selection === selection ? old.rows : [], busy: true, cached: false, more: false, error: '' }));
    // Read cached rows before the request delay ends.
    // Keep existing rows during refresh and pagination. Never replace a server response with a late cache read.
    void savedConversations(current).then(rows => {
      if (alive && !settled) setResult(old => old.rows.length ? old : { ...old, rows, cached: true });
    }).catch(() => { /* Storage is optional; continue loading from the server. */ });
    const timer = setTimeout(() => {
      void Promise.all(offsets(offset).map(async offset => {
        const value: Page = await api(`/conversations?q=${encodeURIComponent(query)}&offset=${offset}&includeLinked=true&includeHidden=${showAll}&filters=${encodeURIComponent(filterKey)}`, undefined, 'GET', 45000, controller.signal);
        if (alive) await db.kv.put({ key: cacheKey(current, offset), value: { ...value, query } }).catch(() => {});
        return value;
      })).then(pages => {
        settled = true;
        if (alive) setResult({ selection, rows: pageRows(pages), busy: false, cached: false, more: pages.every(page => page.hasMore), error: '' });
      }).catch(async (error: Error) => {
        settled = true;
        const saved = await savedConversations(current, true).catch(() => []);
        if (alive) setResult(old => {
          const rows = unique([...old.rows, ...saved]).sort((a, b) => b.updatedAt - a.updatedAt);
          return { selection, rows, busy: false, cached: true, more: false, error: rows.length ? '' : error.message };
        });
      });
    }, 250);
    return () => { alive = false; controller.abort(); clearTimeout(timer); };
  }, [selection, query, showAll, filterKey, offset, version, connectionVersion, retry]);
  const current = result.selection === selection;
  const busy = !current || result.busy, cached = current && result.cached, error = current ? result.error : '';
  useEffect(() => {
    if (busy || (!cached && !error) || !online) return;
    const timer = setInterval(() => { if (!document.hidden && navigator.onLine) setRetry(n => n + 1); }, 8000);
    return () => clearInterval(timer);
  }, [busy, cached, error, online]);
  return { rows: current ? result.rows : [], busy, cached, error, more: current && result.more };
}
