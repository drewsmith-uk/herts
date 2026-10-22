import { useEffect, useId, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { ActionRow, Button, FormDialog, FormField } from './ui';
import { useUpdatePreparation, useUpdateWork } from './updateSafety';
import { db } from './data';

export function RenameAction({ title, label, fieldLabel, maxLength = 2000, disabled, saveDisabled, draftKey, save }: {
  title: string; label: string; fieldLabel: string; maxLength?: number; disabled?: boolean; saveDisabled?: boolean; draftKey?: string;
  save(title: string, baseTitle: string): Promise<unknown>;
}) {
  const id = useId(), [draft, setDraft] = useState<{ text: string; base: string }>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const writes = useRef<Promise<unknown>>(Promise.resolve()), read = useRef(0);
  const work = useUpdateWork();
  useEffect(() => () => { read.current++; }, [draftKey]);
  useEffect(() => { setDraft(current => current && current.text === current.base ? { text: title, base: title } : current); }, [title]);
  useUpdatePreparation({ blocked: () => draft ? 'Save or cancel the title edit before updating.' : undefined });
  function persist(value?: { text: string; base: string }) {
    if (!draftKey) return Promise.resolve();
    const key = draftKey;
    const expected = draft;
    const pending = writes.current.catch(() => {}).then(() => db.transaction('rw', db.kv, async () => {
      if (value) await db.kv.put({ key, value });
      else if (JSON.stringify((await db.kv.get(key))?.value) === JSON.stringify(expected)) await db.kv.delete(key);
    }));
    writes.current = pending;
    return work(pending);
  }
  async function open() {
    const version = ++read.current;
    setBusy(true); setError('');
    try {
      await writes.current.catch(() => {});
      const saved = draftKey ? (await db.kv.get(draftKey))?.value : undefined;
      if (version === read.current) setDraft(saved && typeof saved.text === 'string' && typeof saved.base === 'string' ? saved : { text: title, base: title });
    } catch { if (version === read.current) { setDraft({ text: title, base: title }); setError('Device storage is unavailable. Keep this page open.'); } }
    finally { if (version === read.current) setBusy(false); }
  }
  async function cancel() {
    if (busy) return;
    setBusy(true);
    try { await persist(); setDraft(undefined); }
    catch { setError('The saved edit could not be cleared. Try again.'); }
    finally { setBusy(false); }
  }
  async function submit() {
    if (!draft || busy || disabled || saveDisabled || !draft.text.trim()) return;
    setBusy(true); setError('');
    try { await persist(draft); if (draft.text.trim() !== draft.base) await work(save(draft.text.trim(), draft.base)); await persist(); setDraft(undefined); }
    catch (error) { setError(error instanceof Error ? error.message : 'The title could not be saved. Try again.'); }
    finally { setBusy(false); }
  }
  return <><ActionRow icon={<Pencil size={20}/>} disabled={disabled || busy} onClick={() => { void open(); }}>{label}</ActionRow>
    {draft && <FormDialog id={id} title={label} close={() => { void cancel(); }} busy={busy} error={error || (saveDisabled ? 'Reconnect to save this title.' : '')}
      onSubmit={event => { event.preventDefault(); void submit(); }}
      footer={<div className="button-row"><Button disabled={busy} onClick={() => { void cancel(); }}>Cancel</Button><Button type="submit" variant="primary" disabled={busy || disabled || saveDisabled || !draft.text.trim()}>{busy ? 'Saving…' : 'Save'}</Button></div>}>
      <FormField htmlFor={`${id}-title`} label={fieldLabel}><textarea id={`${id}-title`} className="rename-title" autoFocus rows={3} maxLength={maxLength} value={draft.text} disabled={busy} onChange={event => {
        const value = { ...draft, text: event.target.value }; setDraft(value);
        void persist(value).catch(() => setError('The draft could not be saved. Keep this page open and try again.'));
      }}/></FormField>
    </FormDialog>}
  </>;
}
