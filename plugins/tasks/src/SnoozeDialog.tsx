import { DialogFrame, FormField } from '@herts/plugin-api/client';
import { useState, type FormEvent } from 'react';
import { AlarmClock } from 'lucide-react';
import { spaceName, taskSpaceId, type Task } from './model';
import { snoozeTask, useApp } from './data';
const localValue = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
export function SnoozeDialog({ task, close }: {
    task: Task;
    close: () => void;
}) {
    const state = useApp();
    const [value, setValue] = useState(() => {
        if (task.snoozedUntil && task.snoozedUntil > Date.now())
            return localValue(new Date(task.snoozedUntil));
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(9, 0, 0, 0);
        return localValue(tomorrow);
    });
    const [error, setError] = useState(''), [busy, setBusy] = useState(false);
    async function save(event: FormEvent) {
        event.preventDefault();
        setError('');
        const date = new Date(value);
        if (!Number.isFinite(date.getTime()) || localValue(date) !== value || date.getTime() <= Date.now()) {
            setError('Choose a future date and time that exists in your local time zone.');
            return;
        }
        setBusy(true);
        try {
            await snoozeTask(task, date.getTime());
            close();
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    }
    return <DialogFrame className="snooze-dialog" aria-labelledby="snooze-heading" close={close} busy={busy} dismissOnBackdrop>
    <form onSubmit={save}><h2 id="snooze-heading"><AlarmClock size={21}/>{task.status === 'snoozed' ? 'Change reminder' : 'Snooze task'}</h2><p className="snooze-task-title">{task.title}</p>
      <FormField label="Remind me on"><input type="datetime-local" aria-label="Reminder date and time" value={value} min={localValue(new Date())} required onChange={e => setValue(e.target.value)}/></FormField>
      <p>Returns to the top of {spaceName(state.snapshot, taskSpaceId(task))} Inbox. Time zone: {Intl.DateTimeFormat().resolvedOptions().timeZone}.</p>
      <p className="subtle-note">Enable notifications on this device in <a href="#/settings" onClick={close}>Settings</a> to receive a reminder.</p>
      {!state.online && <p className="snooze-offline">Saved on this device first. The reminder will be scheduled when this change syncs.</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="button-row"><button type="button" disabled={busy} onClick={close}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : task.status === 'snoozed' ? 'Save reminder' : 'Snooze'}</button></div>
    </form>
  </DialogFrame>;
}
