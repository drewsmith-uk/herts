import { NotificationSettings } from './NotificationSettings';
import { AppUpdateSettings } from './AppUpdates';
import { NotificationLanding } from './NotificationLanding';
import { outgoingInHistory, outgoingStatus, type OutgoingMessage } from './transcriptFeedback';
import { SpaceSwitcher, SpaceTabs, SpaceSettings, SpaceConflict, useTaskDestination } from './Spaces';
import { liveQuery } from 'dexie';
import type { ConversationContext } from '../shared/reading';
import { ReadingList, ReadingDetail, ReadingCapture, Reader, BookmarkLink, ReadingSettings } from './Reading';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Inbox, ArrowRight, Clock3, Pause, Check, Plus, Search, MessageSquare, Settings, ChevronLeft, ArrowUp, ArrowDown, AlarmClock, Pencil, CheckCheck, WifiOff, Link2, Send, Paperclip, X, Square, RefreshCw, Volume2, Circle, LoaderCircle, Eye, EyeOff, BookOpen } from 'lucide-react';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { TaskDragging, TaskDropLink, useTaskInteractions } from './TaskDragging';
import { TaskRow } from './TaskRow';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { labels, statuses, originalSpaceId, taskSpaceId, spaceLists, spaceName, spacePath, messageText, conversationTaskId, conversationHidden, type Status, type Task, type Conversation, type History, type Action, type Snapshot } from '../shared/model';
import { db, useApp, rememberSpace, contextForTask, resolveReadingConflict, api, cacheRead, createTask, createTaskFromConversation, setConversationHidden, renameTask, moveTask, refresh, resolveConflict, resolveSubmission, addFile, submit, type Draft, type LocalFile } from './data';
import { Voice } from './Voice';
import { MessageMedia } from './Media';
import { useConversationHistory } from './useConversationHistory';
import { groupHistory, type HistoryEntry, type HistoryGroup } from './historyGroups';
import { HistoryDisclosure } from './HistoryDisclosure';
import { ConversationHeader } from './ConversationHeader';
import { ConversationRow } from './ConversationRow';
import { useRoute } from './useRoute';
import { useDraftPersistence, useUpdatePreparation, useUpdateWork } from './updateSafety';

const icons = { inbox: Inbox, next: ArrowRight, waiting: Clock3, parked: Pause, snoozed: AlarmClock, done: CheckCheck };
function navigate(path: string) { window.location.hash = path; }
function time(at: number) { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(at); }
const messageTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
function MessageTime({ timestamp }: { timestamp?: number }) {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) return null;
  const date = new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  return <time className="message-time" dateTime={date.toISOString()} title={date.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' })}>{messageTimeFormat.format(date)}</time>;
}
const finished = (a?: Action) => !!a && ['finished','failed','ready','unknown'].includes(a.state);

export function App() {
  const state = useApp(); const { parts: [screen, id, listStatus], recordRequest } = useRoute(state.loaded && state.defaultsReady, state.snapshot.defaultSpaceId);
  const selectedList = screen === 'spaces' ? listStatus : id;
  const selected = statuses.includes(selectedList as Status) ? selectedList as Status : 'inbox';
  const task = screen === 'task' ? state.snapshot.tasks.find(t => t.id === id) : undefined;
  const taskListScreen = screen === 'tasks' || screen === 'spaces';
  const taskScreen = taskListScreen || screen === 'task';
  const currentSpace = task ? taskSpaceId(task) : screen === 'spaces' ? id : screen === 'tasks' && id ? originalSpaceId : state.viewedSpaceId;
  const knownSpace = !!state.snapshot.spaces?.some(s => s.id === currentSpace);
  const currentLists = spaceLists(state.snapshot, currentSpace);
  const unfinished = state.snapshot.tasks.filter(t => taskSpaceId(t) === currentSpace && t.status !== 'done').length;
  useEffect(() => { if (state.loaded && state.defaultsReady && taskScreen && knownSpace && state.viewedSpaceId !== currentSpace) rememberSpace(currentSpace); }, [state.loaded, state.defaultsReady, taskScreen, knownSpace, currentSpace, state.viewedSpaceId]);
  const pendingCount = state.pending.length + state.visibilityPending.length + state.readingPending.length + state.spacePending.length;
  useEffect(() => { document.title = task ? `${task.title} · Herts` : 'Herts'; }, [task?.title]);
  return <TaskDragging><div className="app-shell">
    <aside className="sidebar"><a href={`#${spacePath(state.viewedSpaceId)}`} className="brand"><span className="brand-mark"><Check size={22}/></span>Herts<span className="personal-label">Private</span></a>
      {taskListScreen ? <div className="sidebar-space-name">{spaceName(state.snapshot, currentSpace)}</div> : <SpaceSwitcher spaceId={currentSpace} label="Sidebar space"/>}<div className="sidebar-label">YOUR TASKS <span>{unfinished}</span></div>
      <nav aria-label="Task lists">{statuses.map(s => { const Icon = icons[s]; return <TaskDropLink key={s} surface="sidebar" spaceId={currentSpace} status={s} className={`nav-item ${taskScreen && (task?.status || selected) === s ? 'active' : ''}`} ><Icon size={19}/><span>{labels[s]}</span><small>{currentLists?.[s].ids.length || ''}</small></TaskDropLink>; })}</nav>
      <div className="sidebar-rule"/><a href="#/conversations" className={`nav-item ${screen.startsWith('conversation') ? 'active' : ''}`}><MessageSquare size={19}/><span>Conversations</span></a>
      <a href="#/reading" className={`nav-item ${screen.startsWith('reading') || screen === 'reader' ? 'active' : ''}`}><BookOpen size={19}/><span>Reading</span></a><div className="sidebar-bottom"><div className="profile"><span className="avatar">H</span><div><strong>Herts</strong><small>Private workspace</small></div><span className="private-dot"/></div></div>
    </aside>
    <main><div className="topbar"><span className="breadcrumb">Herts <span>/</span> {taskScreen ? `${spaceName(state.snapshot, currentSpace)} / ${task ? labels[task.status] : labels[selected]}` : screen.startsWith('conversation') ? 'Conversations' : screen === 'settings' ? 'Settings' : screen === 'notice' ? 'Notification' : screen.startsWith('reading') || screen === 'reader' ? 'Reading' : labels[selected]}</span><div className={`save-state ${!state.online ? 'offline' : ''}`} aria-live="polite">{!state.online ? <WifiOff size={14}/> : pendingCount ? <RefreshCw size={14}/> : <Check size={14}/>} {!state.online ? 'Offline · saved on device' : pendingCount ? `${pendingCount} change${pendingCount === 1 ? '' : 's'} to sync` : 'All changes saved'}</div><a href="#/settings" className="icon-button settings-link" aria-label="Settings"><Settings size={19}/></a></div>
      <div className="page-content">
        {state.error && <div className="error-banner" role="alert">{state.error}</div>}
        {state.pending.filter(p => p.conflict).map(p => <div className="conflict-banner" key={p.id}><strong>A change needs your choice</strong><p>{p.conflict}</p><p>Your change: {p.op.kind === 'snooze' ? `Snooze until ${time(p.op.snoozedUntil!)}` : p.op.title || `Move to ${spaceName(state.snapshot, p.op.spaceId || originalSpaceId)} / ${labels[(state.remote.tasks.find(t => t.id === p.op.taskId)?.spaceId || originalSpaceId) !== (p.op.spaceId || originalSpaceId) ? 'inbox' : p.op.status!]}`}</p><p>Synced version: {p.op.kind === 'title' ? state.remote.tasks.find(t => t.id === p.op.taskId)?.title : (() => { const t = state.remote.tasks.find(t => t.id === p.op.taskId); return t ? `${spaceName(state.remote, taskSpaceId(t))} / ${labels[t.status]}, position ${spaceLists(state.remote, taskSpaceId(t))[t.status].ids.indexOf(t.id) + 1}` : 'Task not found'; })()}</p><div className="button-row"><button onClick={() => void resolveConflict(p.id, true)}>Keep my change</button><button onClick={() => void resolveConflict(p.id, false)}>Use synced version</button></div></div>)}
        {state.readingPending.filter(p => p.conflict).map(p => <div className="conflict-banner" key={p.op.id}><strong>A reading-list change needs your choice</strong><p>{p.conflict}</p>{p.op.kind === 'title' && <><p>Your title: {p.op.title}</p><p>Synced title: {state.remote.reading?.items.find(i => i.id === p.op.itemId)?.title}</p></>}<div className="button-row"><button onClick={() => void resolveReadingConflict(p.op.id, true)}>Keep my change</button><button onClick={() => void resolveReadingConflict(p.op.id, false)}>Use synced version</button></div></div>)}
        {state.spacePending.filter(p => p.conflict).map(p => <SpaceConflict key={p.id} pending={p}/>)}
        {!state.loaded ? <div className="empty"><LoaderCircle className="spin"/><p>Opening your tasks…</p></div> : screen === 'notice' ? <NotificationLanding key={id} id={id} online={state.online}/> : taskListScreen ? knownSpace ? <TaskList key={`${currentSpace}:${selected}`} spaceId={currentSpace} status={selected} recordRequest={recordRequest}/> : <div className="empty"><p>This space is not available on this device yet.</p><button onClick={() => void refresh()}>Refresh</button></div> : screen === 'task' ? task ? <TaskDetail key={task.id} task={task}/> : <div className="empty"><p>This task is not available on this device yet.</p><button onClick={() => void refresh()}>Refresh</button></div> : screen === 'conversations' ? <Conversations/> : screen === 'conversation' ? <ConversationView key={id} id={decodeURIComponent(id)}/> : screen === 'reading' ? id === 'add' ? <ReadingCapture/> : <ReadingList read={id === 'read'}/> : screen === 'reading-item' ? <ReadingDetail key={id} id={id}/> : screen === 'reader' ? <Reader key={id} id={id}/> : <Preferences/>}
      </div>
    </main>
    <nav className="mobile-nav" aria-label="Main navigation"><a className={taskScreen ? 'active' : ''} href={`#${spacePath(state.viewedSpaceId)}`}><Inbox size={21}/>Tasks</a><a className={screen.startsWith('conversation') ? 'active' : ''} href="#/conversations"><MessageSquare size={21}/>Conversations</a><a className={screen.startsWith('reading') || screen === 'reader' ? 'active' : ''} href="#/reading"><BookOpen size={21}/>Reading</a></nav>
  </div></TaskDragging>;
}

function TaskList({ spaceId, status, recordRequest }: { spaceId: string; status: Status; recordRequest?: string }) {
  const { snapshot } = useApp(); const captureId = `capture:${spaceId}`; const lists = spaceLists(snapshot, spaceId); const [edit, setEdit] = useState(false), [title, setTitle] = useState(''), [error, setError] = useState('');
  const [draftLoaded, setDraftLoaded] = useState(false);
  const saveDraft = useDraftPersistence(), savingCapture = useUpdateWork();
  const tasks = lists[status].ids.map(id => snapshot.tasks.find(t => t.id === id)!).filter(Boolean);
  async function capture(e: FormEvent) { e.preventDefault(); if (!title.trim()) return; try { await createTask(title, spaceId); setTitle(''); await db.drafts.delete(captureId); } catch { setError('The task could not be saved. Your title is still here.'); } }
  useEffect(() => {
    let active = true;
    void db.drafts.get(captureId).then(d => { if (active) { if (d) setTitle(d.text); setDraftLoaded(true); } }).catch(() => { if (active) setError('Your saved draft could not be opened. Reload to try again.'); });
    return () => { active = false; };
  }, []);
  function updateTitle(text: string) { setTitle(text); return saveDraft({ id: captureId, text, files: [] }).then(() => {}).catch(() => { setError('Draft could not be saved.'); throw new Error('Draft storage unavailable'); }); }
  const subtitle = { inbox: 'A place for everything on your mind.', next: 'What you want to do next, in your order.', waiting: 'Things waiting on someone or something.', parked: 'Out of the way, ready when you are.', snoozed: 'Back in your Inbox when the reminder is due.', done: 'Finished work, most recent first.' }[status];
  return <><SpaceTabs spaceId={spaceId}/><div className="page-heading"><div><div className="eyebrow">YOUR TASKS</div><h1>{labels[status]} <span className="heading-count">{tasks.length}</span></h1><p>{subtitle}</p></div><button className={`quiet-button ${edit ? 'selected' : ''}`} onClick={() => setEdit(!edit)}><Pencil size={15}/>{edit ? 'Finish editing' : 'Edit list'}</button></div>
    <div className="mobile-lists">{statuses.map(s => <TaskDropLink key={s} surface="tabs" spaceId={spaceId} status={s} className={s === status ? 'active' : ''}>{labels[s]} <small>{lists[s].ids.length}</small></TaskDropLink>)}</div>
    <form className="capture" onSubmit={e => { void savingCapture(capture(e)); }}><Plus size={22}/><input value={title} disabled={!draftLoaded} onChange={e => updateTitle(e.target.value)} placeholder="What do you need to do?" aria-label="New task title" maxLength={2000}/><Voice owner={captureId} startRequest={draftLoaded ? recordRequest : undefined} onTranscript={text => updateTitle(title ? `${title} ${text}` : text)}/><button className="capture-add" disabled={!draftLoaded || !title.trim()} aria-label="Add task"><ArrowRight size={20}/></button></form>
    {status !== 'inbox' && <p className="capture-note">New tasks go to {spaceName(snapshot, spaceId)} Inbox.</p>}{error && <p className="inline-error" role="alert">{error}</p>}
    <div className="list-summary"><span>{status === 'done' ? 'COMPLETED' : status === 'snoozed' ? 'REMINDERS' : 'MANUAL ORDER'}</span><span>{status === 'done' ? 'Newest first' : status === 'snoozed' ? 'Soonest first' : 'Most important at the top'}</span></div>
    <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}><div className="task-list">{tasks.map((t, i) => <TaskRow key={t.id} task={t} edit={edit} index={i} tasks={tasks}/>)}</div></SortableContext>
    {!tasks.length && <div className="empty list-empty"><div className="empty-icon">{status === 'done' ? <CheckCheck size={30}/> : <Inbox size={30}/>}</div><h2>{status === 'inbox' ? 'A clear Inbox' : `Nothing ${status === 'next' ? 'up next' : status === 'done' ? 'completed yet' : `in ${labels[status]}`}`}</h2><p>{status === 'inbox' ? 'Add a task above, or find a conversation worth returning to.' : 'Move a task here when it belongs on this list.'}</p>{status === 'inbox' && <a className="text-link" href="#/conversations">Browse Hermes conversations <ArrowRight size={15}/></a>}</div>}
  </>;
}

function TaskDetail({ task }: { task: Task }) {
  const state = useApp(); const { snooze } = useTaskInteractions();
  const [title, setTitle] = useState(task.title);
  const savingTitle = useUpdateWork();
  useUpdatePreparation({ blocked: () => title.trim() !== task.title ? 'The task title is still being saved. Please try updating again after it is saved.' : undefined });
  useEffect(() => setTitle(task.title), [task.title]);
  return <div className="task-detail"><ConversationHeader><a className="back-link" href={`#${spacePath(taskSpaceId(task), task.status)}`}><ChevronLeft size={17}/> {spaceName(state.snapshot, taskSpaceId(task))} / {labels[task.status]}</a><div className="detail-heading"><textarea className="detail-title" aria-label="Task title" rows={2} value={title} onChange={e => setTitle(e.target.value)} onBlur={() => { if (title.trim() && title !== task.title) void savingTitle(renameTask(task.id, title)); else setTitle(task.title); }}/><div className="detail-controls"><select aria-label="Task space" value={taskSpaceId(task)} onChange={e => void moveTask(task.id, 'inbox', undefined, e.target.value)}>{state.snapshot.spaces?.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}</select><select aria-label="Task list" value={task.status} onChange={e => { if (e.target.value === 'snoozed') snooze(task); else void moveTask(task.id, e.target.value as Status); }}>{statuses.filter(s => s !== 'snoozed' || ['inbox','snoozed'].includes(task.status)).map(s => <option key={s} value={s}>{labels[s]}</option>)}</select>{task.status === 'inbox' && <button className="quiet-button" onClick={() => snooze(task)}><AlarmClock size={16}/>Snooze</button>}{task.status === 'snoozed' && <><button className="quiet-button" onClick={() => snooze(task)}><AlarmClock size={16}/>Change reminder</button><button className="quiet-button" onClick={() => void moveTask(task.id, 'inbox')}>Unsnooze</button></>}<button className="quiet-button" onClick={() => void moveTask(task.id, task.status === 'done' ? ['done','snoozed'].includes(task.previousStatus) ? 'inbox' : task.previousStatus : 'done')}><Check size={16}/>{task.status === 'done' ? 'Reopen task' : 'Complete task'}</button></div>{task.status === 'snoozed' && task.snoozedUntil && <p className="snooze-detail-time"><AlarmClock size={14}/> Back in Inbox {time(task.snoozedUntil)}</p>}</div></ConversationHeader><ConversationPanel context={contextForTask(task.id)!}/></div>;
}
export function ConversationPanel({ context: task, initialText = '' }: { context: ConversationContext; initialText?: string }) {
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
    <div className="conversation-heading"><span><MessageSquare size={17}/> Conversation</span></div>
    {main && <div className={`execution-card ${main.state === 'awaiting_input' ? 'attention' : ''}`}><div className="execution-title"><span>{main.state === 'running' || main.state === 'preparing' ? <LoaderCircle size={15} className="spin"/> : main.state === 'finished' ? <Check size={15}/> : <Circle size={14}/>} {main.state === 'unknown' ? 'Outcome unknown' : main.state === 'awaiting_input' ? 'Hermes needs your input' : main.phase}</span>{active && <button className="text-button" disabled={busy || !state.gateway.online || !binding} onClick={() => void control('stop')}><Square size={12}/> Request stop</button>}</div>{main.error && <p>{main.error}</p>}{main.receipt === 'unknown' && <p>The request will not be repeated automatically.</p>}
      {main.approvals?.map(p => <div className="approval" key={p.request_id}><p>{p.description || 'Allow this action?'}</p>{p.command && <pre>{p.command}</pre>}<div className="button-row"><button className="primary-button" disabled={busy || !state.gateway.online} onClick={() => void control('approve', p.request_id)}>Approve once</button><button disabled={busy || !state.gateway.online} onClick={() => void control('deny', p.request_id)}>Deny</button></div></div>)}
      {main.clarification && <Clarification question={main.clarification} disabled={busy || !state.gateway.online} onAnswer={answer => void control('clarify', main.clarification.request_id, answer)}/>}
    </div>}
    {state.actions.filter(a => a.taskId === task.id && !['send','continue'].includes(a.kind) && a.receipt === 'unknown').map(a => <p className="error-banner" key={a.id}>Your {a.kind === 'stop' ? 'stop request' : 'decision'} was not confirmed. Refresh to check current state; it will not be repeated.</p>)}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {task.link ? <HistoryView key={task.link.key} conversationId={task.link.storedId} version={historyChange} liveText={main?.liveText} working={active} phase={main?.phase} outgoing={outgoing} outgoingAction={outgoingAction} sendVersion={sendVersion}/> : outgoing ? <div className="history"><OutgoingFeedback message={outgoing} action={outgoingAction}/>{active && <WorkingFeedback phase={main?.phase}/>}</div> : <div className="unlinked-note"><div className="empty-icon small"><MessageSquare size={23}/></div><h2>Ready when you are</h2><p>This item is saved. Sending the first message will start a new Hermes conversation.</p></div>}
    <Composer key={task.id} task={task} initialText={initialText} canSend={state.online && state.gateway.online && !active} onSending={() => setSendVersion(v => v + 1)} onSent={() => setHistoryVersion(v => v + 1)}/>
    {state.actions.filter(a => a.taskId === task.id && (['failed','unknown'].includes(a.state) || ['rejected','unknown'].includes(a.receipt)) && a.kind === 'send').map(a => <details className="saved-message" key={a.id}><summary>{a.sendStage === 'preparing' || a.receipt === 'rejected' ? 'Saved message · not sent' : 'Saved submitted message'} · {time(a.createdAt)}</summary><pre>{a.text}</pre>{a.uploadIds.map(id => <a key={id} href={`/api/v1/uploads/${id}`}>Download attachment</a>)}</details>)}
  </>;
}
function Clarification({ question, disabled, onAnswer }: { question: any; disabled: boolean; onAnswer: (text: string) => void }) { const [text, setText] = useState(''); useUpdatePreparation({ blocked: () => text ? 'Send or clear your answer to Hermes before updating.' : undefined }); return <form className="clarify-form" onSubmit={e => { e.preventDefault(); onAnswer(text); }}><p>{question.question || question.prompt || 'Hermes has a question.'}</p><input aria-label="Answer Hermes" value={text} onChange={e => setText(e.target.value)}/><button disabled={disabled || !text.trim()}>Send answer</button></form>; }

function Composer({ task, canSend, onSent, onSending, initialText }: { task: ConversationContext; canSend: boolean; onSent: () => void; onSending: () => void; initialText: string }) {
  const state = useApp(); const [draft, setDraft] = useState<Draft>({ id: task.id, text: initialText, files: [] }), [files, setFiles] = useState<LocalFile[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [countdown, setCountdown] = useState<number | null>(null), [loaded, setLoaded] = useState(false);
  const input = useRef<HTMLInputElement>(null); const deadline = useRef(0); const draftRef = useRef(draft); draftRef.current = draft; const sending = useRef(false); const canSendRef = useRef(canSend); canSendRef.current = canSend && !state.localSubmissions.some(s => s.taskId === task.id);
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
  return <div className="composer-wrap"><form className="composer" onSubmit={e => { e.preventDefault(); void send(); }}>
    <textarea aria-label="Message Hermes" placeholder={task.link ? 'Message Hermes…' : 'Tell Hermes what you want to do…'} value={draft.text} disabled={!loaded || busy} onChange={e => void update({ ...draft, text: e.target.value })} rows={3} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void send(); } }}/>
    {files.length > 0 && <div className="attachment-list">{files.map(f => <span className="attachment" key={f.id}><Paperclip size={13}/>{f.name}<small>{(f.blob.size / 1024).toFixed(0)} KB</small><button type="button" className="icon-button" aria-label={`Remove ${f.name}`} onClick={() => void update({ ...draft, files: draft.files.filter(id => id !== f.id) })}><X size={14}/></button></span>)}</div>}
    <div className="composer-tools"><div className="button-row"><button type="button" className="icon-button" aria-label="Attach files" onClick={() => input.current?.click()} disabled={busy}><Paperclip size={20}/></button><input type="file" ref={input} hidden multiple onChange={e => void attach(e.target.files)}/><Voice owner={`chat:${task.id}`} onTranscript={(text, fresh) => { return update({ ...draftRef.current, text: draftRef.current.text ? `${draftRef.current.text}\n${text}` : text }).then(() => { if (fresh && canSendRef.current && !uncertainLocal && !document.hidden) { deadline.current = Date.now() + 5000; setCountdown(5); } }); }}/></div><button className="primary-button send-button" disabled={!canSend || busy || !loaded || uncertainLocal || (!draft.text.trim() && !draft.files.length)}>{busy ? <LoaderCircle size={16} className="spin"/> : <Send size={16}/>} Send</button></div>
  </form>{countdown !== null && <div className="countdown" role="status"><span>Sending voice message in <strong>{countdown}s</strong></span><button onClick={cancelTimer}>Cancel auto-send</button></div>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {uncertainLocal && <div className="error-banner">A submitted request has not been confirmed. Your draft is saved. <button className="text-button" onClick={() => void refresh()}>Check status</button>{state.localSubmissions.filter(s => s.taskId === task.id).map(s => <button className="text-button" key={s.id} onClick={() => void resolveSubmission(s.id).catch(e => setError(e.message))}>Cancel if not yet received</button>)}<p>This prevents a delayed request from being sent if Herts has not received it. Received work keeps its current status.</p></div>}
    <p className="composer-note">{!state.online ? 'Offline. Your draft and attachments stay on this device.' : !state.gateway.configured ? 'Hermes connection is being configured. You can keep writing.' : !state.gateway.online ? 'Hermes is unavailable. Your draft is saved; send when it reconnects.' : countdown === null ? 'Dictation sends after a cancellable 5-second countdown. Editing cancels it.' : 'You can also edit the message to cancel.'}</p>
  </div>;
}

async function savedConversations(query: string, knownMatches: Conversation[] = []): Promise<Conversation[]> {
  const entries = await db.kv.toArray(), lists = entries.filter(row => row.key.startsWith('conversations:'));
  const matches = new Set([...knownMatches, ...lists.filter(row => row.value.query?.toLowerCase() === query.toLowerCase()).flatMap(row => row.value.conversations || [])].map((c: Conversation) => c.key));
  const unique = [...new Map(lists.flatMap(row => row.value.conversations || []).map((c: Conversation) => [c.key, c])).values()] as Conversation[];
  return unique.filter(c => matches.has(c.key) || `${c.title} ${c.preview} ${entries.filter(e => c.aliases.some(id => e.key.startsWith(`history:${id}:`))).flatMap(e => e.value.messages || []).map(messageText).join(' ')}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.updatedAt - a.updatedAt);
}
function Conversations() {
  const state = useApp(), { snapshot } = state;
  const [query, setQuery] = useState(''), [includeLinked, setIncludeLinked] = useState(false), [includeHidden, setIncludeHidden] = useState(false);
  const [notice, setNotice] = useState<{ text: string; undo?: Conversation; taskId?: string }>(), [error, setError] = useState(''), [busyKeys, setBusyKeys] = useState<string[]>([]);
  const working = useRef(new Set<string>());
  async function act(c: Conversation, kind: 'task' | 'visibility') {
    if (working.current.has(c.key)) return;
    if (kind === 'task' && c.linkedTaskId) { navigate(`/task/${c.linkedTaskId}`); return; }
    working.current.add(c.key); setBusyKeys([...working.current]); setError(''); setNotice(undefined);
    try {
      if (kind === 'visibility') {
        await setConversationHidden(c, !c.hidden);
        setNotice({ text: c.hidden ? 'Conversation unhidden.' : 'Conversation hidden.', undo: c.hidden ? undefined : c });
      } else {
        const taskId = await createTaskFromConversation(c.key, c.title.slice(0, 2000));
        const saved = (await db.kv.get('state'))!.value.snapshot as Snapshot;
        const task = saved.tasks.find(t => t.id === taskId)!;
        setNotice({ text: `Task created in ${spaceName(saved, taskSpaceId(task))} ${labels[task.status]}.`, taskId });
      }
    } catch (e) { setError((e as Error).message); }
    finally { working.current.delete(c.key); setBusyKeys([...working.current]); }
  }
  const resultsKey = JSON.stringify([query, includeLinked, includeHidden]);
  const listVersion = JSON.stringify([snapshot.hiddenConversations, state.visibilityPending.map(p => p.op.id), snapshot.tasks.flatMap(t => t.link ? [[t.id, t.link.key, t.link.storedId]] : []).sort()]);
  return <><div className="page-heading"><div><div className="eyebrow">HERMES</div><h1>Conversations</h1><p>Find a conversation worth coming back to.</p></div><span className="source-tag">Shared across spaces</span></div><div className="search-field"><Search size={19}/><input aria-label="Search conversations" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search conversations…"/>{query && <button className="icon-button" aria-label="Clear search" onClick={() => setQuery('')}><X size={16}/></button>}</div>
    <div className="conversation-filters"><label className="conversation-filter"><input type="checkbox" checked={includeLinked} onChange={e => setIncludeLinked(e.target.checked)}/>Show linked conversations</label><label className="conversation-filter"><input type="checkbox" checked={includeHidden} onChange={e => setIncludeHidden(e.target.checked)}/>Show hidden items</label></div>
    <p className="conversation-gesture-hint">Swipe right to make a task, left to hide.</p>
    {notice && <div className="conversation-notice" role="status"><span>{notice.text}</span>{notice.undo && <button className="text-button" onClick={() => void act({ ...notice.undo!, hidden: true }, 'visibility')}>Undo</button>}{notice.taskId && <a className="text-link" href={`#/task/${notice.taskId}`}>Open task</a>}<button className="icon-button" aria-label="Dismiss conversation notice" onClick={() => setNotice(undefined)}><X size={15}/></button></div>}
    {error && <div className="error-banner" role="alert">{error}</div>}
    <ConversationResults key={resultsKey} query={query} includeLinked={includeLinked} includeHidden={includeHidden} snapshot={snapshot} listVersion={listVersion} online={state.online} busyKeys={busyKeys} onAction={act}/>
  </>;
}
function ConversationResults({ query, includeLinked, includeHidden, snapshot, listVersion, online, busyKeys, onAction }: { query: string; includeLinked: boolean; includeHidden: boolean; snapshot: Snapshot; listVersion: string; online: boolean; busyKeys: string[]; onAction: (c: Conversation, kind: 'task' | 'visibility') => Promise<void> }) {
  const [rows, setRows] = useState<Conversation[]>([]), [busy, setBusy] = useState(true), [error, setError] = useState(''), [cached, setCached] = useState(false), [more, setMore] = useState(false), [offset, setOffset] = useState(0);
  const loadedVersion = useRef<string | undefined>(undefined);
  useEffect(() => { let alive = true; setBusy(true); const timer = setTimeout(() => { setError('');
    // Refresh all loaded pages when filtering boundaries change, keeping the list in place while loading.
    const replace = loadedVersion.current !== listVersion;
    const offsets = replace ? Array.from({ length: offset / 50 + 1 }, (_, i) => i * 50) : [offset];
    void Promise.all(offsets.map(pageOffset => cacheRead(`conversations:v2:${includeLinked ? 'all' : 'unlinked'}:${includeHidden ? 'hidden' : 'visible'}:${query}:${pageOffset}`, () => api(`/conversations?q=${encodeURIComponent(query)}&offset=${pageOffset}&includeLinked=${includeLinked}&includeHidden=${includeHidden}`).then(value => ({ ...value, query }))))).then(async pages => {
      const offline = pages.some(r => r.cached), next: Conversation[] = pages.flatMap(r => r.value.conversations);
      // A filtered cache can omit something just unhidden offline. Reapply today's choices to all saved rows.
      const saved = offline ? await savedConversations(query, next) : undefined;
      if (alive) { setRows(old => saved || (replace || !offset ? next : [...new Map([...old, ...next].map(c => [c.key, c])).values()])); setMore(!offline && pages.at(-1)!.value.hasMore); setCached(offline); loadedVersion.current = listVersion; }
    }).catch(async e => {
    const saved = await savedConversations(query), hasSaved = await db.kv.where('key').startsWith('conversations:').count();
    if (alive) { setRows(saved); setCached(true); setMore(false); if (!hasSaved) setError(e.message); }
  }).finally(() => { if (alive) setBusy(false); }); }, 250); return () => { alive = false; clearTimeout(timer); }; }, [query, offset, includeLinked, includeHidden, listVersion]);
  // Cached pages can predate a task created on this or another device.
  const visibleRows = rows.map(c => ({ ...c, linkedTaskId: conversationTaskId(c, snapshot.tasks) || c.linkedTaskId, hidden: snapshot.hiddenConversations ? conversationHidden(c, snapshot.hiddenConversations) : !!c.hidden })).filter(c => (includeLinked || !c.linkedTaskId) && (includeHidden || !c.hidden));
  return <>
    <div className="list-summary"><span>{cached ? 'SAVED ON THIS DEVICE' : 'HERMES CONVERSATIONS'}</span><span>Preview before making a task</span></div>
    {cached && <p className="subtle-note">Offline results cover conversations previously viewed on this device.</p>}{error && <div className="error-banner">{error}</div>}
    <div className="conversation-list">{visibleRows.map(c => <ConversationRow key={c.key} conversation={c} updatedAt={time(c.updatedAt)} online={online} busy={busyKeys.includes(c.key)} onAction={kind => onAction(c, kind)}/>)}</div>
    {busy && <p className="loading"><LoaderCircle size={17} className="spin"/> Loading conversations…</p>}{!busy && !visibleRows.length && !error && <div className="empty"><MessageSquare size={30}/><h2>No conversations found</h2><p>{query ? 'Try a different search.' : 'Your personal Hermes conversations will appear here.'}</p>{!includeLinked && <p>Turn on “Show linked conversations” to include them.</p>}{!includeHidden && <p>Turn on “Show hidden items” to include conversations you’ve hidden.</p>}</div>}{more && !busy && <button className="load-more" onClick={() => { setBusy(true); setOffset(offset + 50); }}>Load more conversations</button>}
  </>;
}
function ConversationView({ id }: { id: string }) {
  const destination = useTaskDestination(id);
  const state = useApp(); const [conversation, setConversation] = useState<Conversation>(), [title, setTitle] = useState(''), [creating, setCreating] = useState(false), [showCreate, setShowCreate] = useState(false), [error, setError] = useState(''), [hiding, setHiding] = useState(false);
  useUpdatePreparation({ blocked: () => showCreate || creating ? 'Finish or cancel creating the task before updating.' : undefined });
  const currentConversation = conversation || { id, key: id, aliases: [id], title: '', preview: '', source: '', updatedAt: 0 };
  const hidden = conversationHidden(currentConversation, state.snapshot.hiddenConversations || []);
  const linked = state.snapshot.tasks.find(t => t.link?.key === id || t.link?.storedId === id);
  useEffect(() => { void db.kv.toArray().then(rows => { const found = rows.filter(r => r.key.startsWith('conversations:')).flatMap(r => r.value.conversations || []).find(c => c.key === id); if (found) { setConversation(found); setTitle(found.title); } }); }, [id]);
  async function makeTask(e: FormEvent) { e.preventDefault(); setCreating(true); setError(''); try { navigate(`/task/${await createTaskFromConversation(id, title, destination)}`); } catch(e) { setError((e as Error).message); } finally { setCreating(false); } }
  async function toggleHidden() { setHiding(true); setError(''); try { await setConversationHidden(currentConversation, !hidden); } catch(e) { setError((e as Error).message); } finally { setHiding(false); } }
  return <><ConversationHeader><a className="back-link" href="#/conversations"><ChevronLeft size={17}/> Conversations</a><div className="page-heading conversation-detail-heading"><div><div className="eyebrow">{conversation?.source || 'HERMES'}</div><h1>{conversation?.title || 'Conversation'}</h1></div><div className="conversation-detail-actions">{linked ? <button className="primary-button" onClick={() => navigate(`/task/${linked.id}`)}>Open task <ArrowRight size={15}/></button> : <button className="primary-button" disabled={!state.online} onClick={() => setShowCreate(!showCreate)}><Plus size={16}/> Make a task</button>}<button disabled={hiding} onClick={() => void toggleHidden()}>{hiding ? <LoaderCircle size={16} className="spin"/> : hidden ? <Eye size={16}/> : <EyeOff size={16}/>} {hidden ? 'Unhide conversation' : 'Hide conversation'}</button></div></div>
    {showCreate && !linked && <form className="create-from-chat" onSubmit={makeTask}><label>New task in {spaceName(state.snapshot, destination)} Inbox<input autoFocus aria-label="New task from conversation title" value={title} onChange={e => setTitle(e.target.value)}/></label><div className="button-row"><button className="primary-button" disabled={creating || !title.trim()}>Create task</button><button type="button" onClick={() => setShowCreate(false)}>Cancel</button></div><p>This saves a task. It does not start Hermes.</p></form>}{error && <p className="inline-error" role="alert">{error}</p>}</ConversationHeader>
    <HistoryView conversationId={id}/>
  </>;
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
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <BookmarkLink href={href} conversationId={conversationId}>{children}</BookmarkLink>, img: ({ alt }) => <span className="attachment-placeholder">[{alt || 'Image attachment'}]</span> }}>{text}</ReactMarkdown>
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
    {showLive && <article className="message live-message"><div className="message-author"><span className="hermes-mark">H</span>Hermes {working && <LoaderCircle size={13} className="spin"/>}</div><div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <BookmarkLink href={href} conversationId={conversationId}>{children}</BookmarkLink>, img: ({alt}) => <span>[{alt || 'Image'}]</span> }}>{liveText}</ReactMarkdown></div></article>}
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
function Preferences() {
  const state = useApp();
  return <><div className="page-heading"><div><div className="eyebrow">YOUR WORKSPACE</div><h1>Settings</h1><p>Private by default. In your control.</p></div></div><AppUpdateSettings/><SpaceSettings/><NotificationSettings/><ReadingSettings/><section className="settings-card"><div className="settings-icon"><Link2 size={22}/></div><div><h2>Hermes connection</h2><p>{state.gateway.online ? `Connected to your ${state.gateway.profile || 'default'} profile.` : state.gateway.configured ? 'Hermes is currently unavailable. Tasks remain usable.' : 'The Hermes connection has not been configured yet.'}</p><span className="source-tag">Hermes profile · {state.gateway.profile || 'default'}</span></div></section><section className="settings-card"><div className="settings-icon"><WifiOff size={22}/></div><div><h2>Saved on this device</h2><p>Tasks, drafts, recordings and viewed conversations stay available offline. Task changes sync when you return. Message drafts stay on this device until you send. Hermes messages are never automatically resent.</p><p className="subtle-note">Your device lock protects saved offline data. Clearing browser storage removes unsynced work.</p><button onClick={() => void refresh()} disabled={!navigator.onLine}>Sync now</button></div></section></>;
}
