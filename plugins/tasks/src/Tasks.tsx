import { TaskCapture } from './TaskCapture';
import { PageHeader, Button, IconButton, SectionNav, ItemList, EmptyState, StatusMessage, DialogFrame } from '@herts/plugin-api/client';
import { useEffect, useState, type FormEvent } from 'react';
import { Inbox, ArrowRight, Clock3, Pause, Check, Plus, ChevronLeft, ArrowUp, ArrowDown, AlarmClock, Pencil, CheckCheck } from 'lucide-react';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ConversationPanel, ConversationHeader, Voice, useDraftPersistence, useUpdateWork, useUpdatePreparation, pluginLocal, type RouteProps, type ConversationActionProps, conversationDrafts } from '@herts/plugin-api/client';
import { labels, statuses, originalSpaceId, taskSpaceId, spaceLists, spaceName, spacePath, type Status, type Task } from './model';
import { useApp, db, createTask, renameTask, moveTask, contextForTask, rememberSpace, refresh, createTaskFromConversation, resolveConflict } from './data';
import { TaskDragging, TaskDropLink, useTaskInteractions } from './TaskDragging';
import { SpaceTabs, SpaceSwitcher, SpaceSettings, SpaceConflict, useTaskDestination } from './Spaces';
import { TaskRow } from './TaskRow';
const icons = { inbox: Inbox, next: ArrowRight, waiting: Clock3, parked: Pause, snoozed: AlarmClock, done: CheckCheck };
function time(at: number) { return new Date(at).toLocaleString(); }
function TaskList({ spaceId, status, recordRequest }: {
    spaceId: string;
    status: Status;
    recordRequest?: string;
}) {
    const { snapshot } = useApp();
    const lists = spaceLists(snapshot, spaceId);
    const [edit, setEdit] = useState(false);
    const tasks = lists[status].ids.map(id => snapshot.tasks.find(t => t.id === id)!).filter(Boolean);
    const emptyDescription = { inbox: 'Add a task above, or find a conversation worth returning to.', next: 'Move tasks here when you want to work on them next.', waiting: 'Keep tasks here while waiting on someone or something.', parked: 'Keep tasks here until you want to return to them.', snoozed: 'Tasks with reminders appear here until they return to Inbox.', done: 'Completed tasks will appear here.' }[status];
    return <><SpaceTabs spaceId={spaceId}/><PageHeader title={labels[status]} count={tasks.length} actions={(tasks.length > 0 || edit) && <Button variant="quiet" className={edit ? 'selected' : ''} onClick={() => setEdit(!edit)}><Pencil size={15}/>{edit ? 'Finish editing' : 'Edit list'}</Button>}/>
    <SectionNav className="mobile-lists" aria-label="Task lists" data-list-position={`tasks:${spaceId}:${status}`}>{statuses.map(s => <TaskDropLink key={s} surface="tabs" spaceId={spaceId} status={s} current={s === status} className={s === status ? 'active' : ''}>{labels[s]} <small>{lists[s].ids.length}</small></TaskDropLink>)}</SectionNav>
    <TaskCapture spaceId={spaceId} recordRequest={recordRequest}/>
    <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}><ItemList className="task-list">{tasks.map((t, i) => <TaskRow key={t.id} task={t} edit={edit} index={i} tasks={tasks}/>)}</ItemList></SortableContext>
    {!tasks.length && <EmptyState className="list-empty" icon={status === 'done' ? <CheckCheck size={30}/> : <Inbox size={30}/>} title={status === 'inbox' ? 'A clear Inbox' : `Nothing ${status === 'next' ? 'up next' : status === 'done' ? 'completed yet' : `in ${labels[status]}`}`} description={emptyDescription}>{status === 'inbox' && <a className="text-link" href="#/conversations">Browse Hermes conversations <ArrowRight size={15}/></a>}</EmptyState>}
  </>;
}
function TaskDetail({ task }: {
    task: Task;
}) {
    const state = useApp();
    const { snooze } = useTaskInteractions();
    const [title, setTitle] = useState(task.title);
    const savingTitle = useUpdateWork();
    useUpdatePreparation({ blocked: () => title.trim() !== task.title ? 'The task title is still being saved. Please try updating again after it is saved.' : undefined });
    useEffect(() => setTitle(task.title), [task.title]);
    return <div className="task-detail"><ConversationHeader title={title || task.title} backHref={`#${spacePath(taskSpaceId(task), task.status)}`} backLabel={`${spaceName(state.snapshot, taskSpaceId(task))} / ${labels[task.status]}`} context={contextForTask(task.id)}><div className="detail-heading"><textarea className="detail-title" aria-label="Task title" rows={2} value={title} onChange={e => setTitle(e.target.value)} onBlur={() => { if (title.trim() && title !== task.title)
        void savingTitle(renameTask(task.id, title));
    else
        setTitle(task.title); }}/><div className="detail-controls"><select aria-label="Task space" value={taskSpaceId(task)} onChange={e => void moveTask(task.id, 'inbox', undefined, e.target.value)}>{state.snapshot.spaces?.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}</select><select aria-label="Task list" value={task.status} onChange={e => { if (e.target.value === 'snoozed')
        snooze(task);
    else
        void moveTask(task.id, e.target.value as Status); }}>{statuses.filter(s => s !== 'snoozed' || ['inbox', 'snoozed'].includes(task.status)).map(s => <option key={s} value={s}>{labels[s]}</option>)}</select>{task.status === 'inbox' && <button className="quiet-button" onClick={() => snooze(task)}><AlarmClock size={16}/>Snooze</button>}{task.status === 'snoozed' && <><button className="quiet-button" onClick={() => snooze(task)}><AlarmClock size={16}/>Change reminder</button><button className="quiet-button" onClick={() => void moveTask(task.id, 'inbox')}>Unsnooze</button></>}<button className="quiet-button" onClick={() => void moveTask(task.id, task.status === 'done' ? ['done', 'snoozed'].includes(task.previousStatus) ? 'inbox' : task.previousStatus : 'done')}><Check size={16}/>{task.status === 'done' ? 'Reopen task' : 'Complete task'}</button></div>{task.status === 'snoozed' && task.snoozedUntil && <p className="snooze-detail-time"><AlarmClock size={14}/> Back in Inbox {time(task.snoozedUntil)}</p>}</div></ConversationHeader><ConversationPanel context={contextForTask(task.id)!} showActions={false}/></div>;
}
export function TasksScreen({ path, parts, recordRequest, shared }: RouteProps) {
    const state = useApp();
    let [screen, id, status] = parts;
    const [record, setRecord] = useState<string>();
    useEffect(() => { if (path === '/tasks/inbox/record') {
        const target = spacePath(state.snapshot.defaultSpaceId || originalSpaceId);
        history.replaceState(history.state, '', `/#${target}`);
        setRecord(crypto.randomUUID());
        dispatchEvent(new PopStateEvent('popstate'));
    } }, [path]);
    const task = screen === 'task' ? state.snapshot.tasks.find(t => t.id === id) : undefined;
    const space = task ? taskSpaceId(task) : screen === 'spaces' ? id : screen === 'tasks' && id ? originalSpaceId : state.viewedSpaceId;
    const selected = screen === 'spaces' ? status : id;
    const current = statuses.includes(selected as Status) ? selected as Status : 'inbox';
    useEffect(() => { if (state.snapshot.spaces?.some(s => s.id === space))
        rememberSpace(space); }, [space]);
    if (screen === 'plugins' && id === 'tasks' && status === 'reminders')
        return <ReminderSummary id={parts[3]}/>;
    if (path === '/plugins/tasks/share' && shared)
        return <TaskCapture spaceId={state.snapshot.defaultSpaceId || originalSpaceId} shared={shared}/>;
    if (screen === 'plugins' && id === 'tasks' && status === 'capture') return <TaskCapture spaceId={parts[3]} id={parts[4]}/>;
    if (screen === 'task')
        return task ? <TaskDetail key={task.id} task={task}/> : <div className="empty"><p>This task is not available on this device yet.</p><button onClick={() => void refresh()}>Refresh</button></div>;
    return state.snapshot.spaces?.some(s => s.id === space) ? <TaskList key={`${space}:${current}`} spaceId={space} status={current} recordRequest={record || recordRequest}/> : <div className="empty"><p>This space was removed or is not available on this device yet.</p><a href={`#${spacePath(state.viewedSpaceId)}`}>Go to {spaceName(state.snapshot, state.viewedSpaceId)} Inbox</a><button onClick={() => void refresh()}>Refresh</button></div>;
}
export function TasksSidebar({ parts }: RouteProps) {
    const state = useApp();
    const [screen, id, status] = parts;
    const task = screen === 'task' ? state.snapshot.tasks.find(t => t.id === id) : undefined, space = task ? taskSpaceId(task) : screen === 'spaces' && state.snapshot.spaces?.some(s => s.id === id) ? id : state.viewedSpaceId;
    const lists = spaceLists(state.snapshot, space);
    return <><SpaceSwitcher spaceId={space}/><nav aria-label="Task lists">{statuses.map(s => { const Icon = icons[s]; return <TaskDropLink key={s} surface="sidebar" spaceId={space} status={s} className={`nav-item ${(task?.status || (screen === 'spaces' ? status : id)) === s ? 'active' : ''}`}><Icon size={19}/><span>{labels[s]}</span><small>{lists?.[s].ids.length || ''}</small></TaskDropLink>; })}</nav></>;
}
export function TaskActions({ context, conversation }: ConversationActionProps) {
    const state = useApp(), destination = useTaskDestination(conversation.key);
    const linked = state.snapshot.tasks.find(t => (!!context && t.contextId === context.id) || t.link?.key === conversation.key);
    const [open, setOpen] = useState(false), [title, setTitle] = useState(conversation.title), [busy, setBusy] = useState(false), [error, setError] = useState('');
    useUpdatePreparation({ blocked: () => open || busy ? 'Finish or cancel creating the task before updating.' : undefined });
    if (context && !context.link)
        return null;
    if (linked && location.hash === `#/task/${linked.id}`)
        return null;
    async function save(e: FormEvent) { e.preventDefault(); setBusy(true); setError(''); try {
        const id = await createTaskFromConversation(conversation.key, title, destination);
        location.hash = `/task/${id}`;
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } }
    return linked ? <button className="quiet-button" onClick={() => { location.hash = `/task/${linked.id}`; }}>Open task <ArrowRight size={15}/></button> : <><button className="quiet-button" disabled={!state.online} onClick={() => { setTitle(conversation.title); setError(''); setOpen(true); }}><Plus size={16}/> Make a task</button>{open && <DialogFrame close={() => setOpen(false)} busy={busy} aria-labelledby="create-task-title"><form className="create-from-chat" onSubmit={save}><h2 id="create-task-title">Make a task</h2><label>New task in {spaceName(state.snapshot, destination)} Inbox<input autoFocus aria-label="New task from conversation title" value={title} maxLength={2000} onChange={e => setTitle(e.target.value)}/></label><div className="button-row"><button disabled={busy || !title.trim()}>Create task</button><button type="button" disabled={busy} onClick={() => setOpen(false)}>Cancel</button></div>{error && <p role="alert">{error}</p>}</form></DialogFrame>}</>;
}
export function TaskConflicts() { const state = useApp(); return <>{state.pending.filter(p => p.conflict).map(p => <div className="conflict-banner" key={p.id}><strong>A change needs your choice</strong><p>{p.conflict}</p><p>Your change: {p.op.title || (p.op.kind === 'snooze' ? `Snooze until ${new Date(p.op.snoozedUntil!).toLocaleString()}` : p.op.status || 'Task reminder')}</p><p>Synced version: {state.remote.tasks.find(t => t.id === p.op.taskId)?.title}</p>{p.op.spaceId && !state.remote.spaces?.some(s => s.id === p.op.spaceId) && <p>The space was deleted. Keeping this change saves it in {spaceName(state.remote, state.remote.defaultSpaceId)} Inbox.</p>}<div className="button-row"><button onClick={() => void resolveConflict(p.id, true)}>Keep my change</button><button onClick={() => void resolveConflict(p.id, false)}>Use synced version</button></div></div>)}{state.spacePending.filter(p => p.conflict).map(p => <SpaceConflict key={p.id} pending={p}/>)}</>; }
function ReminderSummary({ id }: {
    id: string;
}) { const state = useApp(); const tasks = (state.pluginData.tasks?.records[`catchup:${id}`] || []) as {
    id: string;
    title: string;
    space: string;
}[]; return <><h1>Missed reminders</h1><p>These tasks returned to Inbox when Tasks was enabled.</p>{tasks.map(t => <p key={t.id}><a href={`#/task/${t.id}`}>{t.title}</a> · {t.space}</p>)}</>; }
