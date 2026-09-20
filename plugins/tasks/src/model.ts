import { Conflict, type Link, type Conversation, type ConversationContext } from '@herts/plugin-api/types';
export const statuses = ['inbox', 'next', 'waiting', 'parked', 'snoozed', 'done'] as const;
export type Status = typeof statuses[number];
export const labels: Record<Status, string> = { inbox: 'Inbox', next: 'Next', waiting: 'Waiting', parked: 'Parked', snoozed: 'Snoozed', done: 'Done' };
export interface Task {
    id: string;
    contextId?: string;
    spaceId?: string;
    title: string;
    status: Status;
    previousStatus: Status;
    completedAt: number | null;
    snoozedUntil?: number | null;
    snoozeId?: string | null;
    createdAt: number;
    updatedAt: number;
    link: Link | null;
}
export interface List {
    ids: string[];
    version: number;
}
export interface Space {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
}
export interface SpaceOp {
    id: string;
    spaceId: string;
    kind: 'create' | 'rename' | 'default' | 'delete';
    at: number;
    name?: string;
    baseName?: string;
    baseDefaultSpaceId?: string;
}
// Stable identity for the pre-Spaces lists and unsynced operations from older clients.
export const originalSpaceId = '00000000-0000-4000-8000-000000000001';
export const newTaskLists = (): Record<Status, List> => Object.fromEntries(statuses.map(s => [s, { ids: [] as string[], version: 0 }])) as Record<Status, List>;
export interface Snapshot {
    tasks: Task[];
    lists: Record<Status, List>;
    revision: number;
    hiddenConversations?: string[];
    contexts?: ConversationContext[];
    spaces?: Space[];
    spaceLists?: Record<string, Record<Status, List>>;
    defaultSpaceId?: string;
}
export interface TaskOp {
    id: string;
    taskId: string;
    kind: 'create' | 'title' | 'move' | 'snooze';
    at: number;
    title?: string;
    status?: Status;
    spaceId?: string;
    baseSpaceId?: string;
    beforeId?: string | null;
    baseTitle?: string;
    baseStatus?: Status;
    listVersion?: number;
    snoozedUntil?: number;
    baseSnoozeId?: string | null;
}
export function conversationTaskId(conversation: Conversation, tasks: Task[]): string | undefined {
    const ids = [conversation.key, conversation.id, ...conversation.aliases];
    return tasks.find(task => task.link && (ids.includes(task.link.key) || ids.includes(task.link.storedId)))?.id;
}
export function emptySnapshot(): Snapshot { return withSpaces({ tasks: [], lists: newTaskLists(), revision: 0 }); }
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
    if (op.kind === 'delete') {
        if (op.spaceId === originalSpaceId) throw new Conflict('The original space cannot be deleted. You can rename it.');
        if (!space) return input;
        if (s.tasks.some(task => taskSpaceId(task) === space.id)) throw new Conflict('Move all tasks out of this space before deleting it, including Done and Snoozed items.');
        if (check && space.name !== op.baseName) throw new Conflict('This space was renamed on another device. Review it before deleting.');
        if (check && s.defaultSpaceId === space.id && op.baseDefaultSpaceId !== space.id) throw new Conflict('This space became the default on another device. Review it before deleting.');
        s.spaces = s.spaces.filter(v => v.id !== space.id);
        delete s.spaceLists[space.id];
        if (s.defaultSpaceId === space.id) s.defaultSpaceId = originalSpaceId;
    }
    else if (op.kind === 'default') {
        if (!space)
            throw new Conflict('This space is not available.');
        if (check && s.defaultSpaceId !== op.baseDefaultSpaceId && s.defaultSpaceId !== op.spaceId)
            throw new Conflict('The default space changed on another device.');
        s.defaultSpaceId = space.id;
    }
    else {
        const name = op.name?.trim() || '';
        if (!name || name.length > 80)
            throw new Conflict('Use a space name between 1 and 80 characters.');
        if (check && s.spaces.some(v => v.id !== op.spaceId && v.name.toLowerCase() === name.toLowerCase()))
            throw new Conflict('A space with this name already exists. Choose another name.');
        if (op.kind === 'create') {
            if (space)
                throw new Conflict('This space already exists.');
            s.spaces.push({ id: op.spaceId, name, createdAt: op.at, updatedAt: op.at });
            s.spaceLists[op.spaceId] = newTaskLists();
        }
        else {
            if (!space)
                throw new Conflict('This space is not available.');
            if (check && space.name !== op.baseName && space.name !== name)
                throw new Conflict('This space was renamed on another device.');
            space.name = name;
            space.updatedAt = op.at;
        }
    }
    s.revision++;
    return s;
}
export function applyTaskOp(input: Snapshot, op: TaskOp, check = true): Snapshot {
    const s = withSpaces(structuredClone(input));
    let task = s.tasks.find(t => t.id === op.taskId);
    if (op.kind === 'create') {
        if (task)
            throw new Conflict('This task already exists.');
        const spaceId = op.spaceId || originalSpaceId;
        if (!s.spaceLists[spaceId])
            throw new Conflict('This space is not available. Sync the space before its tasks.');
        task = { id: op.taskId, spaceId, title: op.title!.trim(), status: 'inbox', previousStatus: 'inbox', completedAt: null, createdAt: op.at, updatedAt: op.at, link: null };
        s.tasks.push(task);
        s.spaceLists[spaceId].inbox.ids.unshift(task.id);
        s.spaceLists[spaceId].inbox.version++;
    }
    else {
        if (!task)
            throw new Conflict('This task no longer exists.');
        if (op.kind === 'title') {
            if (check && task.title !== op.baseTitle && task.title !== op.title?.trim())
                throw new Conflict('The title changed on another device.');
            task.title = op.title!.trim();
        }
        else {
            const originSpace = taskSpaceId(task), destinationSpace = op.spaceId || originalSpaceId;
            if (check && (originSpace !== (op.baseSpaceId || originalSpaceId) || task.status !== op.baseStatus))
                throw new Conflict('The task moved to another list or space on another device.');
            if (!s.spaceLists[destinationSpace])
                throw new Conflict('This space is not available. Sync the space before moving tasks into it.');
            const crossing = originSpace !== destinationSpace;
            if (check && (task.snoozeId || null) !== (op.baseSnoozeId || null))
                throw new Conflict('The reminder changed on another device.');
            if (op.kind === 'snooze' && (crossing || !['inbox', 'snoozed'].includes(task.status)))
                throw new Conflict('Only Inbox tasks can be snoozed. Move this task to Inbox first.');
            if (op.kind === 'snooze' && (!Number.isSafeInteger(op.snoozedUntil) || op.snoozedUntil! <= op.at || op.snoozedUntil! > 8640000000000000))
                throw new Conflict('Choose a future date and time for the reminder.');
            const destination = op.kind === 'snooze' ? 'snoozed' : crossing ? 'inbox' : op.status!;
            if (destination === 'snoozed' && op.kind !== 'snooze')
                throw new Conflict('Choose a reminder date and time to snooze this task.');
            const origin = task.status, from = s.spaceLists[originSpace][origin], to = s.spaceLists[destinationSpace][destination];
            if (check && !crossing && destination === origin && !['done', 'snoozed'].includes(destination) && to.version !== op.listVersion)
                throw new Conflict('This list was reordered on another device.');
            if (!crossing && destination === 'done' && origin === 'done')
                throw new Conflict('Done is ordered by completion time.');
            if (!crossing && op.beforeId && op.beforeId !== task.id && !to.ids.includes(op.beforeId))
                throw new Conflict('The destination position changed.');
            from.ids = from.ids.filter(id => id !== task!.id);
            from.version++;
            if (destination === 'done') {
                task.previousStatus = origin === 'snoozed' ? 'inbox' : origin;
                task.completedAt = op.at;
            }
            else {
                task.completedAt = null;
                if (crossing)
                    task.previousStatus = 'inbox';
            }
            if (op.kind === 'snooze') {
                task.snoozedUntil = op.snoozedUntil;
                task.snoozeId = op.id;
                task.previousStatus = 'inbox';
            }
            else {
                task.snoozedUntil = null;
                task.snoozeId = null;
            }
            task.status = destination;
            task.spaceId = destinationSpace;
            const before = crossing || op.beforeId === undefined ? 0 : op.beforeId === null ? to.ids.length : to.ids.indexOf(op.beforeId);
            to.ids.splice(Math.max(0, before), 0, task.id);
            if (to !== from)
                to.version++;
        }
        task.updatedAt = op.at;
    }
    for (const lists of Object.values(s.spaceLists)) {
        lists.done.ids.sort((a, b) => (s.tasks.find(t => t.id === b)?.completedAt ?? 0) - (s.tasks.find(t => t.id === a)?.completedAt ?? 0) || a.localeCompare(b));
        lists.snoozed.ids.sort((a, b) => (s.tasks.find(t => t.id === a)?.snoozedUntil ?? 0) - (s.tasks.find(t => t.id === b)?.snoozedUntil ?? 0) || a.localeCompare(b));
    }
    s.revision++;
    return s;
}
