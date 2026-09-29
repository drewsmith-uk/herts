import { useState } from 'react';
import { Copy, Trash2 } from 'lucide-react';
import { hasSavedMessage, savedMessageNotSent, type Action } from '../shared/core';
import { useApp } from './data';
import { deleteSavedMessage } from './savedMessages';
import { DialogFrame } from './ui';
import { useUpdateWork } from './updateSafety';

export function SavedMessages({ contextId, disabled, onCopy }: { contextId: string; disabled: boolean; onCopy: (action: Action) => Promise<void> }) {
  const state = useApp(), work = useUpdateWork();
  const [deleting, setDeleting] = useState<Action>(), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const messages = state.actions.filter(a => a.taskId === contextId && hasSavedMessage(a));
  async function remove() {
    if (!deleting || busy) return;
    setBusy(true); setError('');
    try { await deleteSavedMessage(deleting.id); setDeleting(undefined); setNotice('Saved message deleted.'); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="saved-messages">
    {notice && <p className="subtle-note" role="status">{notice}</p>}
    {messages.map(action => <details className="saved-message" key={action.id} data-saved-message={action.id}>
      <summary>{savedMessageNotSent(action) ? 'Saved message · not sent' : 'Saved submitted message'} · {new Date(action.createdAt).toLocaleString()}</summary>
      {action.text && <pre>{action.text}</pre>}
      {action.uploadIds.map((id, index) => <a key={id} href={`/api/v1/uploads/${id}`}>Download attachment{action.uploadIds.length > 1 ? ` ${index + 1}` : ''}</a>)}
      {!savedMessageNotSent(action) && <p>This message may already have been sent. Check the conversation before sending it again.</p>}
      <div className="button-row saved-message-actions">
        <button type="button" disabled={disabled || busy} onClick={() => void onCopy(action)}><Copy size={16}/> Use this message</button>
        <button type="button" className="danger-button" disabled={busy || !state.online} onClick={() => { setError(''); setDeleting(action); }}><Trash2 size={16}/> Delete</button>
      </div>
    </details>)}
    {!!messages.length && !state.online && <p className="subtle-note">Connect to delete saved messages.</p>}
    {deleting && <DialogFrame aria-labelledby="delete-saved-message-title" busy={busy} close={() => setDeleting(undefined)}>
      <h2 id="delete-saved-message-title">Delete saved message?</h2>
      <p>This removes the saved copy from Herts on all your devices. Your current draft and conversation history are kept.</p>
      {!savedMessageNotSent(deleting) && <p>It does not stop any work already sent to Hermes.</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="button-row"><button autoFocus disabled={busy} onClick={() => setDeleting(undefined)}>Cancel</button><button className="danger-button" disabled={busy || !state.online} onClick={() => void work(remove())}>{busy ? 'Deleting…' : 'Delete saved message'}</button></div>
    </DialogFrame>}
  </div>;
}
