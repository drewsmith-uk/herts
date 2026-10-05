import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { History } from '../shared/core';
import { api, cacheRead, db, useApp } from './data';
import { isHistory, readHistory } from './historyCache';
import { conversationViewport } from './conversationViewport';

type Anchor = { key?: string; top: number };
type Memory = { pages: History[]; following: boolean; anchor?: Anchor; top: number };
const memory = new Map<string, Memory>();
const sameTail = (a?: History, b?: History) => !!a && !!b && a.sessionId === b.sessionId && a.hasMore === b.hasMore && JSON.stringify(a.messages) === JSON.stringify(b.messages);

export function useConversationHistory(conversationId: string, version: string | number, liveText?: string, active = false, sendVersion = 0, feedback = '') {
  const { connectionVersion } = useApp(), seenConnection = useRef(connectionVersion);
  const restored = useRef(memory.get(conversationId));
  const [pages, setPages] = useState<History[]>(restored.current?.pages || []), [cached, setCached] = useState(!!restored.current?.pages.length), [busy, setBusy] = useState(false), [error, setError] = useState(''), [newMessages, setNewMessages] = useState(false);
  const root = useRef<HTMLDivElement>(null), end = useRef<HTMLDivElement>(null);
  const currentPages = useRef(pages); currentPages.current = pages;
  const controller = useRef<AbortController | undefined>(undefined), request = useRef(0), loading = useRef(false), started = useRef(0);
  const following = useRef(restored.current?.following ?? true), readAnchor = useRef<Anchor | undefined>(restored.current?.anchor), pending = useRef<Anchor | 'latest' | undefined>(restored.current?.anchor);
  const buffered = useRef<History[] | undefined>(undefined), seenVersion = useRef(version), initialized = useRef(false), adjusting = useRef<number | undefined>(undefined);
  const held = useRef<{ element: Element; top: number } | undefined>(undefined);
  const viewport = () => conversationViewport(root.current);
  function anchor(): Anchor | undefined {
    const view = viewport(); if (!view) return;
    const top = view.getBoundingClientRect().top;
    const message = [...(root.current?.querySelectorAll<HTMLElement>('[data-history-message]') || [])].find(el => el.getBoundingClientRect().bottom > top + 8);
    return message ? { key: message.dataset.historyMessage, top: message.getBoundingClientRect().top - top } : undefined;
  }
  function move(top: number) {
    const view = viewport(); if (!view || Math.abs(view.scrollTop - top) < 1) return;
    view.scrollTop = top; adjusting.current = view.scrollTop;
  }
  function restore(target?: Anchor) {
    const view = viewport(); if (!view || !target) return;
    const message = [...(root.current?.querySelectorAll<HTMLElement>('[data-history-message]') || [])].find(el => el.dataset.historyMessage === target.key);
    if (message) move(view.scrollTop + message.getBoundingClientRect().top - view.getBoundingClientRect().top - target.top);
  }
  function scrollLatest() { const view = viewport(); if (view && currentPages.current.length) move(view.scrollHeight - view.clientHeight); }
  function apply(next: History[], isCached: boolean) {
    pending.current = following.current ? 'latest' : anchor();
    setPages(next); setCached(isCached); buffered.current = undefined; setNewMessages(false);
  }
  useLayoutEffect(() => {
    const target = pending.current; pending.current = undefined;
    if (target === 'latest') scrollLatest(); else if (target) restore(target); else if (following.current) scrollLatest();
    readAnchor.current = anchor();
  }, [pages, liveText, feedback]);
  useLayoutEffect(() => {
    if (!sendVersion) return;
    following.current = true;
    if (buffered.current) apply(buffered.current, cached); else scrollLatest();
  }, [sendVersion]);
  useEffect(() => {
    const view = viewport(); if (!view || !root.current) return;
    let frame = 0;
    const save = () => {
      if (!conversationId) return;
      memory.set(conversationId, { pages: currentPages.current, following: following.current, anchor: readAnchor.current, top: view.scrollTop });
      if (memory.size > 20) memory.delete(memory.keys().next().value!);
    };
    const scroll = () => {
      // Ignore only the position we set. A wheel scroll can arrive in the same
      // frame and must update the reader's anchor before a resize restores it.
      const adjusted = adjusting.current; adjusting.current = undefined;
      if (adjusted !== undefined && Math.abs(view.scrollTop - adjusted) < 1) return;
      following.current = view.scrollHeight - view.scrollTop - view.clientHeight < 64;
      readAnchor.current = anchor(); save();
      if (following.current && buffered.current) apply(buffered.current, cached);
    };
    const wheel = (event: WheelEvent) => { if (event.deltaY < 0) following.current = false; };
    const position = (event: Event) => {
      const { element, kind } = (event as CustomEvent).detail;
      following.current = false;
      if (kind === 'hold') held.current = { element, top: element.getBoundingClientRect().top };
      else if (kind === 'restore' && held.current) { move(view.scrollTop + held.current.element.getBoundingClientRect().top - held.current.top); held.current = undefined; readAnchor.current = anchor(); }
      else if (kind === 'reveal') { move(view.scrollTop + element.getBoundingClientRect().top - view.getBoundingClientRect().top - 12); readAnchor.current = anchor(); }
    };
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { if (following.current) scrollLatest(); else restore(readAnchor.current); save(); });
    });
    observer.observe(root.current); observer.observe(view);
    view.addEventListener('scroll', scroll, { passive: true }); view.addEventListener('wheel', wheel, { passive: true }); view.addEventListener('conversation-position', position);
    if (restored.current && !initialized.current) { move(restored.current.top); restore(restored.current.anchor); }
    return () => { save(); cancelAnimationFrame(frame); observer.disconnect(); view.removeEventListener('scroll', scroll); view.removeEventListener('wheel', wheel); view.removeEventListener('conversation-position', position); request.current++; controller.current?.abort(); };
  }, [conversationId]);
  async function fetchPage(offset: number, signal: AbortSignal) {
    return cacheRead(`history:${conversationId}:latest:${offset}`, () => api(`/conversations/${encodeURIComponent(conversationId)}/history?order=latest&offset=${offset}`, undefined, 'GET', 45000, signal), readHistory);
  }
  async function refreshTail(explicit = false, recover = false) {
    if (!conversationId || document.hidden || (!explicit && !navigator.onLine)) return;
    if (loading.current && !explicit && !(recover && Date.now() - started.current > 5000)) return;
    controller.current?.abort(); const control = new AbortController(); controller.current = control;
    const generation = ++request.current; loading.current = true; started.current = Date.now();
    if (explicit) { setBusy(true); setError(''); }
    try {
      const result = await fetchPage(0, control.signal); if (generation !== request.current) return;
      setError(''); setCached(result.cached);
      if (sameTail(currentPages.current.at(-1), result.value)) return;
      const next = [result.value], old = currentPages.current;
      // Refresh the loaded window, not just its tail. Fetch through its oldest
      // message so a burst of new replies cannot displace the reader's anchor.
      // Refetching also keeps attachment/read-aloud coordinates current.
      const oldest = old[0]?.messages[0]?.id;
      if ((old.length > 1 || !following.current) && oldest !== undefined && old[0].sessionId === result.value.sessionId) {
        while (next[0].hasMore && !next.some(page => page.messages.some(message => message.id === oldest))) {
          const older = await fetchPage(next.length * 200, control.signal); if (generation !== request.current) return;
          if (older.value.sessionId !== result.value.sessionId || !older.value.messages.length || older.value.messages[0].id === next[0].messages[0]?.id) break;
          next.unshift(older.value);
        }
      }
      if (following.current || !old.length || explicit) apply(next, result.cached);
      else { buffered.current = next; setNewMessages(true); }
    } catch (e) {
      if (generation !== request.current || control.signal.aborted) return;
      if (!currentPages.current.length) {
        const prefix = `history:${conversationId}:`;
        const saved = (await db.kv.toArray()).filter(row => row.key.startsWith(prefix) && /^\d+$/.test(row.key.slice(prefix.length))).map(row => row.value).filter(isHistory).sort((a, b) => a.offset - b.offset);
        if (generation !== request.current) return;
        if (saved.length) { apply(saved.map(page => ({ ...page, order: 'oldest', hasMore: false })), true); return; }
      }
      if (explicit || !currentPages.current.length) setError((e as Error).message);
    } finally { if (generation === request.current) { initialized.current = true; loading.current = false; setBusy(false); } }
  }
  async function latest() {
    following.current = true;
    if (buffered.current) apply(buffered.current, cached); else scrollLatest();
    await refreshTail(true);
  }
  useEffect(() => {
    if (!conversationId) return;
    let alive = true;
    // Read the device copy first; waiting for a failing network request makes the
    // page look empty and forces a second large reposition when history arrives.
    void (async () => {
      if (!currentPages.current.length) {
        const saved = (await db.kv.get(`history:${conversationId}:latest:0`))?.value;
        if (alive && isHistory(saved)) apply([saved], true);
      }
      if (alive) await refreshTail(true);
    })();
    return () => { alive = false; };
  }, [conversationId]);
  useEffect(() => { if (seenConnection.current !== connectionVersion) { seenConnection.current = connectionVersion; void refreshTail(false, true); } }, [conversationId, connectionVersion]);
  useEffect(() => {
    if (seenVersion.current === version) return; seenVersion.current = version;
    const timers = [150, 1500, 4000].map(delay => setTimeout(() => void refreshTail(), delay));
    return () => timers.forEach(clearTimeout);
  }, [conversationId, version]);
  useEffect(() => {
    if (!active && !cached && !error) return;
    const timer = setInterval(() => void refreshTail(), active ? 2000 : 8000); return () => clearInterval(timer);
  }, [conversationId, active, cached, error]);
  async function older() {
    const first = currentPages.current[0]; if (loading.current || !first?.hasMore || first.order !== 'latest') return;
    const control = new AbortController(); controller.current = control;
    const generation = ++request.current; loading.current = true; setBusy(true); setError(''); following.current = false;
    try {
      const result = await fetchPage(first.offset + 200, control.signal); if (generation !== request.current) return;
      if (result.value.sessionId !== first.sessionId) { loading.current = false; await refreshTail(true); return; }
      pending.current = anchor(); setPages(old => [result.value, ...old]); setCached(result.cached);
    } catch (e) { if (generation === request.current) setError((e as Error).message); }
    finally { if (generation === request.current) { loading.current = false; setBusy(false); } }
  }
  function pauseFollowing() { following.current = false; readAnchor.current = anchor(); }
  return { pages, cached, busy, error, setError, newMessages, latest, refresh: () => refreshTail(true), older, root, end, pauseFollowing };
}
