import { useEffect, useId, useState } from 'react';
import { Pencil } from 'lucide-react';
import { ActionRow, Button, FormDialog, FormField } from './ui';
import { useUpdatePreparation, useUpdateWork } from './updateSafety';

export function RenameAction({ title, label, fieldLabel, maxLength = 2000, disabled, save }: {
  title: string; label: string; fieldLabel: string; maxLength?: number; disabled?: boolean;
  save(title: string, baseTitle: string): Promise<unknown>;
}) {
  const id = useId(), [draft, setDraft] = useState<{ text: string; base: string }>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const work = useUpdateWork();
  useEffect(() => { setDraft(current => current && current.text === current.base ? { text: title, base: title } : current); }, [title]);
  useUpdatePreparation({ blocked: () => draft ? 'Save or cancel the title edit before updating.' : undefined });
  async function submit() {
    if (!draft || busy || disabled || !draft.text.trim()) return;
    setBusy(true); setError('');
    try { if (draft.text.trim() !== draft.base) await work(save(draft.text.trim(), draft.base)); setDraft(undefined); }
    catch (error) { setError(error instanceof Error ? error.message : 'The title could not be saved. Try again.'); }
    finally { setBusy(false); }
  }
  return <><ActionRow icon={<Pencil size={20}/>} disabled={disabled} onClick={() => { setDraft({ text: title, base: title }); setError(''); }}>{label}</ActionRow>
    {draft && <FormDialog id={id} title={label} close={() => setDraft(undefined)} busy={busy} error={error}
      onSubmit={event => { event.preventDefault(); void submit(); }}
      footer={<div className="button-row"><Button disabled={busy} onClick={() => setDraft(undefined)}>Cancel</Button><Button type="submit" variant="primary" disabled={busy || disabled || !draft.text.trim()}>{busy ? 'Saving…' : 'Save'}</Button></div>}>
      <FormField htmlFor={`${id}-title`} label={fieldLabel}><textarea id={`${id}-title`} className="rename-title" autoFocus rows={3} maxLength={maxLength} value={draft.text} disabled={busy} onChange={event => setDraft({ ...draft, text: event.target.value })}/></FormField>
    </FormDialog>}
  </>;
}
