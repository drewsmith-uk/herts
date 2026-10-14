import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from './ui';

type Notice = { id: number; key: string; message: string; undo?: () => Promise<unknown> };
let notices: Notice[] = [], sequence = 0;
const listeners = new Set<() => void>(), pending = new Set<string>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => notices;
function emit() { for (const listener of listeners) listener(); }
function remove(id: number) { notices = notices.filter(notice => notice.id !== id); emit(); }
export async function undoableAction(key: string, message: string, action: () => Promise<unknown>, undo: () => Promise<unknown>) {
    if (pending.has(key)) return;
    pending.add(key);
    try {
        await action();
        notices = [...notices.filter(notice => notice.key !== key), { id: ++sequence, key, message, undo }];
    } catch (error) {
        notices = [...notices, { id: ++sequence, key, message: (error as Error).message || 'Could not save the change.' }];
    } finally { pending.delete(key); emit(); }
}
export function UndoToasts() {
    const queue = useSyncExternalStore(subscribe, snapshot);
    return queue[0] ? <UndoToast key={queue[0].id} notice={queue[0]}/> : null;
}
function UndoToast({ notice }: { notice: Notice }) {
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    const working = useRef(false);
    useEffect(() => {
        if (busy || error || !notice.undo) return;
        const timer = setTimeout(() => remove(notice.id), 5000);
        return () => clearTimeout(timer);
    }, [notice, busy, error]);
    async function undo() {
        if (working.current) return;
        working.current = true; setBusy(true);
        try { await notice.undo!(); remove(notice.id); }
        catch (failure) { setError((failure as Error).message || 'Could not undo the change. Check the list.'); }
        finally { setBusy(false); }
    }
    return <section className="undo-toast" aria-label="Recent change">
        <span role={error || !notice.undo ? 'alert' : 'status'}>{error || (busy ? 'Undoing…' : notice.message)}</span>
        {notice.undo && !error ? <Button variant="quiet" disabled={busy} onClick={() => void undo()}>Undo</Button> : <Button variant="quiet" onClick={() => remove(notice.id)}>Dismiss</Button>}
        {!busy && !error && notice.undo && <span className="undo-toast-timer" aria-hidden="true"/>}
    </section>;
}
