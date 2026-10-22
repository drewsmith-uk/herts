import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { refresh, resolveSubmission, useApp } from './data';

export function SubmissionRecovery({ id }: { id: string }) {
  const state = useApp(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const checking = !!state.checkingStatus && navigator.onLine;
  async function cancel() {
    if (busy) return;
    setBusy(true); setError('');
    try { await resolveSubmission(id); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="submission-recovery">
    <div className="submission-recovery-controls">
      <span className="submission-status" role="status">{checking ? 'Checking…' : 'Unconfirmed'}</span>
      <button type="button" className="text-button" disabled={checking || busy || !navigator.onLine} onClick={() => void refresh()}>Check again</button>
      <details>
        <summary aria-label="Message options"><MoreHorizontal size={18}/></summary>
        <button type="button" className="text-button" disabled={busy || checking || !navigator.onLine} onClick={() => void cancel()}>Cancel if not yet received</button>
      </details>
    </div>
    {error && <p className="inline-error" role="alert">{error}</p>}
  </div>;
}
