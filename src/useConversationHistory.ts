import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { History } from '../shared/core';
import { api, cacheRead, db } from './data';

type ScrollTarget = { kind: 'latest' } | { kind: 'anchor'; key?: string; top: number };
const sameTail = (a?: History, b?: History) => !!a && !!b && a.sessionId === b.sessionId && a.hasMore === b.hasMore && JSON.stringify(a.messages) === JSON.stringify(b.messages);

export function useConversationHistory(conversationId: string, version: string | number, liveText?: string, active = false, sendVersion = 0, feedback = '') {
  const [pages, setPages] = useState<History[]>([]), [cached, setCached] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [newMessages, setNewMessages] = useState(false);
  const root = useRef<HTMLDivElement>(null), end = useRef<HTMLDivElement>(null);
  const currentPages = useRef(pages); currentPages.current = pages;
  const request = useRef(0), pendingScroll = useRef<ScrollTarget | null>(null), following = useRef(true), loading = useRef(false);
  const buffered = useRef<{ value: History; cached: boolean } | undefined>(undefined), gestureUntil = useRef(0), seenVersion = useRef(version);
  const bottomTarget = () => root.current?.closest('.task-detail, .reading-detail, .conversation-detail')?.querySelector('.composer-wrap') || end.current;
  const bottomGap = () => (document.querySelector('.mobile-nav')?.getBoundingClientRect().height || 0) + 24;
  function anchor(): ScrollTarget {
    const message = [...(root.current?.querySelectorAll<HTMLElement>('[data-history-message]') || [])].find(el => el.getBoundingClientRect().bottom > 0);
    return { kind: 'anchor', key: message?.dataset.historyMessage, top: message?.getBoundingClientRect().top || 0 };
  }
  function scrollLatest() {
    const target = bottomTarget(); if (!target) return;
    window.scrollTo({ top: window.scrollY + target.getBoundingClientRect().bottom - window.innerHeight + bottomGap(), behavior: 'instant' });
  }
  function showBuffered() {
    if (!buffered.current) return;
    const result = buffered.current; buffered.current = undefined;
    pendingScroll.current = { kind: 'latest' }; setPages([result.value]); setCached(result.cached); setNewMessages(false);
  }
  useEffect(() => {
    let scrollbar = false;
    const gesture = () => { gestureUntil.current = Date.now() + 1000; };
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || (event.target instanceof Element && event.target.closest('input, textarea, select, button, a, [contenteditable="true"]'))) return;
      if (['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key)) gesture();
    };
    const pointerDown = (event: PointerEvent) => { scrollbar = event.clientX >= document.documentElement.clientWidth; };
    const pointerUp = () => { scrollbar = false; };
    const onScroll = () => {
      // Layout changes, focusing the composer and opening activity are not a
      // request to stop following. Only deliberate page scrolling changes it.
      if (!scrollbar && Date.now() > gestureUntil.current) return;
      const target = bottomTarget();
      if (currentPages.current.length && target) {
        following.current = target.getBoundingClientRect().bottom <= window.innerHeight - bottomGap() + 80;
        if (following.current) showBuffered();
      }
    };
    window.addEventListener('wheel', gesture, { passive: true }); window.addEventListener('touchmove', gesture, { passive: true });
    window.addEventListener('keydown', key); window.addEventListener('pointerdown', pointerDown); window.addEventListener('pointerup', pointerUp);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('wheel', gesture); window.removeEventListener('touchmove', gesture); window.removeEventListener('keydown', key);
      window.removeEventListener('pointerdown', pointerDown); window.removeEventListener('pointerup', pointerUp); window.removeEventListener('scroll', onScroll);
      request.current++;
    };
  }, [conversationId]);
  useLayoutEffect(() => {
    const target = pendingScroll.current; pendingScroll.current = null;
    if (target?.kind === 'anchor') {
      const message = [...(root.current?.querySelectorAll<HTMLElement>('[data-history-message]') || [])].find(el => el.dataset.historyMessage === target.key);
      if (message) window.scrollBy({ top: message.getBoundingClientRect().top - target.top, behavior: 'instant' });
    } else if (target?.kind === 'latest' || following.current) scrollLatest();
  }, [pages, liveText, feedback]);
  useLayoutEffect(() => {
    if (!sendVersion) return;
    following.current = true; gestureUntil.current = 0; setNewMessages(false); showBuffered(); scrollLatest();
  }, [sendVersion]);
  async function fetchPage(offset: number) {
    return cacheRead(`history:${conversationId}:latest:${offset}`, () => api(`/conversations/${encodeURIComponent(conversationId)}/history?order=latest&offset=${offset}`));
  }
  async function refreshTail(explicit = false) {
    if (!explicit && (loading.current || document.hidden || !navigator.onLine)) return;
    const generation = ++request.current; loading.current = true;
    if (explicit) { setBusy(true); setError(''); }
    try {
      const result = await fetchPage(0); if (generation !== request.current) return;
      if (sameTail(currentPages.current.at(-1), result.value)) { setCached(result.cached); return; }
      if (following.current || !currentPages.current.length) {
        pendingScroll.current = { kind: 'latest' }; setPages([result.value]); setCached(result.cached); setNewMessages(false); buffered.current = undefined;
      } else {
        // Keep reading/expanded activity in place, but fetch new history now so
        // the latest-messages button can display it immediately.
        buffered.current = result; setNewMessages(true);
      }
    } catch (e) {
      if (generation !== request.current || !explicit) return;
      // Keep history saved by the original oldest-first client accessible after an offline update.
      const prefix = `history:${conversationId}:`;
      const saved = (await db.kv.toArray()).filter(row => row.key.startsWith(prefix) && /^\d+$/.test(row.key.slice(prefix.length))).map(row => row.value as History).sort((a, b) => a.offset - b.offset);
      if (generation !== request.current) return;
      if (saved.length && !currentPages.current.length) { pendingScroll.current = { kind: 'latest' }; setPages(saved.map(page => ({ ...page, order: 'oldest', hasMore: false }))); setCached(true); }
      else setError((e as Error).message);
    } finally { if (generation === request.current) { loading.current = false; setBusy(false); } }
  }
  async function latest() {
    following.current = true; gestureUntil.current = 0; setNewMessages(false); showBuffered(); scrollLatest();
    await refreshTail(true);
  }
  useEffect(() => { void latest(); }, [conversationId]);
  useEffect(() => {
    if (seenVersion.current === version) return;
    seenVersion.current = version;
    // Read after event/receipt changes, then again after persistence has caught
    // up. One request at a time; token streaming does not trigger this effect.
    const timers = [150, 1500, 4000].map(delay => setTimeout(() => void refreshTail(), delay));
    return () => timers.forEach(clearTimeout);
  }, [conversationId, version]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void refreshTail(), 2000);
    const visible = () => { if (!document.hidden) void refreshTail(); };
    document.addEventListener('visibilitychange', visible); window.addEventListener('online', visible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visible); window.removeEventListener('online', visible); };
  }, [conversationId, active]);
  async function older() {
    if (loading.current) return;
    const first = currentPages.current[0]; if (!first?.hasMore || first.order !== 'latest') return;
    const generation = ++request.current; loading.current = true; setBusy(true); setError(''); following.current = false;
    try {
      const result = await fetchPage(first.offset + 200); if (generation !== request.current) return;
      if (result.value.sessionId !== first.sessionId) { await latest(); return; }
      pendingScroll.current = anchor(); setPages(old => [result.value, ...old]); setCached(result.cached);
    } catch (e) { if (generation === request.current) setError((e as Error).message); }
    finally { if (generation === request.current) { loading.current = false; setBusy(false); } }
  }
  function pauseFollowing() { following.current = false; gestureUntil.current = 0; }
  return { pages, cached, busy, error, setError, newMessages, latest, older, root, end, pauseFollowing };
}
