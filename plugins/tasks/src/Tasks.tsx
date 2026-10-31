import { TaskCapture } from './TaskCapture';
import { ComposerPlaceholder, ActionRow, RenameAction, FormDialog, FormField, PageHeader, Button, IconButton, SectionNav, ItemList, EmptyState, StatusMessage } from '@herts/plugin-api/client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Inbox, ArrowRight, Clock3, Pause, Check, Plus, ChevronLeft, ArrowUp, ArrowDown, AlarmClock, Pencil, CheckCheck } from 'lucide-react';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ConversationPanel, ConversationHeader, Voice, useDraftPersistence, useUpdateWork, useUpdatePreparation, pluginLocal, type RouteProps, type ConversationActionProps, conversationDrafts } from '@herts/plugin-api/client';
import { labels, statuses, originalSpaceId, taskSpaceId, spaceLists, spaceName, spacePath, type Status, type Task } from './model';
import { useApp, db, createTask, renameTask, moveTask, contextForTask, rememberSpace, refresh, createTaskFromConversation, conversationTaskIntent, discardLinkConflict, resolveConflict } from './data';
import { TaskDragging, TaskDropLink, useTaskInteractions } from './TaskDragging';
import { SpaceTabs, SpaceSwitcher, SpaceSettings, SpaceConflict } from './Spaces';
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
    const tasks = lists[status].ids.map(id => snapshot.tasks.find(t => t.id === id)!).filter(Boolean);
    const emptyDescription = { inbox: 'Add a task above, or find a conversation worth returning to.', next: 'Move tasks here when you want to work on them next.', waiting: 'Keep tasks here while waiting on someone or something.', parked: 'Keep tasks here until you want to return to them.', snoozed: 'Tasks with reminders appear here until they return to Inbox.', done: 'Completed tasks will appear here.' }[status];
    return <><SpaceTabs spaceId={spaceId}/><PageHeader title={labels[status]} count={tasks.length}/>
    <SectionNav className="mobile-lists" aria-label="Task lists" data-list-position={`tasks:${spaceId}:${status}`}>{statuses.map(s => <TaskDropLink key={s} surface="tabs" spaceId={spaceId} status={s} current={s === status} className={s === status ? 'active' : ''}>{labels[s]} <small>{lists[s].ids.length}</small></TaskDropLink>)}</SectionNav>
    <TaskCapture spaceId={spaceId} recordRequest={recordRequest}/>
    <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}><ItemList className="task-list">{tasks.map((t, i) => <TaskRow key={t.id} task={t} index={i} tasks={tasks}/>)}</ItemList></SortableContext>
    {!tasks.length && <EmptyState className="list-empty" icon={status === 'done' ? <CheckCheck size={30}/> : <Inbox size={30}/>} title={status === 'inbox' ? 'A clear Inbox' : `Nothing ${status === 'next' ? 'up next' : status === 'done' ? 'completed yet' : `in ${labels[status]}`}`} description={emptyDescription}>{status === 'inbox' && <a className="text-link" href="#/conversations">Browse Hermes conversations <ArrowRight size={15}/></a>}</EmptyState>}
  </>;
}
function TaskDetail({ task }: {
    task: Task;
}) {
    const state = useApp();
    const { snooze } = useTaskInteractions();
    const [moving, setMoving] = useState<'list' | 'space'>(), [destination, setDestination] = useState('');
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    const work = useUpdateWork();
    async function move(status: Status, space?: string) {
      if (busy) return;
      setBusy(true); setError('');
      try { await work(moveTask(task.id, status, undefined, space)); setMoving(undefined); }
      catch (error) { setError((error as Error).message); }
      finally { setBusy(false); }
    }
    function choose(kind: 'list' | 'space') { setError(''); setMoving(kind); setDestination(kind === 'list' ? task.status : taskSpaceId(task)); }
    return <div className="task-detail"><ConversationHeader title={task.title} backHref={`#${spacePath(taskSpaceId(task), task.status)}`} backLabel={`${spaceName(state.snapshot, taskSpaceId(task))} / ${labels[task.status]}`} context={contextForTask(task.id)}>
      <RenameAction title={task.title} label="Rename task" fieldLabel="Task title" save={(title, base) => renameTask(task.id, title, base)}/>
      <ActionRow icon={<ArrowRight size={20}/>} value={labels[task.status]} onClick={() => choose('list')}>Move to list</ActionRow>
      <ActionRow icon={<Inbox size={20}/>} value={spaceName(state.snapshot, taskSpaceId(task))} onClick={() => choose('space')}>Move to space</ActionRow>
      {['inbox', 'snoozed'].includes(task.status) && <ActionRow icon={<AlarmClock size={20}/>} onClick={() => snooze(task)}>{task.status === 'snoozed' ? 'Change reminder' : 'Snooze'}</ActionRow>}
      {task.status === 'snoozed' && <ActionRow icon={<Clock3 size={20}/>} disabled={busy} onClick={() => void move('inbox')}>Unsnooze</ActionRow>}
      <ActionRow icon={<Check size={20}/>} disabled={busy} onClick={() => void move(task.status === 'done' ? ['done', 'snoozed'].includes(task.previousStatus) ? 'inbox' : task.previousStatus : 'done')}>{task.status === 'done' ? 'Reopen task' : 'Complete task'}</ActionRow>
      {task.status === 'snoozed' && task.snoozedUntil && <p className="snooze-detail-time">Back in Inbox {time(task.snoozedUntil)}</p>}
      {error && !moving && <StatusMessage>{error}</StatusMessage>}
      {moving && <FormDialog id="move-task" title={moving === 'list' ? 'Move to list' : 'Move to space'} close={() => setMoving(undefined)} busy={busy} error={error}
        onSubmit={event => { event.preventDefault(); if (moving === 'list' && destination === 'snoozed') { setMoving(undefined); snooze(task); } else void move(moving === 'list' ? destination as Status : 'inbox', moving === 'space' ? destination : undefined); }}
        footer={<div className="button-row"><Button disabled={busy} onClick={() => setMoving(undefined)}>Cancel</Button><Button type="submit" variant="primary" disabled={busy}>{busy ? 'Moving…' : 'Move'}</Button></div>}>
        <FormField label={moving === 'list' ? 'Task list' : 'Task space'}><select disabled={busy} value={destination} onChange={event => setDestination(event.target.value)}>{moving === 'list' ? statuses.filter(s => s !== 'snoozed' || ['inbox', 'snoozed'].includes(task.status)).map(s => <option key={s} value={s}>{labels[s]}</option>) : state.snapshot.spaces?.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}</select></FormField>
        {moving === 'space' && <p>Move to Inbox in this space.</p>}
      </FormDialog>}
    </ConversationHeader><ConversationPanel fullTitle={task.title} context={contextForTask(task.id)!} showActions={false} showHeading={false}/></div>;
}
export function TasksScreen({ path, parts, recordRequest, shared }: RouteProps) {
    const state = useApp();
    let [screen, id, status] = parts;
    const [record, setRecord] = useState<string>();
    const tasksReady = !!state.pluginData.tasks?.records.state;
    useEffect(() => { if (path === '/tasks/inbox/record' && tasksReady) {
        const target = spacePath(state.snapshot.defaultSpaceId || originalSpaceId);
        history.replaceState(history.state, '', `/#${target}`);
        setRecord(crypto.randomUUID());
        dispatchEvent(new PopStateEvent('popstate'));
    } }, [path, tasksReady, state.snapshot.defaultSpaceId]);
    const task = screen === 'task' ? state.snapshot.tasks.find(t => t.id === id) : undefined;
    const space = task ? taskSpaceId(task) : screen === 'spaces' ? id : screen === 'tasks' && id ? (state.snapshot.spaces?.some(s => s.id === originalSpaceId) ? originalSpaceId : state.snapshot.defaultSpaceId || state.viewedSpaceId) : state.viewedSpaceId;
    const selected = screen === 'spaces' ? status : id;
    const current = statuses.includes(selected as Status) ? selected as Status : 'inbox';
    useEffect(() => { if (state.snapshot.spaces?.some(s => s.id === space))
        rememberSpace(space); }, [space]);
    if (path === '/tasks/inbox/record' && !tasksReady) return <ComposerPlaceholder/>;
    if (screen === 'plugins' && id === 'tasks' && status === 'reminders')
        return <ReminderSummary id={parts[3]}/>;
    if (path === '/plugins/tasks/share' && shared)
        return <TaskCapture spaceId={state.snapshot.defaultSpaceId || originalSpaceId} shared={shared}/>;
    if (screen === 'plugins' && id === 'tasks' && status === 'capture') return <TaskCapture spaceId={parts[3]} id={parts[4]}/>;
    if (screen === 'task')
        return task ? <TaskDetail key={task.id} task={task}/> : <div className="empty"><p>This task is not available on this device yet.</p><button onClick={() => void refresh()}>Refresh</button></div>;
    return state.snapshot.spaces?.some(s => s.id === space) ? <TaskList key={space} spaceId={space} status={current} recordRequest={record || recordRequest}/> : <div className="empty"><p>This space was removed or is not available on this device yet.</p><a href={`#${spacePath(state.viewedSpaceId)}`}>Go to {spaceName(state.snapshot, state.viewedSpaceId)} Inbox</a><button onClick={() => void refresh()}>Refresh</button></div>;
}
export function TasksSidebar({ parts }: RouteProps) {
    const state = useApp();
    const [screen, id, status] = parts;
    const task = screen === 'task' ? state.snapshot.tasks.find(t => t.id === id) : undefined, space = task ? taskSpaceId(task) : screen === 'spaces' && state.snapshot.spaces?.some(s => s.id === id) ? id : state.viewedSpaceId;
    const lists = spaceLists(state.snapshot, space);
    return <><SpaceSwitcher spaceId={space}/><nav aria-label="Task lists">{statuses.map(s => { const Icon = icons[s]; return <TaskDropLink key={s} surface="sidebar" spaceId={space} status={s} className={`nav-item ${(task?.status || (screen === 'spaces' ? status : id)) === s ? 'active' : ''}`}><Icon size={19}/><span>{labels[s]}</span><small>{lists?.[s].ids.length || ''}</small></TaskDropLink>; })}</nav></>;
}
export function TaskActions({ context, conversation, suggestedTitle }: ConversationActionProps) {
    const state = useApp();
    const [destination, setDestination] = useState(originalSpaceId), [list, setList] = useState<Status>('inbox');
    const defaultTitle = suggestedTitle || conversation.title;
    const linked = state.snapshot.tasks.find(t => (!!context && t.contextId === context.id) || t.link?.key === conversation.key);
    const [open, setOpen] = useState(false), [title, setTitle] = useState(defaultTitle), [busy, setBusy] = useState(false), [error, setError] = useState('');
    useUpdatePreparation({ blocked: () => open || busy ? 'Finish or cancel creating the task before updating.' : undefined });
    if (context && !context.link)
        return null;
    if (linked && location.hash === `#/task/${linked.id}`)
        return null;
    async function openDialog() {
        setOpen(true); setBusy(true); setError(''); setTitle(defaultTitle);
        setDestination(state.snapshot.defaultSpaceId || originalSpaceId); setList('inbox');
        try {
            const prior = await conversationTaskIntent(conversation.key);
            if (prior) { setTitle(prior.title); setDestination(prior.spaceId || originalSpaceId); setList(prior.status || 'inbox'); }
        } catch { setError('The saved request could not be read. Close this dialog and try again.'); }
        finally { setBusy(false); }
    }
    async function save(e: FormEvent) { e.preventDefault(); setBusy(true); setError(''); try {
        const id = await createTaskFromConversation(conversation.key, title, destination, list);
        location.hash = `/task/${id}`;
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } }
    return linked ? <ActionRow icon={<ArrowRight size={20}/>} onClick={() => { location.hash = `/task/${linked.id}`; }}>Open task</ActionRow> : <>
        <ActionRow icon={<Plus size={20}/>} disabled={busy} onClick={() => void openDialog()}>Make a task</ActionRow>
        {open && <FormDialog id="create-task-title" title="Make a task" close={() => setOpen(false)} busy={busy} onSubmit={save} error={error || (!state.online ? 'Reconnect to create this task.' : '')}
            footer={<div className="button-row"><Button disabled={busy} onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="primary" disabled={busy || !state.online || !title.trim()}>Create task</Button></div>}>
            <FormField label="Title">
                <input autoFocus aria-label="New task from conversation title" value={title} maxLength={2000} disabled={busy} onChange={e => setTitle(e.target.value)}/>
            </FormField>
            <FormField label="Space"><select value={destination} disabled={busy} onChange={e => setDestination(e.target.value)}>
                {!state.snapshot.spaces?.some(space => space.id === destination) && <option value={destination}>Unavailable space</option>}
                {state.snapshot.spaces?.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}
            </select></FormField>
            <FormField label="List"><select value={list} disabled={busy} onChange={e => setList(e.target.value as Status)}>
                {statuses.filter(status => status !== 'snoozed').map(status => <option key={status} value={status}>{labels[status]}</option>)}
            </select></FormField>
        </FormDialog>}
    </>;
}
function LinkConflict({ pending }: { pending: ReturnType<typeof useApp>['linkPending'][number] }) {
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    async function discard() {
        if (busy) return;
        setBusy(true); setError('');
        try { await discardLinkConflict(pending.id); }
        catch (e) { setError((e as Error).message); }
        finally { setBusy(false); }
    }
    return <StatusMessage tone="warning" className="conflict-banner">
        <strong>The task could not be created</strong><p>{pending.op.title}</p><p>{pending.conflict}</p>
        <p>Discard this request, then choose a space in Make a task.</p>
        <Button disabled={busy} onClick={() => void discard()}>Discard task request</Button>
        {error && <StatusMessage>{error}</StatusMessage>}
    </StatusMessage>;
}
export function TaskConflicts() { const state = useApp(); return <>{state.linkPending.filter(p => p.conflict).map(p => <LinkConflict key={p.id} pending={p}/>)}{state.pending.filter(p => p.conflict).map(p => <div className="conflict-banner" key={p.id}><strong>A change needs your choice</strong><p>{p.conflict}</p><p>Your change: {p.op.title || (p.op.kind === 'snooze' ? `Snooze until ${new Date(p.op.snoozedUntil!).toLocaleString()}` : p.op.status || 'Task reminder')}</p><p>Synced version: {state.remote.tasks.find(t => t.id === p.op.taskId)?.title}</p>{p.op.spaceId && !state.remote.spaces?.some(s => s.id === p.op.spaceId) && <p>The space was deleted. Keeping this change saves it in {spaceName(state.remote, state.remote.defaultSpaceId)} Inbox.</p>}<div className="button-row"><button onClick={() => void resolveConflict(p.id, true)}>Keep my change</button><button onClick={() => void resolveConflict(p.id, false)}>Use synced version</button></div></div>)}{state.spacePending.filter(p => p.conflict).map(p => <SpaceConflict key={p.id} pending={p}/>)}</>; }
function ReminderSummary({ id }: {
    id: string;
}) { const state = useApp(); const tasks = (state.pluginData.tasks?.records[`catchup:${id}`] || []) as {
    id: string;
    title: string;
    space: string;
}[]; return <><h1>Missed reminders</h1><p>These tasks returned to Inbox when Tasks was enabled.</p>{tasks.map(t => <p key={t.id}><a href={`#/task/${t.id}`}>{t.title}</a> · {t.space}</p>)}</>; }
