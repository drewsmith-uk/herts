import { useCore, getCore, pluginLocal, mutatePlugin, resolvePluginOperation, sync, refresh, conversationDrafts, createLocalConversation, entryDraftStatus, type CoreState } from '@herts/plugin-api/client';
import { conversationTaskId, applySpaceOp, emptySnapshot, originalSpaceId, taskSpaceId, spaceLists, spaceName, type Snapshot, type TaskOp, type SpaceOp, type Status, type Task } from './model';
export interface Pending {
    id: string;
    op: TaskOp;
    order: number;
    conflict?: string;
}
export interface PendingSpace {
    id: string;
    op: SpaceOp;
    order: number;
    conflict?: string;
}
function adapt(core: CoreState) {
    const data = (core.pluginData.tasks?.records.state || emptySnapshot()) as Snapshot, remote = (core.pluginRemote.tasks?.records.state || emptySnapshot()) as Snapshot;
    const project = (s: Snapshot) => ({ ...s, contexts: core.snapshot.contexts, tasks: s.tasks.map(t => ({ ...t, link: core.snapshot.contexts.find(c => c.id === t.contextId)?.link || t.link })) });
    const pending = core.pluginPending.filter(p => p.pluginId === 'tasks');
    return { ...core, snapshot: project(data), remote: project(remote), pending: pending.filter(p => p.operation.command === 'task').map(p => ({ id: p.id, op: p.operation.input as TaskOp, order: p.order, conflict: p.conflict })), spacePending: pending.filter(p => p.operation.command === 'space').map(p => ({ id: p.id, op: p.operation.input as SpaceOp, order: p.order, conflict: p.conflict })), viewedSpaceId: data.spaces?.some(s => s.id === localViewed) ? localViewed : data.defaultSpaceId || originalSpaceId };
}
let localViewed = '';
export function useApp() { return adapt(useCore()); }
const current = () => adapt(getCore());
export const db = { get kv() { return pluginLocal('tasks').kv; }, get drafts() { return pluginLocal('tasks').drafts; } };
export { refresh };
export async function initialiseTasks() { const saved = await db.kv.get('viewed-space'); localViewed = saved?.value || ''; await refresh(); }
export function rememberSpace(id: string) { localViewed = id; void db.kv.put({ key: 'viewed-space', value: id }); }
export async function mutate(op: TaskOp) { return mutatePlugin('tasks', 'task', op, op.taskId); }
export async function createTask(title: string, spaceId = current().snapshot.defaultSpaceId || originalSpaceId, taskId: string = crypto.randomUUID()) { if (!current().snapshot.tasks.some(task => task.id === taskId)) await mutate({ id: taskId, taskId, spaceId, kind: 'create', title: title.trim(), at: Date.now() }); return taskId; }
export function renameTask(taskId: string, title: string) { const task = current().snapshot.tasks.find(t => t.id === taskId)!; return mutate({ id: crypto.randomUUID(), taskId, kind: 'title', title, baseTitle: task.title, at: Date.now() }); }
export function moveTask(taskId: string, status: Status, beforeId?: string | null, destinationSpace?: string) { const state = current(), task = state.snapshot.tasks.find(t => t.id === taskId)!; const baseSpaceId = taskSpaceId(task), spaceId = destinationSpace || baseSpaceId; return mutate({ id: crypto.randomUUID(), taskId, kind: 'move', spaceId, baseSpaceId, status: spaceId !== baseSpaceId ? 'inbox' : status, beforeId, baseStatus: task.status, baseSnoozeId: task.snoozeId || null, listVersion: spaceLists(state.snapshot, spaceId)[spaceId !== baseSpaceId ? 'inbox' : status].version, at: Date.now() }); }
export function snoozeTask(task: Task, until: number) { const now = current().snapshot.tasks.find(t => t.id === task.id); if (!now || now.status !== task.status || taskSpaceId(now) !== taskSpaceId(task) || now.snoozeId !== task.snoozeId)
    throw new Error('This task or reminder changed. Close this picker and open it again.'); if (!Number.isFinite(until) || until <= Date.now())
    throw new Error('Choose a future date and time.'); return mutate({ id: crypto.randomUUID(), taskId: task.id, kind: 'snooze', spaceId: taskSpaceId(task), baseSpaceId: taskSpaceId(task), baseStatus: task.status, baseSnoozeId: task.snoozeId || null, snoozedUntil: until, at: Date.now() }); }
export function contextForTask(id: string) { const state = current(), task = state.snapshot.tasks.find(t => t.id === id); return task ? (state.snapshot.contexts.find(c => c.id === task.contextId) || { id: task.contextId || task.id, title: task.title, link: task.link, aliases: task.link ? [task.link.key, task.link.storedId] : [] }) : undefined; }
export async function createTaskFromConversation(id: string, title: string, spaceId = current().snapshot.defaultSpaceId || originalSpaceId) {
    const key = `link-intent:${id}`, prior = (await db.kv.get(key))?.value;
    if (prior && prior.title !== title)
        throw new Error('A previous task-creation request is unconfirmed. Use the original title to check it.');
    const intent = prior || { id: crypto.randomUUID(), taskId: crypto.randomUUID(), title, spaceId, at: Date.now() };
    if (!prior)
        await db.kv.put({ key, value: intent });
    if (!current().snapshot.tasks.some(t => t.id === intent.taskId) && !getCore().pluginPending.some(p => p.id === intent.id))
        await mutatePlugin('tasks', 'link', { ...intent, conversationId: id });
    await sync();
    const task = current().snapshot.tasks.find(t => t.id === intent.taskId);
    if (!task)
        throw new Error('The task request is saved. Reconnect or resolve its conflict before retrying.');
    await db.kv.delete(key);
    return task.id;
}
export async function mutateSpace(op: SpaceOp) { applySpaceOp(current().snapshot, op); return mutatePlugin('tasks', 'space', op); }
export async function createSpace(name: string) { const spaceId = crypto.randomUUID(); await mutateSpace({ id: crypto.randomUUID(), spaceId, kind: 'create', name: name.trim(), at: Date.now() }); return spaceId; }
export async function renameSpace(spaceId: string, name: string) { const space = current().snapshot.spaces!.find(s => s.id === spaceId)!; await mutateSpace({ id: crypto.randomUUID(), spaceId, kind: 'rename', name: name.trim(), baseName: space.name, at: Date.now() }); }
export async function setDefaultSpace(spaceId: string) { await mutateSpace({ id: crypto.randomUUID(), spaceId, kind: 'default', baseDefaultSpaceId: current().snapshot.defaultSpaceId || originalSpaceId, at: Date.now() }); }
export async function deleteSpace(spaceId: string) {
    const state = current(), space = state.snapshot.spaces!.find(s => s.id === spaceId);
    if (!space) return;
    const local = pluginLocal('tasks');
    if (!local.hasRecording) throw new Error('Update Herts before deleting a space.');
    const draft = await local.drafts.get(`capture:${spaceId}`);
    const entry = await entryDraftStatus('tasks', `capture:${spaceId}`);
    if (draft?.text?.trim() || draft?.files.length || entry.draft) throw new Error('Save or clear the draft in this space before deleting it.');
    if (entry.recording || await local.hasRecording(`capture:${spaceId}`)) throw new Error('Transcribe or discard the saved recording in this space before deleting it.');
    await mutateSpace({ id: crypto.randomUUID(), spaceId, kind: 'delete', baseName: space.name, baseDefaultSpaceId: state.snapshot.defaultSpaceId, at: Date.now() });
}
export async function resolveConflict(id: string, keep: boolean) { const state = current(), p = state.pending.find(p => p.id === id); if (!p)
    return; const task = state.remote.tasks.find(t => t.id === p.op.taskId); const destination = state.remote.spaces?.some(s => s.id === (p.op.spaceId || originalSpaceId)) ? p.op.spaceId || originalSpaceId : state.remote.defaultSpaceId || originalSpaceId; return resolvePluginOperation(id, keep ? { ...p.op, at: Date.now(), baseTitle: task?.title, baseStatus: task?.status, baseSnoozeId: task?.snoozeId || null, baseSpaceId: task ? taskSpaceId(task) : originalSpaceId, spaceId: destination, listVersion: spaceLists(state.remote, destination)?.[p.op.status || task?.status || 'inbox'].version } : undefined); }
export async function resolveSpaceConflict(id: string, keep: boolean, name?: string) { const state = current(), p = state.spacePending.find(p => p.id === id); if (!p)
    return; if (p.op.kind === 'create' && !keep)
    throw new Error('Choose a new name to preserve this space and its saved tasks.'); return resolvePluginOperation(id, keep ? { ...p.op, at: Date.now(), ...(name !== undefined ? { name: name.trim() } : {}), ...(['rename', 'delete'].includes(p.op.kind) ? { baseName: state.remote.spaces?.find(s => s.id === p.op.spaceId)?.name } : {}), ...(['default', 'delete'].includes(p.op.kind) ? { baseDefaultSpaceId: state.remote.defaultSpaceId } : {}) } : undefined); }

export function linkedTaskId(conversation:import('@herts/plugin-api/types').Conversation){return conversationTaskId(conversation,current().snapshot.tasks);}
export function taskInboxName(id: string) {
    const { snapshot } = current();
    return `${spaceName(snapshot, snapshot.tasks.find(t => t.id === id)?.spaceId)} Inbox`;
}
