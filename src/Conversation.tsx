import { NotificationSettings } from './NotificationSettings';
import { AppUpdateSettings } from './AppUpdates';
import { NotificationLanding } from './NotificationLanding';
import { outgoingInHistory, outgoingStatus, type OutgoingMessage } from './transcriptFeedback';
import { liveQuery } from 'dexie';
import type { ConversationContext } from '../shared/conversations';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Inbox, ArrowRight, Clock3, Pause, Check, Plus, Search, MessageSquare, Settings, ChevronLeft, ArrowUp, ArrowDown, AlarmClock, Pencil, CheckCheck, WifiOff, Link2, Send, Paperclip, X, Square, RefreshCw, Volume2, Circle, LoaderCircle, Eye, EyeOff, BookOpen } from 'lucide-react';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Voice } from './Voice';
import { MessageMedia } from './Media';
import { useConversationHistory } from './useConversationHistory';
import { groupHistory, type HistoryEntry, type HistoryGroup } from './historyGroups';
import { HistoryDisclosure } from './HistoryDisclosure';
import { ConversationHeader } from './ConversationHeader';
import { ConversationRow } from './ConversationRow';
import { useDraftPersistence, useUpdatePreparation, useUpdateWork } from './updateSafety';
import { SessionSettingsControls } from './SessionSettings';

import {messageText,type Action,type Conversation,type History} from '../shared/core';
import {db,useApp,addFile,submit,refresh,resolveSubmission,api,cacheRead,saveSessionChoices,type Draft,type LocalFile} from './data';
import {ConversationContributions,MessageLinkContributions} from './plugins';

function time(at:number){return new Date(at).toLocaleString();}
const messageTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
function MessageTime({ timestamp }: { timestamp?: number }) {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) return null;
  const date = new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  return <time className="message-time" dateTime={date.toISOString()} title={date.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' })}>{messageTimeFormat.format(date)}</time>;
}
const finished = (a?: Action) => !!a && ['finished','failed','ready','unknown'].includes(a.state);

export function ConversationPanel({ context: task, initialText = '', showActions = true }: { context: ConversationContext; initialText?: string; showActions?: boolean }) {
  const state = useApp(); const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const main = state.actions.find(a => !a.cancelled && a.taskId === task.id && ['send','continue'].includes(a.kind)); const binding = state.bindings[task.id];
  const active = !!main && !finished(main); const [historyVersion, setHistoryVersion] = useState(0), [sendVersion, setSendVersion] = useState(0);
  const send = state.actions.find(a => !a.cancelled && a.taskId === task.id && a.kind === 'send');
  const local = state.outgoing.filter(s => s.taskId === task.id && !state.actions.some(a => a.id === s.id && a.cancelled)).sort((a,b) => b.at - a.at)[0];
  const outgoing: OutgoingMessage | undefined = local && (!send || local.id === send.id || local.at > send.createdAt) ? local : send ? { id: send.id, taskId: task.id, text: send.text, uploadIds: send.uploadIds, at: send.createdAt } : undefined;
  const outgoingAction = state.actions.find(a => a.id === outgoing?.id);
  const historyChange = `${historyVersion}:${main?.id}:${main?.sendStage}:${main?.receipt}:${main?.state}:${main?.phase}:${main?.terminal}`;
  useEffect(() => { if (main?.terminal || main?.state === 'finished') setHistoryVersion(v => v + 1); }, [main?.terminal, main?.state]);
  async function control(kind: Action['kind'], approvalId?: string, text?: string) {
    setBusy(true); setError(''); try { await submit({ id: crypto.randomUUID(), contextId: task.id, kind, generation: binding?.generation, targetId: main?.id, ...(approvalId ? { approvalId } : {}), ...(text ? { text } : {}) }); } catch(e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <>
    {showActions&&<ConversationContributions context={task}/>}
    <div className="conversation-heading"><span><MessageSquare size={17}/> Conversation</span></div>
    {main && <div className={`execution-card ${main.state === 'awaiting_input' ? 'attention' : ''}`}><div className="execution-title"><span>{main.state === 'running' || main.state === 'preparing' ? <LoaderCircle size={15} className="spin"/> : main.state === 'finished' ? <Check size={15}/> : <Circle size={14}/>} {main.state === 'unknown' ? 'Outcome unknown' : main.state === 'awaiting_input' ? 'Hermes needs your input' : main.phase}</span>{active && <button className="text-button" disabled={busy || !state.gateway.online || !binding} onClick={() => void control('stop')}><Square size={12}/> Request stop</button>}</div>{main.error && <p>{main.error}</p>}{main.receipt === 'unknown' && <p>The request will not be repeated automatically.</p>}
      {main.approvals?.map(p => <div className="approval" key={p.request_id}><p>{p.description || 'Allow this action?'}</p>{p.command && <pre>{p.command}</pre>}<div className="button-row"><button className="primary-button" disabled={busy || !state.gateway.online} onClick={() => void control('approve', p.request_id)}>Approve once</button><button disabled={busy || !state.gateway.online} onClick={() => void control('deny', p.request_id)}>Deny</button></div></div>)}
      {main.clarification && <Clarification question={main.clarification} disabled={busy || !state.gateway.online} onAnswer={answer => void control('clarify', main.clarification.request_id, answer)}/>}
    </div>}
    {state.actions.filter(a => a.taskId === task.id && !['send','continue'].includes(a.kind) && a.receipt === 'unknown').map(a => <p className="error-banner" key={a.id}>Your {a.kind === 'stop' ? 'stop request' : 'decision'} was not confirmed. Refresh to check current state; it will not be repeated.</p>)}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {task.link ? <HistoryView key={task.link.key} conversationId={task.link.storedId} version={historyChange} liveText={main?.liveText} working={active} phase={main?.phase} outgoing={outgoing} outgoingAction={outgoingAction} sendVersion={sendVersion}/> : outgoing ? <div className="history"><OutgoingFeedback message={outgoing} action={outgoingAction}/>{active && <WorkingFeedback phase={main?.phase}/>}</div> : <div className="unlinked-note"><div className="empty-icon small"><MessageSquare size={23}/></div><h2>Ready when you are</h2><p>This item is saved. Sending the first message will start a new Hermes conversation.</p></div>}
    {main?.settings?.confirmation && state.snapshot.sessionSettings?.conversations[task.id]?.revision === main.settings.revision && <ModelSwitchConfirmation action={main}/>}
    <Composer key={task.id} task={task} initialText={initialText} canSend={state.online && state.gateway.online && !active} onSending={() => setSendVersion(v => v + 1)} onSent={() => setHistoryVersion(v => v + 1)}/>
    {state.actions.filter(a => a.taskId === task.id && (['failed','unknown'].includes(a.state) || ['rejected','unknown'].includes(a.receipt)) && a.kind === 'send').map(a => <details className="saved-message" key={a.id}><summary>{a.sendStage === 'preparing' || a.receipt === 'rejected' ? 'Saved message · not sent' : 'Saved submitted message'} · {time(a.createdAt)}</summary><pre>{a.text}</pre>{a.uploadIds.map(id => <a key={id} href={`/api/v1/uploads/${id}`}>Download attachment</a>)}</details>)}
  </>;
}
function ModelSwitchConfirmation({ action }: { action: Action }) {
  const state = useApp(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const work = useUpdateWork();
  async function choose(accept: boolean) {
    if (busy) return; setBusy(true); setError('');
    try {
      if (accept) await submit({ id: crypto.randomUUID(), contextId: action.taskId, kind: 'send', text: action.text, uploadIds: action.uploadIds, settingsConfirmation: action.id });
      else await saveSessionChoices(action.taskId, action.settings!.revision, {});
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="error-banner" role="alert"><strong>Confirm model switch</strong><p>{action.settings!.confirmation}</p><p>Your message is saved and has not been sent.</p><div className="button-row"><button disabled={busy || !state.gateway.online} onClick={() => void work(choose(true))}>Switch and send saved message</button><button disabled={busy} onClick={() => void work(choose(false))}>Keep current settings</button></div>{error && <p>{error}</p>}</section>;
}
function Clarification({ question, disabled, onAnswer }: { question: any; disabled: boolean; onAnswer: (text: string) => void }) { const [text, setText] = useState(''); useUpdatePreparation({ blocked: () => text ? 'Send or clear your answer to Hermes before updating.' : undefined }); return <form className="clarify-form" onSubmit={e => { e.preventDefault(); onAnswer(text); }}><p>{question.question || question.prompt || 'Hermes has a question.'}</p><input aria-label="Answer Hermes" value={text} onChange={e => setText(e.target.value)}/><button disabled={disabled || !text.trim()}>Send answer</button></form>; }

function Composer({ task, canSend, onSent, onSending, initialText }: { task: ConversationContext; canSend: boolean; onSent: () => void; onSending: () => void; initialText: string }) {
  const state = useApp(); const [draft, setDraft] = useState<Draft>({ id: task.id, text: initialText, files: [] }), [files, setFiles] = useState<LocalFile[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [countdown, setCountdown] = useState<number | null>(null), [loaded, setLoaded] = useState(false), [settingsOpen, setSettingsOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null); const deadline = useRef(0); const draftRef = useRef(draft); draftRef.current = draft; const sending = useRef(false); const canSendRef = useRef(canSend); canSendRef.current = canSend && !settingsOpen && !state.localSubmissions.some(s => s.taskId === task.id);
  const attaching = useRef(false);
  const saveDraft = useDraftPersistence();
  useUpdatePreparation({
    pause: cancelTimer,
    blocked: () => sending.current || attaching.current ? 'Wait for the message or attachment to finish saving before updating.' : undefined,
  });
  useEffect(() => { const subscription = liveQuery(() => db.drafts.get(task.id)).subscribe({ next: d => { const next = d || { id: task.id, text: initialText, files: [] }; setDraft(next); draftRef.current = next; setLoaded(true); }, error: () => setError('The saved draft could not be opened. Reload to try again.') }); return () => subscription.unsubscribe(); }, [task.id]);
  useEffect(() => { void db.files.bulkGet(draft.files).then(fs => setFiles(fs.filter(Boolean) as LocalFile[])); }, [draft.files.join(',')]);
  function cancelTimer() { deadline.current = 0; setCountdown(null); }
  function update(next: Draft) { cancelTimer(); draftRef.current = next; setDraft(next); return saveDraft(next).catch(() => { setError('Could not save the draft. Do not leave this page until storage is available.'); throw new Error('Draft storage unavailable'); }); }
  async function send() {
    cancelTimer(); if (sending.current || !canSendRef.current || document.hidden) return;
    const d = draftRef.current; if (!d.text.trim() && !d.files.length) return;
    sending.current = true; setBusy(true); setError('');
    try { await db.drafts.put(d); onSending(); await submit({ id: crypto.randomUUID(), contextId: task.id, kind: 'send', text: d.text, uploadIds: d.files }); await update({ id: task.id, text: '', files: [] }); onSent(); }
    catch(e) { setError((e as Error).message); }
    finally { sending.current = false; setBusy(false); }
  }
  useEffect(() => {
    const cancel = () => cancelTimer(); const visibility = () => { if (document.hidden) cancelTimer(); };
    addEventListener('offline', cancel); addEventListener('hashchange', cancel); document.addEventListener('visibilitychange', visibility);
    const timer = setInterval(() => { if (!deadline.current) return; if (!canSendRef.current || document.hidden || !navigator.onLine) { cancelTimer(); return; } const left = Math.ceil((deadline.current - Date.now()) / 1000); if (left <= 0) { cancelTimer(); void send(); } else setCountdown(left); }, 100);
    return () => { deadline.current = 0; clearInterval(timer); removeEventListener('offline', cancel); removeEventListener('hashchange', cancel); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  useEffect(() => { if (!canSend) cancelTimer(); }, [canSend]);
  async function attach(selected: FileList | null) { cancelTimer(); if (!selected) return; attaching.current = true; setError(''); try { const ids = []; for (const file of Array.from(selected)) ids.push(await addFile(file, file.name)); await update({ ...draftRef.current, files: [...draftRef.current.files, ...ids] }); } catch(e) { setError((e as Error).message); } finally { attaching.current = false; } if (input.current) input.current.value = ''; }
  const uncertainLocal = state.localSubmissions.some(s => s.taskId === task.id);
  return <div className="composer-wrap"><SessionSettingsControls context={task} onOpen={() => { cancelTimer(); setSettingsOpen(true); }} onClose={() => setSettingsOpen(false)}/><form className="composer" onSubmit={e => { e.preventDefault(); void send(); }}>
    <textarea aria-label="Message Hermes" placeholder={task.link ? 'Message Hermes…' : 'Tell Hermes what you want to do…'} value={draft.text} disabled={!loaded || busy} onChange={e => void update({ ...draft, text: e.target.value })} rows={3} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void send(); } }}/>
    {files.length > 0 && <div className="attachment-list">{files.map(f => <span className="attachment" key={f.id}><Paperclip size={13}/>{f.name}<small>{(f.blob.size / 1024).toFixed(0)} KB</small><button type="button" className="icon-button" aria-label={`Remove ${f.name}`} onClick={() => void update({ ...draft, files: draft.files.filter(id => id !== f.id) })}><X size={14}/></button></span>)}</div>}
    <div className="composer-tools"><div className="button-row"><button type="button" className="icon-button" aria-label="Attach files" onClick={() => input.current?.click()} disabled={busy}><Paperclip size={20}/></button><input type="file" ref={input} hidden multiple onChange={e => void attach(e.target.files)}/><Voice owner={`chat:${task.id}`} onTranscript={(text, fresh) => { return update({ ...draftRef.current, text: draftRef.current.text ? `${draftRef.current.text}\n${text}` : text }).then(() => { if (fresh && canSendRef.current && !uncertainLocal && !document.hidden) { deadline.current = Date.now() + 5000; setCountdown(5); } }); }}/></div><button className="primary-button send-button" disabled={!canSend || busy || !loaded || uncertainLocal || (!draft.text.trim() && !draft.files.length)}>{busy ? <LoaderCircle size={16} className="spin"/> : <Send size={16}/>} Send</button></div>
  </form>{countdown !== null && <div className="countdown" role="status"><span>Sending voice message in <strong>{countdown}s</strong></span><button onClick={cancelTimer}>Cancel auto-send</button></div>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {uncertainLocal && <div className="error-banner">A submitted request has not been confirmed. Your draft is saved. <button className="text-button" onClick={() => void refresh()}>Check status</button>{state.localSubmissions.filter(s => s.taskId === task.id).map(s => <button className="text-button" key={s.id} onClick={() => void resolveSubmission(s.id).catch(e => setError(e.message))}>Cancel if not yet received</button>)}<p>This prevents a delayed request from being sent if Herts has not received it. Received work keeps its current status.</p></div>}
    <p className="composer-note">{!state.online ? 'Offline. Your draft and attachments stay on this device.' : !state.gateway.configured ? 'Hermes connection is being configured. You can keep writing.' : !state.gateway.online ? 'Hermes is unavailable. Your draft is saved; send when it reconnects.' : countdown === null ? 'Dictation sends after a cancellable 5-second countdown. Editing cancels it.' : 'You can also edit the message to cancel.'}</p>
  </div>;
}

export function HistoryView({ conversationId, version = 0, liveText, working = false, phase, outgoing, outgoingAction, sendVersion = 0 }: { conversationId: string; version?: number | string; liveText?: string; working?: boolean; phase?: string; outgoing?: OutgoingMessage; outgoingAction?: Action; sendVersion?: number }) {
  const feedback = `${outgoing?.id}:${outgoingStatus(outgoingAction)}:${working}`;
  const { pages, cached, busy, error, setError, newMessages, latest, older, root, end, pauseFollowing } = useConversationHistory(conversationId, version, liveText, working, sendVersion, feedback);
  const confirmed = useRef(new Set<string>());
  if (outgoing && outgoingInHistory(outgoing, pages)) confirmed.current.add(outgoing.id);
  const showOutgoing = outgoing && !confirmed.current.has(outgoing.id);
  const previousGroups = useRef<HistoryGroup[]>([]);
  const groups = useMemo(() => previousGroups.current = groupHistory(pages, previousGroups.current), [pages]);
  const lastAssistant = pages.flatMap(p => p.messages).findLast(m => m.role === 'assistant' && messageText(m).trim());
  const showLive = liveText && messageText(lastAssistant || { role: 'assistant' }).trim() !== liveText.trim();
  const [speaking, setSpeaking] = useState<string | null>(null);
  const playback = useRef(0); const audio = useRef<HTMLAudioElement | null>(null); const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; playback.current++; audio.current?.pause(); }, []);
  async function speak(m: any, page: History, index: number) {
    const generation = ++playback.current; const id = `${page.offset}:${index}`; if (speaking === id) { audio.current?.pause(); setSpeaking(null); return; }
    audio.current?.pause(); setSpeaking(id); setError('');
    try {
      const text = messageText(m); const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(n => n.toString(16).padStart(2,'0')).join('');
      const data = await cacheRead(`speech:${conversationId}:${hash}`, () => api('/audio/speak', { conversationId, ...(m.id === undefined ? {} : { messageId: m.id }), offset: page.offset, order: page.order || 'oldest', index, text }));
      if (!mounted.current || generation !== playback.current) return; const a = new Audio(data.value.data_url); audio.current = a; a.onended = () => setSpeaking(null); await a.play();
    } catch(e) { if (mounted.current && generation === playback.current) { setError((e as Error).message); setSpeaking(null); } }
  }
  function renderMessage({ key, message: m, page, index }: HistoryEntry) {
    const text = messageText(m), assistant = m.role === 'assistant';
    return <article className={`message ${m.role === 'user' ? 'from-user' : ''} ${m.role === 'tool' ? 'tool-message' : ''}`} key={key} data-history-message={key}>
      <div className="message-author">{assistant ? <><span className="hermes-mark">H</span>Hermes</> : m.role === 'user' ? 'You' : 'Tool output'}<MessageTime timestamp={m.timestamp}/>{assistant && text.trim() && <button className="read-aloud icon-button" aria-label={speaking === `${page.offset}:${index}` ? 'Stop reading aloud' : 'Read response aloud'} title="Read response aloud" onClick={() => void speak(m, page, index)}>{speaking === `${page.offset}:${index}` ? <Square size={15}/> : <Volume2 size={16}/>}</button>}</div>
      {m.role === 'tool' ? <HistoryDisclosure label="View tool output" onInteract={pauseFollowing}><pre>{text || 'No output.'}</pre></HistoryDisclosure> : <div className="markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <MessageLinkContributions href={href} conversationId={conversationId}>{children}</MessageLinkContributions>, img: ({ alt }) => <span className="attachment-placeholder">[{alt || 'Image attachment'}]</span> }}>{text}</ReactMarkdown>
        <MessageMedia message={m} conversationId={conversationId} offset={page.offset} index={index} order={page.order || 'oldest'}/>
        {!!m.tool_calls?.length && <HistoryDisclosure label={`${m.tool_calls.length} tool call${m.tool_calls.length === 1 ? '' : 's'}`} onInteract={pauseFollowing}><pre>{JSON.stringify(m.tool_calls, null, 2)}</pre></HistoryDisclosure>}
      </div>}
    </article>;
  }
  return <div className="history" ref={root}><div className="history-note"><span>{cached ? 'Saved history · ' : 'Available history · '}{pages[0] ? time(pages[0].fetchedAt) : 'Hermes'}<small>Earlier messages may be unavailable after compaction or rotation.</small></span><button className="icon-button" aria-label="Refresh conversation history" disabled={busy} onClick={() => void latest()}><RefreshCw size={15} className={busy ? 'spin' : ''}/></button></div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {pages[0]?.hasMore && <button className="load-more" disabled={busy} onClick={() => void older()}>{busy ? 'Loading…' : 'Load older messages'}</button>}
    {groups.map(group => group.kind === 'message' ? renderMessage(group.entry) : <HistoryDisclosure key={group.key} activityKey={group.key} label={<><span className="hermes-mark">H</span><span>Hermes activity</span><span className="activity-count">{group.calls ? `${group.calls} tool call${group.calls === 1 ? '' : 's'}` : `${group.entries.length} tool output${group.entries.length === 1 ? '' : 's'}`}</span></>} onInteract={pauseFollowing}>{group.entries.map(renderMessage)}</HistoryDisclosure>)}
    {showOutgoing && <OutgoingFeedback message={outgoing} action={outgoingAction}/>}
    {showLive && <article className="message live-message"><div className="message-author"><span className="hermes-mark">H</span>Hermes {working && <LoaderCircle size={13} className="spin"/>}</div><div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <MessageLinkContributions href={href} conversationId={conversationId}>{children}</MessageLinkContributions>, img: ({alt}) => <span>[{alt || 'Image'}]</span> }}>{liveText}</ReactMarkdown></div></article>}
    {working && <WorkingFeedback phase={phase}/>}
    {!pages.some(p => p.messages.length) && !outgoing && !liveText && !busy && !error && <p className="history-empty">No messages are available yet.</p>}
    {newMessages && <button className="load-more" onClick={() => void latest()}>Show latest messages</button>}
    <div ref={end}/>
  </div>;
}
function OutgoingFeedback({ message, action }: { message: OutgoingMessage; action?: Action }) {
  return <article className="message from-user outgoing-message" data-outgoing-id={message.id}><div className="message-author">You <span className="submission-status">{outgoingStatus(action)}</span></div>{message.text && <div className="outgoing-text">{message.text}</div>}{message.uploadIds.length > 0 && <div className="subtle-note">{message.uploadIds.length} attachment{message.uploadIds.length === 1 ? '' : 's'}</div>}</article>;
}
function WorkingFeedback({ phase }: { phase?: string }) {
  return <div className="working-feedback" role="status"><span className="hermes-mark">H</span><LoaderCircle size={15} className="spin"/><span>Hermes is working{phase && !['working','streaming'].includes(phase) ? ` · ${phase}` : '…'}</span></div>;
}
