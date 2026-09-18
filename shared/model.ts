import type { ConversationContext, ReadingState } from './reading.js';
export const statuses = ['inbox', 'next', 'waiting', 'parked', 'snoozed', 'done'] as const;
export type Status = typeof statuses[number];
export const labels: Record<Status, string> = { inbox: 'Inbox', next: 'Next', waiting: 'Waiting', parked: 'Parked', snoozed: 'Snoozed', done: 'Done' };
export interface Link { key: string; storedId: string; source: string; title: string }
export interface Task { id: string; contextId?: string; spaceId?: string; title: string; status: Status; previousStatus: Status; completedAt: number | null; snoozedUntil?: number | null; snoozeId?: string | null; createdAt: number; updatedAt: number; link: Link | null }
export interface List { ids: string[]; version: number }
export interface Space { id: string; name: string; createdAt: number; updatedAt: number }
export interface SpaceOp { id: string; spaceId: string; kind: 'create' | 'rename' | 'default'; at: number; name?: string; baseName?: string; baseDefaultSpaceId?: string }
// Stable identity for the pre-Spaces lists and unsynced operations from older clients.
export const originalSpaceId = '00000000-0000-4000-8000-000000000001';
export const newTaskLists = (): Record<Status, List> => Object.fromEntries(statuses.map(s => [s, { ids: [] as string[], version: 0 }])) as Record<Status, List>;
export interface Snapshot { tasks: Task[]; lists: Record<Status, List>; revision: number; hiddenConversations?: string[]; contexts?: ConversationContext[]; reading?: ReadingState; spaces?: Space[]; spaceLists?: Record<string, Record<Status, List>>; defaultSpaceId?: string }
export interface ConversationVisibilityOp { id: string; key: string; aliases: string[]; hidden: boolean; at: number }
export interface TaskOp {
  id: string; taskId: string; kind: 'create' | 'title' | 'move' | 'snooze'; at: number;
  title?: string; status?: Status; spaceId?: string; baseSpaceId?: string; beforeId?: string | null;
  baseTitle?: string; baseStatus?: Status; listVersion?: number;
  snoozedUntil?: number; baseSnoozeId?: string | null;
}
export interface Conversation { id: string; key: string; title: string; preview: string; source: string; updatedAt: number; aliases: string[]; linkedTaskId?: string; hidden?: boolean }
export function conversationHidden(conversation: Conversation, hiddenKeys: string[]): boolean {
  return [conversation.key, conversation.id, ...conversation.aliases].some(key => hiddenKeys.includes(key));
}
export function applyConversationVisibility(hiddenKeys: string[], op: ConversationVisibilityOp): string[] {
  const related = new Set([op.key, ...op.aliases]);
  const next = hiddenKeys.filter(key => !related.has(key));
  if (op.hidden) next.push(op.key);
  return next.sort();
}
export function conversationTaskId(conversation: Conversation, tasks: Task[]): string | undefined {
  const ids = [conversation.key, conversation.id, ...conversation.aliases];
  return tasks.find(task => task.link && (ids.includes(task.link.key) || ids.includes(task.link.storedId)))?.id;
}
export interface ChatMessage { id?: number | string; role: string; content?: string | unknown[]; text?: string; timestamp?: number; tool_calls?: unknown[]; display_kind?: string; [key: string]: unknown }
export type HistoryOrder = 'oldest' | 'latest';
export interface History { order?: HistoryOrder; sessionId: string; messages: ChatMessage[]; offset: number; hasMore: boolean; fetchedAt: number }
export type ActionState = 'preparing' | 'running' | 'awaiting_input' | 'stopping' | 'finished' | 'failed' | 'unknown' | 'ready';
export interface Approval { request_id: string; command?: string; description?: string; [key: string]: unknown }
export interface Binding { runtimeId: string; storedId: string; epoch: string; generation: string; seq: number; ready: boolean; monitored: boolean; known: boolean }
// taskId is the legacy wire/storage field for the canonical context ID. New
// requests use contextId; the server resolves legacy task IDs before dispatch.
export interface Action {
  id: string; taskId: string; contextId?: string; kind: 'send' | 'continue' | 'approve' | 'deny' | 'stop' | 'clarify';
  state: ActionState; phase: string; text: string; uploadIds: string[]; createdAt: number; updatedAt: number;
  receipt: 'pending' | 'accepted' | 'rejected' | 'unknown'; cancelled?: boolean; error?: string; binding?: Binding;
  approvalId?: string; targetId?: string; approvals?: Approval[]; clarification?: any; liveText?: string; terminal?: string;
  sendStage?: 'preparing' | 'submitting' | 'submitted'; turnStarted?: boolean; awaitingTurn?: boolean; cancelSend?: boolean;
}
export interface Upload { id: string; name: string; type: string; size: number; hash: string; complete: boolean }
export function emptySnapshot(): Snapshot { return withSpaces({ tasks: [], lists: newTaskLists(), revision: 0 }); }
export class Conflict extends Error { constructor(public reason: string) { super(reason); } }
export function withSpaces(input: Snapshot) {
  const spaces = input.spaces || [{ id: originalSpaceId, name: 'Personal', createdAt: 0, updatedAt: 0 }];
  // Normalize cached snapshots without changing old pending operation payloads.
  const spaceLists = Object.fromEntries(Object.entries(input.spaceLists || { [originalSpaceId]: input.lists }).map(([id, lists]) => [id, { ...newTaskLists(), ...lists }]));
  return { ...input, tasks: input.tasks.map(t => t.spaceId ? t : { ...t, spaceId: originalSpaceId }), spaces, spaceLists, defaultSpaceId: input.defaultSpaceId || originalSpaceId, lists: spaceLists[originalSpaceId] };
}
export function taskSpaceId(task: Task) { return task.spaceId || originalSpaceId; }
export function spaceName(snapshot: Snapshot, id?: string) { return withSpaces(snapshot).spaces.find(s => s.id === (id || originalSpaceId))?.name || 'Unavailable space'; }
export function spaceLists(snapshot: Snapshot, id: string) { return withSpaces(snapshot).spaceLists[id]; }
export function spacePath(id: string, status: Status = 'inbox') { return id === originalSpaceId ? `/tasks/${status}` : `/spaces/${id}/${status}`; }
export function applySpaceOp(input: Snapshot, op: SpaceOp, check = true): Snapshot {
  const s = withSpaces(structuredClone(input));
  const space = s.spaces.find(v => v.id === op.spaceId);
  if (op.kind === 'default') {
    if (!space) throw new Conflict('This space is not available.');
    if (check && s.defaultSpaceId !== op.baseDefaultSpaceId && s.defaultSpaceId !== op.spaceId) throw new Conflict('The default space changed on another device.');
    s.defaultSpaceId = space.id;
  } else {
    const name = op.name?.trim() || '';
    if (!name || name.length > 80) throw new Conflict('Use a space name between 1 and 80 characters.');
    if (check && s.spaces.some(v => v.id !== op.spaceId && v.name.toLowerCase() === name.toLowerCase())) throw new Conflict('A space with this name already exists. Choose another name.');
    if (op.kind === 'create') {
      if (space) throw new Conflict('This space already exists.');
      s.spaces.push({ id: op.spaceId, name, createdAt: op.at, updatedAt: op.at }); s.spaceLists[op.spaceId] = newTaskLists();
    } else {
      if (!space) throw new Conflict('This space is not available.');
      if (check && space.name !== op.baseName && space.name !== name) throw new Conflict('This space was renamed on another device.');
      space.name = name; space.updatedAt = op.at;
    }
  }
  s.revision++; return s;
}
export function applyTaskOp(input: Snapshot, op: TaskOp, check = true): Snapshot {
  const s = withSpaces(structuredClone(input));
  let task = s.tasks.find(t => t.id === op.taskId);
  if (op.kind === 'create') {
    if (task) throw new Conflict('This task already exists.');
    const spaceId = op.spaceId || originalSpaceId;
    if (!s.spaceLists[spaceId]) throw new Conflict('This space is not available. Sync the space before its tasks.');
    task = { id: op.taskId, spaceId, title: op.title!.trim(), status: 'inbox', previousStatus: 'inbox', completedAt: null, createdAt: op.at, updatedAt: op.at, link: null };
    s.tasks.push(task); s.spaceLists[spaceId].inbox.ids.unshift(task.id); s.spaceLists[spaceId].inbox.version++;
  } else {
    if (!task) throw new Conflict('This task no longer exists.');
    if (op.kind === 'title') {
      if (check && task.title !== op.baseTitle && task.title !== op.title?.trim()) throw new Conflict('The title changed on another device.');
      task.title = op.title!.trim();
    } else {
      const originSpace = taskSpaceId(task), destinationSpace = op.spaceId || originalSpaceId;
      if (check && (originSpace !== (op.baseSpaceId || originalSpaceId) || task.status !== op.baseStatus)) throw new Conflict('The task moved to another list or space on another device.');
      if (!s.spaceLists[destinationSpace]) throw new Conflict('This space is not available. Sync the space before moving tasks into it.');
      const crossing = originSpace !== destinationSpace;
      if (check && (task.snoozeId || null) !== (op.baseSnoozeId || null)) throw new Conflict('The reminder changed on another device.');
      if (op.kind === 'snooze' && (crossing || !['inbox','snoozed'].includes(task.status))) throw new Conflict('Only Inbox tasks can be snoozed. Move this task to Inbox first.');
      if (op.kind === 'snooze' && (!Number.isSafeInteger(op.snoozedUntil) || op.snoozedUntil! <= op.at || op.snoozedUntil! > 8_640_000_000_000_000)) throw new Conflict('Choose a future date and time for the reminder.');
      const destination = op.kind === 'snooze' ? 'snoozed' : crossing ? 'inbox' : op.status!;
      if (destination === 'snoozed' && op.kind !== 'snooze') throw new Conflict('Choose a reminder date and time to snooze this task.');
      const origin = task.status, from = s.spaceLists[originSpace][origin], to = s.spaceLists[destinationSpace][destination];
      if (check && !crossing && destination === origin && !['done','snoozed'].includes(destination) && to.version !== op.listVersion) throw new Conflict('This list was reordered on another device.');
      if (!crossing && destination === 'done' && origin === 'done') throw new Conflict('Done is ordered by completion time.');
      if (!crossing && op.beforeId && op.beforeId !== task.id && !to.ids.includes(op.beforeId)) throw new Conflict('The destination position changed.');
      from.ids = from.ids.filter(id => id !== task!.id); from.version++;
      if (destination === 'done') { task.previousStatus = origin === 'snoozed' ? 'inbox' : origin; task.completedAt = op.at; }
      else { task.completedAt = null; if (crossing) task.previousStatus = 'inbox'; }
      if (op.kind === 'snooze') { task.snoozedUntil = op.snoozedUntil; task.snoozeId = op.id; task.previousStatus = 'inbox'; }
      else { task.snoozedUntil = null; task.snoozeId = null; }
      task.status = destination; task.spaceId = destinationSpace;
      const before = crossing || op.beforeId === undefined ? 0 : op.beforeId === null ? to.ids.length : to.ids.indexOf(op.beforeId);
      to.ids.splice(Math.max(0, before), 0, task.id);
      if (to !== from) to.version++;
    }
    task.updatedAt = op.at;
  }
  for (const lists of Object.values(s.spaceLists)) {
    lists.done.ids.sort((a, b) => (s.tasks.find(t => t.id === b)?.completedAt ?? 0) - (s.tasks.find(t => t.id === a)?.completedAt ?? 0) || a.localeCompare(b));
    lists.snoozed.ids.sort((a, b) => (s.tasks.find(t => t.id === a)?.snoozedUntil ?? 0) - (s.tasks.find(t => t.id === b)?.snoozedUntil ?? 0) || a.localeCompare(b));
  }
  s.revision++; return s;
}
export function messageText(m: ChatMessage): string {
  if (typeof m.display_content === 'string') return m.display_content;
  if (typeof m.content === 'string') return m.content;
  if (Array.isArray(m.content)) return m.content.map((p: any) => p.text || (p.type === 'image_url' ? '[Image attachment]' : '')).filter(Boolean).join('\n');
  return m.text || '';
}
