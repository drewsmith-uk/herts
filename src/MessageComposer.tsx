import { createPortal } from 'react-dom';
import { cleanLocalFiles } from './fileRetention';
import { liveQuery } from 'dexie';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, LoaderCircle, Paperclip, Send, X } from 'lucide-react';
import type { Action } from '../shared/core';
import type { ConversationContext } from '../shared/conversations';
import { addFile, createLocalConversation, db, getState, refresh, resolveSubmission, saveConversationDraft, submit, useApp, type Draft, type LocalFile } from './data';
import { copySavedMessage } from './savedMessages';
import { SavedMessages } from './SavedMessages';
import { SessionSettingsControls } from './SessionSettings';
import { Voice } from './Voice';
import { useDraftPersistence, useUpdatePreparation } from './updateSafety';

export interface MessageComposerProps {
  context: ConversationContext;
  initialText?: string;
  canSend?: boolean;
  docked?: boolean;
  fields?: ReactNode | ((draft: Draft) => ReactNode);
  persist?: (draft: Draft) => Promise<unknown>;
  prepare?: (draft: Draft) => Promise<void>;
  saveLabel?: string;
  allowSaveEmpty?: boolean;
  onSaved?: () => void | Promise<void>;
  onSending?: () => void;
  onSent?: () => void | Promise<void>;
  owner?: string;
  voiceOwner?: string;
  recordRequest?: string;
  savedMessagesHost?: HTMLElement | null;
}
export function MessageComposer({ context, initialText = '', canSend = true, docked = false, fields, persist, prepare, saveLabel, allowSaveEmpty = false, onSaved, onSending, onSent, owner, voiceOwner, recordRequest, savedMessagesHost }: MessageComposerProps) {
  const state = useApp(), [draft, setDraft] = useState<Draft>({ id: context.id, text: initialText, files: [] });
  const [files, setFiles] = useState<LocalFile[]>([]), [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [dirty, setDirty] = useState(false);
  const [recording, setRecording] = useState(false), [expanded, setExpanded] = useState(!docked), [settingsOpen, setSettingsOpen] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null), input = useRef<HTMLInputElement>(null), root = useRef<HTMLDivElement>(null);
  const focusAfterSave = useRef(false);
  const reconciled = useRef(new Set<string>());
  const recovery = useRef<{ id: string; draft: Draft } | undefined>(undefined);
  const draftRef = useRef(draft), working = useRef(false), attaching = useRef(false), voiceBusy = useRef(false), write = useRef(0);
  const ensure = async () => { if (!getState().snapshot.contexts.some(c => c.id === context.id)) await createLocalConversation(context.title, context.id); };
  const persistDraft = async (next: Draft) => { if (persist) return persist(next); await saveConversationDraft(next); await ensure(); };
  const saveDraft = useDraftPersistence({ put: persistDraft });
  useUpdatePreparation({ blocked: () => working.current || attaching.current ? 'Wait for your message or attachment to finish saving before updating.' : undefined });
  useEffect(() => {
    const subscription = liveQuery(() => db.drafts.get(context.id)).subscribe({ next: value => {
      if (!dirty) { const next = value || { id: context.id, text: initialText, files: [] }; setDraft(next); draftRef.current = next; }
      setLoaded(true);
    }, error: () => setError('Your draft could not be opened. Reload to try again.') });
    return () => subscription.unsubscribe();
  }, [context.id, dirty]);
  useEffect(() => { let alive = true; void db.files.bulkGet(draft.files).then(rows => { if (alive) setFiles(rows.filter(Boolean) as LocalFile[]); }); return () => { alive = false; }; }, [draft.files.join(',')]);
  useLayoutEffect(() => { const el = textarea.current; if (!el) return; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 156)}px`; }, [draft.text, expanded]);
  useLayoutEffect(() => {
    // Restoring a saved message disables the editor while it is saved. Focus
    // only after React has committed the enabled editor, including on slow devices.
    if (focusAfterSave.current && loaded && !busy && expanded) {
      focusAfterSave.current = false; textarea.current?.focus({ preventScroll: true });
    }
  });
  async function update(next: Draft) {
    const removed = draftRef.current.files.filter(id => !next.files.includes(id));
    const sequence = ++write.current; draftRef.current = next; setDraft(next); setDirty(true); setNotice('');
    try { await saveDraft(next); if (sequence === write.current) setDirty(false); }
    catch { setError('Could not save your draft. Keep this page open until device storage is available.'); throw new Error('Draft storage unavailable'); }
    // Cleanup must not turn a successfully saved message into a failed send.
    if (removed.length) void cleanLocalFiles(removed).catch(() => {});
  }
  function open(focus = true) { focusAfterSave.current = focus; setExpanded(true); }
  async function attach(selected: FileList | null) {
    if (!selected || working.current || attaching.current) return;
    attaching.current = true; setBusy(true); setError(''); open(false);
    try { const ids = []; for (const file of Array.from(selected)) ids.push(await addFile(file, file.name, owner)); await update({ ...draftRef.current, files: [...draftRef.current.files, ...ids], submissionId: undefined }); }
    catch (e) { setError((e as Error).message); }
    finally { attaching.current = false; setBusy(false); if (input.current) input.current.value = ''; }
  }
  const uncertain = state.localSubmissions.some(s => s.taskId === context.id);
  const currentRun = state.actions.find(a => !a.cancelled && a.taskId === context.id && ['send', 'continue'].includes(a.kind));
  const running = currentRun && !state.bindings[context.id]?.unavailable && !['finished', 'failed', 'ready', 'unknown'].includes(currentRun.state);
  const allowed = !running && loaded && !recording && !busy && !uncertain && canSend && state.online && state.gateway.online;
  async function commit(send: boolean) {
    if (working.current || attaching.current || voiceBusy.current || settingsOpen || !loaded || (send && (!allowed || document.hidden))) return;
    const current = draftRef.current; if (!current.text.trim() && !current.files.length && (send || !allowSaveEmpty)) return;
    working.current = true; setBusy(true); setError('');
    try {
      await persistDraft(current); await prepare?.(current);
      if (send) {
        onSending?.();
        const id = crypto.randomUUID();
        const submitted = { ...current, submissionId: id }; await update(submitted);
        recovery.current = { id, draft: submitted };
        await submit({ id, contextId: context.id, kind: 'send', text: current.text, uploadIds: current.files });
        recovery.current = undefined;
        await update({ id: context.id, text: '', files: [] });
        setExpanded(false); await onSent?.();
      } else { await onSaved?.(); setNotice('Saved. Your message has not been sent.'); }
    } catch (e) { setError((e as Error).message); open(false); }
    finally { working.current = false; setBusy(false); }
  }
  // A lost HTTP reply can be followed by a confirmed receipt over the event stream.
  // Finish this same send; never repeat it or leave its text ready to send twice.
  useEffect(() => {
    const pending = recovery.current || (loaded && draft.submissionId ? { id: draft.submissionId, draft } : undefined);
    if (!pending || working.current || reconciled.current.has(pending.id)) return;
    const action = state.actions.find(a => a.id === pending.id);
    if (action?.receipt === 'rejected') { recovery.current = undefined; reconciled.current.add(pending.id); void update({ ...draftRef.current, submissionId: undefined }).catch(() => {}); return; }
    if (action?.receipt !== 'accepted') return;
    recovery.current = undefined; reconciled.current.add(pending.id); working.current = true; setBusy(true);
    void (async () => {
      const unchanged = action.text === draftRef.current.text && JSON.stringify(action.uploadIds) === JSON.stringify(draftRef.current.files);
      await update(unchanged ? { id: context.id, text: '', files: [] } : { ...draftRef.current, submissionId: undefined });
      setError('');
      if (unchanged) { setExpanded(false); await onSent?.(); } else setNotice('Your previous message was sent. Your new draft is still here.');
    })().catch(e => setError((e as Error).message)).finally(() => { working.current = false; setBusy(false); });
  }, [state.actions, busy, loaded, draft.submissionId]);
  async function restore(action: Action) {
    if (working.current || attaching.current || voiceBusy.current) return;
    working.current = true; setBusy(true); setError('');
    try { const next = await copySavedMessage(action, draftRef.current); setDraft(next); draftRef.current = next; open(); setNotice('Added to your draft.'); }
    catch (e) { setError((e as Error).message); }
    finally { working.current = false; setBusy(false); }
  }
  const hasDraft = !!draft.text.trim() || !!draft.files.length;
  const draftStatus = dirty ? 'Saving draft…' : !state.online ? 'Offline. Your draft stays on this device.' : !state.gateway.online ? 'Hermes is unavailable. Your draft is saved.' : hasDraft ? 'Draft saved on this device · Not sent' : '';
  return <div ref={root} className={`composer-wrap ${docked ? 'composer-docked' : 'composer-entry'} ${expanded ? 'is-expanded' : 'is-collapsed'}`}>
    <div className="composer-expanded">
      <div className="composer-settings-row"><SessionSettingsControls context={context} onOpen={() => { void ensure(); setSettingsOpen(true); }} onClose={() => setSettingsOpen(false)}/>{docked && <button className="icon-button composer-collapse" aria-label="Collapse message box" onClick={() => { textarea.current?.blur(); setExpanded(false); }}><ChevronDown size={20}/></button>}</div>
      {typeof fields === 'function' ? fields(draft) : fields}
    </div>
    <form className="composer" onSubmit={event => { event.preventDefault(); void commit(true); }}>
      <textarea ref={textarea} onFocus={() => setExpanded(true)} aria-label={`Message ${context.botChat ? context.title : 'Hermes'}`} placeholder={`Message ${context.botChat ? context.title : 'Hermes'}…`} value={draft.text} disabled={!loaded || busy} onChange={event => { void update({ ...draftRef.current, text: event.target.value, submissionId: undefined }).catch(() => {}); }} rows={3} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void commit(true); } }}/>
      {files.length > 0 && <div className="attachment-list">{files.map(file => <span className="attachment" key={file.id}><Paperclip size={13}/>{file.name}<small>{Math.ceil(file.blob.size / 1024)} KB</small><button type="button" className="icon-button" aria-label={`Remove ${file.name}`} disabled={busy} onClick={() => void update({ ...draftRef.current, files: draftRef.current.files.filter(id => id !== file.id), submissionId: undefined }).catch(() => {})}><X size={14}/></button></span>)}</div>}
      <div className="composer-tools"><div className="button-row"><button type="button" className="icon-button" aria-label="Attach files" disabled={busy} onClick={() => { open(false); input.current?.click(); }}><Paperclip size={20}/></button><input type="file" ref={input} hidden multiple onChange={event => void attach(event.target.files)}/><Voice owner={voiceOwner || `chat:${context.id}`} disabled={busy || !loaded} startRequest={recordRequest} onModeChange={mode => { voiceBusy.current = mode !== 'idle'; setRecording(mode !== 'idle'); if (mode !== 'idle') open(false); }} onRecording={() => persistDraft(draftRef.current)} onTranscript={text => update({ ...draftRef.current, text: [draftRef.current.text, text].filter(Boolean).join('\n'), submissionId: undefined }).then(() => { open(false); })}/></div>
        <div className="composer-submit"><button type="submit" className="primary-button send-button" disabled={!allowed || !hasDraft}>{busy ? <LoaderCircle size={16} className="spin"/> : <Send size={16}/>} Send</button>{saveLabel && <button type="button" disabled={!loaded || recording || busy || uncertain || (!hasDraft && !allowSaveEmpty)} onClick={() => void commit(false)}>{saveLabel}</button>}</div>
      </div>
    </form>
    {(error || notice || uncertain || draftStatus) && <div className="composer-expanded">
      {error && <p className="inline-error" role="alert">{error}</p>}{notice && <p className="subtle-note" role="status">{notice}</p>}
      {uncertain && <div className="error-banner">Your submission is not confirmed. Check its status before sending again. <button className="text-button" onClick={() => void refresh()}>Check status</button>{state.localSubmissions.filter(s => s.taskId === context.id).map(s => <button className="text-button" key={s.id} onClick={() => void resolveSubmission(s.id).catch(e => setError(e.message))}>Cancel if not yet received</button>)}</div>}
      {draftStatus && <p className="composer-note" role="status">{draftStatus}</p>}
    </div>}
    {savedMessagesHost ? createPortal(<SavedMessages contextId={context.id} disabled={!loaded || busy} onCopy={restore}/>, savedMessagesHost) : <SavedMessages contextId={context.id} disabled={!loaded || busy} onCopy={restore}/>}
  </div>;
}
