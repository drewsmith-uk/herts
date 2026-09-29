import { useEffect, useRef } from 'react';
import { db, saveConversationDraft, type Draft } from './data';

type Preparation = { pause?: () => void; settle?: () => Promise<unknown>; blocked?: () => string | undefined; save?: () => Promise<unknown> };
const preparations = new Set<() => Preparation>();

// Keep the latest form state without re-registering on every keystroke.
export function useUpdatePreparation(preparation: Preparation) {
  const current = useRef(preparation); current.current = preparation;
  useEffect(() => {
    const read = () => current.current;
    preparations.add(read);
    return () => { preparations.delete(read); };
  }, []);
}

export function useUpdateWork() {
  const pending = useRef<Promise<unknown>>(Promise.resolve());
  useUpdatePreparation({ settle: () => pending.current });
  return <T,>(work: Promise<T>) => { pending.current = work; return work; };
}

export function useDraftPersistence(target: {put:(draft:Draft)=>Promise<unknown>} = { put: saveConversationDraft }) {
  const latest = useRef<{ draft: Draft; saved: Promise<unknown> } | undefined>(undefined);
  useUpdatePreparation({ save: async () => {
    const write = latest.current;
    if (!write) return;
    try { await write.saved; }
    catch { await target.put(write.draft); }
    // Do not rewrite an already-saved draft from a stale render: another open
    // window may have edited it, or attached a file, in the meantime.
    if (latest.current === write) latest.current = undefined;
  } });
  return (draft: Draft) => {
    const write = { draft, saved: target.put(draft) };
    latest.current = write;
    void write.saved.then(() => { if (latest.current === write) latest.current = undefined; }, () => {});
    return write.saved;
  };
}

export async function prepareForUpdate() {
  // Stop local auto-send countdowns synchronously, before any storage waits.
  for (const read of preparations) read().pause?.();
  // Commit title fields that save on blur, then wait for already queued local
  // writes. Pending sync operations stay in IndexedDB; no network flush or
  // resubmission of Hermes messages is needed to reload safely.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  try {
    for (const read of preparations) await read().settle?.();
    await db.transaction('rw', db.tables, () => {});
  } catch { throw new Error('Your changes could not be saved on this device. Please try again before updating.'); }
  await new Promise(resolve => setTimeout(resolve, 0));
  if (document.querySelector('dialog[open]')) throw new Error('Finish or cancel the open dialog before updating.');
  for (const read of preparations) {
    const reason = read().blocked?.();
    if (reason) throw new Error(reason);
  }
  try {
    for (const read of preparations) await read().save?.();
    await db.transaction('rw', db.tables, () => {});
  } catch {
    throw new Error('Your changes could not be saved on this device. Please try again before updating.');
  }
}
