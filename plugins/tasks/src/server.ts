import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ServerServices, ServerPlugin, Transaction } from '@herts/plugin-api/server';
import { Conflict } from '@herts/plugin-api/types';
import { applySpaceOp, applyTaskOp, emptySnapshot, statuses, type Snapshot, type TaskOp, type SpaceOp, spaceName } from './model.js';
const uuid = z.string().uuid();
const taskSchema = z.object({ id: uuid, taskId: uuid, kind: z.enum(['create', 'title', 'move', 'snooze']), at: z.number().int().positive(), title: z.string().trim().min(1).max(2000).optional(), status: z.enum(statuses).optional(), spaceId: uuid.optional(), baseSpaceId: uuid.optional(), beforeId: uuid.nullable().optional(), baseTitle: z.string().optional(), baseStatus: z.enum(statuses).optional(), listVersion: z.number().int().nonnegative().optional(), snoozedUntil: z.number().int().positive().max(8640000000000000).optional(), baseSnoozeId: uuid.nullable().optional() }).strict().superRefine((v, ctx) => {
    if (['create', 'title'].includes(v.kind) && !v.title)
        ctx.addIssue({ code: 'custom', message: 'Title is required.' });
    if ((v.kind === 'move' && (!v.status || !v.baseStatus)) || (v.kind === 'snooze' && (!v.baseStatus || !v.snoozedUntil)))
        ctx.addIssue({ code: 'custom', message: 'Task status and reminder time are required.' });
});
const spaceSchema = z.object({ id: uuid, spaceId: uuid, kind: z.enum(['create', 'rename', 'default']), at: z.number().int().positive(), name: z.string().trim().min(1).max(80).optional(), baseName: z.string().optional(), baseDefaultSpaceId: uuid.optional() }).strict();
const linkedSchema = z.object({ id: uuid, taskId: uuid, title: z.string().trim().min(1).max(2000), spaceId: uuid.optional(), at: z.number().int().positive(), conversationId: z.string().min(1).max(300) }).strict();
export function taskMutation(tx: Transaction, input: unknown) {
    const op = taskSchema.parse(input) as TaskOp;
    const next = applyTaskOp(tx.get<Snapshot>('state') || emptySnapshot(), op);
    const task = next.tasks.find(t => t.id === op.taskId)!;
    task.contextId ||= task.id;
    if (!tx.context(task.contextId))
        tx.createContext({ id: task.contextId, title: task.title, link: null, aliases: [] });
    tx.reference(task.id, task.contextId);
    tx.put('state', next);
    return { accepted: true, id: op.id, taskId: task.id };
}
export default function activate(api: ServerServices): ServerPlugin {
    const snapshot = () => api.get<Snapshot>('state') || emptySnapshot();
    function wake(catchUp = false) {
        const now = Date.now(), before = snapshot();
        const due = before.tasks.filter(t => t.status === 'snoozed' && t.snoozedUntil && t.snoozedUntil <= now).sort((a, b) => a.snoozedUntil! - b.snoozedUntil! || a.id.localeCompare(b.id));
        if (!due.length)
            return;
        api.transaction(tx => {
            let next = tx.get<Snapshot>('state') || emptySnapshot();
            for (const task of due) {
                next = applyTaskOp(next, { id: randomUUID(), taskId: task.id, kind: 'move', status: 'inbox', baseStatus: 'snoozed', spaceId: task.spaceId, baseSpaceId: task.spaceId, baseSnoozeId: task.snoozeId, at: now });
                if (!catchUp)
                    tx.notify({ id: `snooze:${task.id}:${task.snoozeId}`, title: 'Reminder', body: task.title, route: `/task/${task.id}`, contextId: task.contextId });
            }
            tx.put('state', next);
            if (catchUp) {
                const id = randomUUID();
                tx.put(`catchup:${id}`, due.map(t => ({ id: t.id, title: t.title, space: spaceName(next, t.spaceId) })));
                tx.notify({ id: `catchup:${id}`, title: due.length === 1 ? due[0].title : `${due.length} reminders are back in Inbox`, body: 'These reminders became due while Tasks was paused.', route: due.length === 1 ? `/task/${due[0].id}` : `/plugins/tasks/reminders/${id}` });
            }
        });
    }
    return {
        migrate: (_from, tx) => { if (!tx.get('state'))
            tx.put('state', emptySnapshot()); },
        commands: {
            task: { apply: (input, tx) => taskMutation(tx, input) },
            space: { apply(input, tx) { const op = spaceSchema.parse(input) as SpaceOp; tx.put('state', applySpaceOp(tx.get<Snapshot>('state') || emptySnapshot(), op)); return { accepted: true, id: op.id }; } },
            link: {
                prepare: async (input) => { const op = linkedSchema.parse(input); return api.resolveConversation(op.conversationId); },
                apply(input, tx, conversation) {
                    const op = linkedSchema.parse(input), context = tx.ensureContext(conversation, op.taskId);
                    const before = tx.get<Snapshot>('state') || emptySnapshot();
                    if (before.tasks.some(t => t.contextId === context.id))
                        throw new Conflict('This conversation already belongs to a task.');
                    const next = applyTaskOp(before, { ...op, kind: 'create' });
                    const task = next.tasks.find(t => t.id === op.taskId)!;
                    task.contextId = context.id;
                    task.link = context.link;
                    tx.reference(task.id, context.id);
                    tx.put('state', next);
                    return { taskId: task.id };
                },
            },
        },
        start() { wake(api.resumed); api.interval(() => wake(), 1000); },
        conversationList(conversation) { const contexts = new Map(api.contexts().map(c => [c.id, c])); const ids = [conversation.id, conversation.key, ...conversation.aliases]; const task = snapshot().tasks.find(t => { const link = contexts.get(t.contextId || t.id)?.link || t.link; return link && (ids.includes(link.key) || ids.includes(link.storedId)); }); return task ? { filters: ['linked'], data: { taskId: task.id } } : {}; },
        conversation(context) { const task = snapshot().tasks.find(t => t.contextId === context.id); return task ? { title: task.title, route: `/task/${task.id}` } : undefined; },
    };
}
