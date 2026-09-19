import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Store } from '../store.js';
import type { Gateway } from '../gateway.js';
import type { PluginRegistry } from './registry.js';
import { PluginError } from './storage.js';
import { statuses, type TaskOp } from '../../shared/model.js';
const uuid = z.string().uuid();
const taskOpSchema = z.object({ id: uuid, taskId: uuid, kind: z.enum(['create', 'title', 'move', 'snooze']), at: z.number().int().positive(), title: z.string().trim().min(1).max(2000).optional(), status: z.enum(statuses).optional(), spaceId: uuid.optional(), baseSpaceId: uuid.optional(), beforeId: uuid.nullable().optional(), baseTitle: z.string().optional(), baseStatus: z.enum(statuses).optional(), listVersion: z.number().int().nonnegative().optional(), snoozedUntil: z.number().int().positive().max(8640000000000000).optional(), baseSnoozeId: uuid.nullable().optional() }).strict().superRefine((v, ctx) => {
    if (['create', 'title'].includes(v.kind) && !v.title)
        ctx.addIssue({ code: 'custom', message: 'Title is required.' });
    if ((v.kind === 'move' && (!v.status || !v.baseStatus)) || (v.kind === 'snooze' && (!v.baseStatus || !v.snoozedUntil)))
        ctx.addIssue({ code: 'custom', message: 'Task status and reminder time are required.' });
});
export function registerLegacyPluginRoutes(app: FastifyInstance, store: Store, gateway: Gateway, plugins: PluginRegistry) {
    function guard(id: string, write = true) {
        if (write && plugins.storage.data(id).generation !== 0)
            throw new PluginError('This plugin was reset. Update Herts before making new changes.', 410);
        if (!plugins.enabled(id))
            throw new PluginError('This plugin is paused. Its saved changes are retained.', 423);
    }
    async function legacyCommand(id: string, command: string, input: any) { guard(id); return plugins.command(id, { id: input.id, generation: 0, command, input }); }
    app.post('/api/v1/sync', async (req) => { guard('tasks'); const op = taskOpSchema.parse(req.body); const receipt = await legacyCommand('tasks', 'task', op); return { ...receipt, snapshot: store.snapshot() }; });
    app.post('/api/v1/spaces/sync', async (req) => {
        guard('tasks');
        const op = z.object({ id: uuid, spaceId: uuid, kind: z.enum(['create', 'rename', 'default']), at: z.number().int().positive(), name: z.string().trim().min(1).max(80).optional(), baseName: z.string().optional(), baseDefaultSpaceId: uuid.optional() }).strict().superRefine((v, ctx) => {
            if ((v.kind !== 'default' && !v.name) || (v.kind === 'rename' && v.baseName === undefined) || (v.kind === 'default' && !v.baseDefaultSpaceId))
                ctx.addIssue({ code: 'custom', message: 'Required space fields are missing.' });
        }).parse(req.body);
        const result = await legacyCommand('tasks', 'space', op);
        return { ...result, snapshot: store.snapshot() };
    });
    app.post('/api/v1/reading/sync', async (req) => {
        guard('reading');
        const op = z.object({ id: uuid, itemId: uuid, kind: z.enum(['create', 'title', 'read', 'reorder', 'offline', 'settings']), at: z.number().int().positive(), contextId: uuid.optional(), conversationId: z.string().min(1).max(300).optional(), url: z.string().max(8192).optional(), title: z.string().max(2000).optional(), baseTitle: z.string().max(8192).optional(), read: z.boolean().optional(), baseReadAt: z.number().nullable().optional(), beforeId: uuid.nullable().optional(), listVersion: z.number().int().nonnegative().optional(), offline: z.enum(['auto', 'keep', 'remove']).optional(), autoDownload: z.boolean().optional() }).strict().superRefine((v, ctx) => {
            if ((v.kind === 'create' && (!v.url || !v.contextId)) || (v.kind === 'title' && (!v.title?.trim() || v.baseTitle === undefined)) || (v.kind === 'read' && (v.read === undefined || v.baseReadAt === undefined)) || (v.kind === 'reorder' && v.listVersion === undefined) || (v.kind === 'offline' && !v.offline) || (v.kind === 'settings' && v.autoDownload === undefined))
                ctx.addIssue({ code: 'custom', message: 'Required reading-list fields are missing.' });
        }).parse(req.body);
        const prior = store.receipt(op.id, op);
        if (prior)
            return { ...prior, snapshot: store.snapshot() };
        let conversation;
        if (op.kind === 'create' && op.conversationId) {
            try {
                const c = await gateway.conversation(op.conversationId);
                conversation = { link: { key: c.key, storedId: c.id, title: c.title, source: c.source }, aliases: c.aliases };
            }
            catch (e) {
                if (!store.contexts().some(c => c.aliases.includes(op.conversationId!)))
                    throw e;
            }
        }
        const result = await legacyCommand('reading', 'reading', op);
        return { ...result, snapshot: store.snapshot() };
    });
    app.get('/api/v1/reading/:id/article', async (req, reply) => {
        guard('reading', false);
        const id = uuid.parse((req.params as any).id);
        if (!store.reading().items.some(i => i.id === id))
            return reply.code(404).send({ error: 'Reading item not found.' });
        return { article: await plugins.query('reading', 'article', { id }) };
    });
    app.post('/api/v1/conversations/:id/task', async (req) => {
        guard('tasks');
        const { id } = req.params as any;
        const payload = z.object({ id: uuid, taskId: uuid, title: z.string().trim().min(1).max(2000), spaceId: uuid.optional(), at: z.number().int().positive() }).strict().parse(req.body);
        const c = await gateway.conversation(id);
        const op: TaskOp = { ...payload, kind: 'create' };
        const result = await legacyCommand('tasks', 'link', { ...payload, conversationId: id });
        return { ...result, snapshot: store.snapshot() };
    });
}
export function legacyConversationFilters(includeLinked: string) { return includeLinked === 'true' ? [] : ['tasks:linked']; }
export function legacyConversationRow(c: any) { return { ...c, linkedTaskId: c.extensions?.tasks?.taskId }; }
export function clientSnapshot(store: Store, request: {
    headers: Record<string, unknown>;
}) { return request.headers['x-herts-plugin-api'] ? store.coreSnapshot() : store.snapshot(); }
