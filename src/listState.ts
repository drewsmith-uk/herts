import { useEffect, useLayoutEffect, useState } from 'react';

const values = new Map<string, unknown>();
const positions = new Map<string, number>();
export function useListState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => values.has(key) ? values.get(key) as T : initial);
  useEffect(() => { values.set(key, value); }, [key, value]);
  return [value, setValue] as const;
}

/** Restore list position after its cached/network rows mount; user scrolling wins. */
export function useListPosition(path: string) {
  useLayoutEffect(() => {
    if (document.querySelector('.conversation-panel')) return;
    // Aliases such as Tasks and a space's Inbox refer to the same list.
    const listKey = () => document.querySelector<HTMLElement>('[data-list-position]')?.dataset.listPosition || path;
    let restoring = true, frame = 0;
    const restore = () => { if (restoring && !document.querySelector('.conversation-panel')) { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => window.scrollTo(0, Math.min(positions.get(listKey()) || 0, document.documentElement.scrollHeight - innerHeight))); } };
    const interact = () => { restoring = false; positions.set(listKey(), scrollY); };
    const remember = () => { if (!restoring && !document.querySelector('.conversation-panel')) positions.set(listKey(), scrollY); };
    const observer = new ResizeObserver(restore); observer.observe(document.querySelector('.page-content') || document.body);
    restore();
    addEventListener('wheel', interact, { passive: true }); addEventListener('touchstart', interact, { passive: true }); addEventListener('keydown', interact); addEventListener('pointerdown', interact, { passive: true }); addEventListener('scroll', remember, { passive: true });
    // The next screen may already have locked the document before cleanup runs.
    // Keep the position captured during interaction, before that layout change.
    return () => { observer.disconnect(); cancelAnimationFrame(frame); removeEventListener('wheel', interact); removeEventListener('touchstart', interact); removeEventListener('keydown', interact); removeEventListener('pointerdown', interact); removeEventListener('scroll', remember); };
  }, [path]);
}
