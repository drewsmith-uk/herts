import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { resolve, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Conflict, statuses, messageText, conversationTaskId, conversationHidden, type TaskOp } from '../shared/model.js';
import { Store } from './store.js';
import { Gateway, GatewayError } from './gateway.js';
import { Articles } from './articles.js';
import { Actions } from './actions.js';
import { Notifications } from './notifications.js';
import { bindHermesTarget } from './config.js';
import { Snoozes } from './snoozes.js';
import { mediaRefs } from '../shared/media.js';

const uuid = z.string().uuid();
const historyOrder = z.enum(['oldest', 'latest']).default('oldest');
const taskOpSchema = z.object({ id: uuid, taskId: uuid, kind: z.enum(['create','title','move','snooze']), at: z.number().int().positive(), title: z.string().trim().min(1).max(2000).optional(), status: z.enum(statuses).optional(), spaceId: uuid.optional(), baseSpaceId: uuid.optional(), beforeId: uuid.nullable().optional(), baseTitle: z.string().optional(), baseStatus: z.enum(statuses).optional(), listVersion: z.number().int().nonnegative().optional(), snoozedUntil: z.number().int().positive().max(8_640_000_000_000_000).optional(), baseSnoozeId: uuid.nullable().optional() }).strict().superRefine((v, ctx) => {
  if (['create','title'].includes(v.kind) && !v.title) ctx.addIssue({ code: 'custom', message: 'Title is required.' });
  if ((v.kind === 'move' && (!v.status || !v.baseStatus)) || (v.kind === 'snooze' && (!v.baseStatus || !v.snoozedUntil))) ctx.addIssue({ code: 'custom', message: 'Task status and reminder time are required.' });
});
const actionSchema = z.object({ id: uuid, taskId: uuid.optional(), contextId: uuid.optional(), kind: z.enum(['send','continue','approve','deny','stop','clarify']), text: z.string().optional(), uploadIds: z.array(uuid).max(20).optional(), targetId: uuid.optional(), generation: uuid.optional(), approvalId: z.string().max(200).optional() }).strict().superRefine((v, ctx) => {
  if ((!v.taskId && !v.contextId) || (v.taskId && v.contextId)) ctx.addIssue({ code: 'custom', message: 'Provide one conversation or task reference.' });
  if (v.kind === 'send' && !v.text?.trim() && !v.uploadIds?.length) ctx.addIssue({ code: 'custom', message: 'Write a message or attach a file.' });
  if (v.kind === 'clarify' && !v.text?.trim()) ctx.addIssue({ code: 'custom', message: 'An answer is required.' });
});
export interface Config { dataDir: string; origin: string; identity: string; dev?: boolean; hermesBase: string; hermesToken: string; excluded?: string[]; hermesProfile?: string }
export async function createApp(config: Config) {
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  const uploadDir = join(config.dataDir, 'uploads'); await mkdir(uploadDir, { recursive: true, mode: 0o700 });
  const store = new Store(join(config.dataDir, 'tasks.sqlite'));
  const profile = config.hermesProfile || 'default';
  try { bindHermesTarget(store, config.hermesBase, profile); } catch (error) { store.close(); throw error; }
  const gateway = new Gateway(config.hermesBase, config.hermesToken, config.excluded, () => store.contexts().flatMap(c => c.aliases), profile);
  const actions = new Actions(store, gateway, uploadDir); const articles = new Articles(store); const notifications = new Notifications(store, config.origin.startsWith('https:') ? config.origin : undefined); const snoozes = new Snoozes(store);
  const app = Fastify({ logger: false, bodyLimit: 36 * 1024 * 1024, trustProxy: false });
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 1024 * 1024 }, (_req, body, done) => done(null, body));
  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer').header('X-Frame-Options', 'DENY').header('Permissions-Policy', 'microphone=(self), camera=(self), geolocation=()');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    if (config.dev) {
      if (!['127.0.0.1', '::1'].includes(req.ip)) return reply.code(403).send({ error: 'Development access is loopback-only.' });
    } else {
      if (req.headers['tailscale-user-login'] !== config.identity) return reply.code(403).send({ error: 'Access is restricted to the configured Tailscale identity.' });
      if (req.headers.host !== new URL(config.origin).host) return reply.code(403).send({ error: 'Unrecognised app host.' });
    }
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      if ((req.headers['x-herts-request'] !== '1' && req.headers['x-tasks-request'] !== '1') || (config.dev ? !!origin && ![config.origin, 'http://127.0.0.1:5173', 'http://localhost:5173'].includes(origin) : origin !== config.origin)) return reply.code(403).send({ error: 'Invalid request origin.' });
    }
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: error.issues.map(i => i.message).join(' ') });
    if (error instanceof Conflict) return reply.code(409).send({ error: error.message, snapshot: store.snapshot() });
    if (error instanceof GatewayError) return reply.code(error.code === 404 ? 404 : 503).send({ error: error.message });
    const e = error as Error & { statusCode?: number };
    reply.code(e.statusCode && e.statusCode < 500 ? e.statusCode : 500).send({ error: e.statusCode && e.statusCode < 500 ? e.message : 'The request could not be completed. Your saved work is retained.' });
  });
  app.get('/api/v1/state', async () => ({ snapshot: store.snapshot(), actions: store.actions(), bindings: Object.fromEntries(store.bindings()), gateway: { online: gateway.online, configured: !!config.hermesToken, profile }, pushKey: notifications.keys.publicKey }));
  app.post('/api/v1/sync', async req => { const op = taskOpSchema.parse(req.body); const receipt = store.mutate(op); return { ...receipt, snapshot: store.snapshot() }; });
  app.post('/api/v1/spaces/sync', async req => {
    const op = z.object({ id: uuid, spaceId: uuid, kind: z.enum(['create','rename','default']), at: z.number().int().positive(), name: z.string().trim().min(1).max(80).optional(), baseName: z.string().optional(), baseDefaultSpaceId: uuid.optional() }).strict().superRefine((v, ctx) => {
      if ((v.kind !== 'default' && !v.name) || (v.kind === 'rename' && v.baseName === undefined) || (v.kind === 'default' && !v.baseDefaultSpaceId)) ctx.addIssue({ code: 'custom', message: 'Required space fields are missing.' });
    }).parse(req.body);
    const result = store.mutateSpace(op); return { ...result, snapshot: store.snapshot() };
  });
  app.post('/api/v1/reading/sync', async req => {
    const op = z.object({ id: uuid, itemId: uuid, kind: z.enum(['create','title','read','reorder','offline','settings']), at: z.number().int().positive(), contextId: uuid.optional(), conversationId: z.string().min(1).max(300).optional(), url: z.string().max(8192).optional(), title: z.string().max(2000).optional(), baseTitle: z.string().max(8192).optional(), read: z.boolean().optional(), baseReadAt: z.number().nullable().optional(), beforeId: uuid.nullable().optional(), listVersion: z.number().int().nonnegative().optional(), offline: z.enum(['auto','keep','remove']).optional(), autoDownload: z.boolean().optional() }).strict().superRefine((v, ctx) => {
      if ((v.kind === 'create' && (!v.url || !v.contextId)) || (v.kind === 'title' && (!v.title?.trim() || v.baseTitle === undefined)) || (v.kind === 'read' && (v.read === undefined || v.baseReadAt === undefined)) || (v.kind === 'reorder' && v.listVersion === undefined) || (v.kind === 'offline' && !v.offline) || (v.kind === 'settings' && v.autoDownload === undefined)) ctx.addIssue({ code: 'custom', message: 'Required reading-list fields are missing.' });
    }).parse(req.body);
    const prior = store.receipt(op.id, op); if (prior) return { ...prior, snapshot: store.snapshot() };
    let conversation;
    if (op.kind === 'create' && op.conversationId) {
      try { const c = await gateway.conversation(op.conversationId); conversation = { link: { key: c.key, storedId: c.id, title: c.title, source: c.source }, aliases: c.aliases }; }
      catch (e) { if (!store.contexts().some(c => c.aliases.includes(op.conversationId!))) throw e; }
    }
    const result = store.readingMutation(op, conversation); return { ...result, snapshot: store.snapshot() };
  });
  app.get('/api/v1/reading/:id/article', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    if (!store.reading().items.some(i => i.id === id)) return reply.code(404).send({ error: 'Reading item not found.' });
    return { article: await articles.get(id) };
  });
  app.get('/api/v1/conversations', async req => {
    const { q = '', offset = 0, includeLinked, includeHidden } = z.object({ q: z.string().max(500).optional(), offset: z.coerce.number().int().nonnegative().optional(), includeLinked: z.enum(['true', 'false']).default('false'), includeHidden: z.enum(['true', 'false']).default('false') }).parse(req.query);
    const conversations = await gateway.search(q); const snapshot = store.snapshot();
    const rows = conversations.map(c => ({ ...c, linkedTaskId: conversationTaskId(c, snapshot.tasks), hidden: conversationHidden(c, snapshot.hiddenConversations || []) })).filter(c => (includeLinked === 'true' || !c.linkedTaskId) && (includeHidden === 'true' || !c.hidden));
    return { conversations: rows.slice(offset, offset + 50), hasMore: rows.length > offset + 50, total: rows.length, searchedContentLimit: q ? 100 : undefined };
  });
  app.post('/api/v1/conversations/visibility', async req => {
    const key = z.string().min(1).max(300);
    const op = z.object({ id: uuid, key, aliases: z.array(key).max(5000), hidden: z.boolean(), at: z.number().int().positive() }).strict().parse(req.body);
    const receipt = store.setConversationVisibility(op);
    return { ...receipt, snapshot: store.snapshot() };
  });
  app.get('/api/v1/conversations/:id/history', async req => { const { id } = req.params as any; const { offset = 0, order } = z.object({ offset: z.coerce.number().int().nonnegative().optional(), order: historyOrder }).parse(req.query); return gateway.history(id, offset, order); });
  app.post('/api/v1/conversations/:id/context', async req => {
    const id = z.string().min(1).max(300).parse((req.params as any).id);
    // Save only the selected conversation's identity. Browsing never resumes a
    // session, submits a prompt, or creates a task or reading item.
    const c = await gateway.conversation(id);
    const context = store.openConversation({ key: c.key, storedId: c.id, title: c.title, source: c.source }, c.aliases);
    return { context, snapshot: store.snapshot() };
  });
  app.post('/api/v1/media', async req => {
    const p = z.object({ conversationId: z.string().min(1).max(300), order: historyOrder, offset: z.number().int().nonnegative(), index: z.number().int().min(0).max(199), path: z.string().min(1).max(4096) }).strict().parse(req.body);
    const history = await gateway.history(p.conversationId, p.offset, p.order), message = history.messages[p.index];
    if (!message || !mediaRefs(message).some(ref => ref.path === p.path)) throw new Conflict('This file is not referenced in the selected conversation message.');
    const result = await gateway.http(`/api/fs/read-data-url?profile=${encodeURIComponent(profile)}&session_id=${encodeURIComponent(history.sessionId)}&path=${encodeURIComponent(p.path)}`);
    if (typeof result.dataUrl !== 'string' || !/^data:[^,]+;base64,/.test(result.dataUrl)) throw new GatewayError('The file response is unavailable.');
    return { dataUrl: result.dataUrl };
  });
  app.post('/api/v1/conversations/:id/task', async req => {
    const { id } = req.params as any;
    const payload = z.object({ id: uuid, taskId: uuid, title: z.string().trim().min(1).max(2000), spaceId: uuid.optional(), at: z.number().int().positive() }).strict().parse(req.body);
    const c = await gateway.conversation(id);
    const op: TaskOp = { ...payload, kind: 'create' };
    const result = store.createLinked(op, { key: c.key, storedId: c.id, title: c.title, source: c.source }, c.aliases);
    return { ...result, snapshot: store.snapshot() };
  });
  app.post('/api/v1/actions', async (req, reply) => { const input = actionSchema.parse(req.body); const a = actions.start(input); return reply.code(202).send({ action: a }); });
  app.post('/api/v1/actions/cancel', async req => actions.cancelUndispatched(actionSchema.parse(req.body)));
  app.get('/api/v1/actions/:id', async (req, reply) => { const a = store.action((req.params as any).id); return a ? { action: a } : reply.code(404).send({ error: 'Operation not found.' }); });
  const uploadLocks = new Set<string>();
  app.post('/api/v1/uploads', async req => {
    const p = z.object({ id: uuid, name: z.string().min(1).max(255), type: z.string().max(150), size: z.number().int().positive().max(25 * 1024 * 1024), hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(req.body);
    const u = store.upload(p.id);
    if (u && (u.hash !== p.hash || u.size !== p.size || u.name !== p.name || u.type !== p.type)) throw new Conflict('Upload identity was reused for another file.');
    if (!u) store.saveUpload({ ...p, complete: false });
    let offset = 0; try { offset = (await stat(join(uploadDir, `${p.id}${u?.complete ? '' : '.part'}`))).size; } catch { /* New upload. */ }
    return { ...(u || p), complete: u?.complete || false, offset };
  });
  app.put('/api/v1/uploads/:id', async req => {
    const id = uuid.parse((req.params as any).id); const { offset } = z.object({ offset: z.coerce.number().int().nonnegative() }).parse(req.query);
    const u = store.upload(id); if (!u) throw new Conflict('Create the upload first.');
    if (u.complete) return { offset: u.size, complete: true };
    if (uploadLocks.has(id)) throw new Conflict('This upload is already being written.'); uploadLocks.add(id);
    try {
      const data = req.body as Buffer; if (!Buffer.isBuffer(data) || !data.length || data.length > 1024 * 1024) throw new Conflict('Invalid upload chunk.');
      const path = join(uploadDir, `${id}.part`); let size = 0; try { size = (await stat(path)).size; } catch { /* First chunk. */ }
      if (offset !== size) return { offset: size, complete: false };
      if (size + data.length > u.size) throw new Conflict('Upload exceeds its declared size.');
      const file = await open(path, 'a', 0o600); try { await file.write(data); await file.sync(); } finally { await file.close(); }
      size += data.length;
      if (size === u.size) {
        const hash = createHash('sha256'); await pipeline(createReadStream(path), hash);
        if (hash.digest('hex') !== u.hash) { await writeFile(path, '', { mode: 0o600 }); throw new Conflict('File verification failed. Upload again.'); }
        await rename(path, join(uploadDir, id)); u.complete = true; store.saveUpload(u);
      }
      return { offset: size, complete: u.complete };
    } finally { uploadLocks.delete(id); }
  });
  app.get('/api/v1/uploads/:id', async (req, reply) => { const id = uuid.parse((req.params as any).id); const u = store.upload(id); if (!u?.complete) return reply.code(404).send({ error: 'File is unavailable.' }); return reply.type('application/octet-stream').header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(u.name)}`).send(createReadStream(join(uploadDir, id))); });
  app.post('/api/v1/audio/transcribe', async req => {
    const p = z.object({ id: uuid, uploadId: uuid }).strict().parse(req.body); const prior = store.receipt(p.id, p); if (prior) return prior;
    const u = store.upload(p.uploadId); if (!u?.complete || !/^(audio\/|video\/webm)/.test(u.type)) throw new Conflict('A complete audio recording is required.');
    const marker = store.getMeta(`audio:${p.id}`); if (marker) throw new Conflict('Transcription outcome is unconfirmed. Retry explicitly with a new request.');
    store.setMeta(`audio:${p.id}`, true);
    const bytes = await readFile(join(uploadDir, p.uploadId));
    const r = await gateway.http(`/api/audio/transcribe?profile=${encodeURIComponent(profile)}`, { data_url: `data:${u.type};base64,${bytes.toString('base64')}`, mime_type: u.type });
    const result = { transcript: String(r.transcript || '') }; store.saveReceipt(p.id, p, result); return result;
  });
  app.post('/api/v1/audio/speak', async req => {
    const p = z.object({ conversationId: z.string().min(1).max(300), messageId: z.union([z.string(), z.number()]).optional(), order: historyOrder, offset: z.number().int().nonnegative(), index: z.number().int().min(0).max(199), text: z.string().min(1) }).strict().parse(req.body);
    const h = await gateway.history(p.conversationId, p.offset, p.order); const message = h.messages[p.index];
    if (!message || message.role !== 'assistant' || (p.messageId !== undefined && message.id !== p.messageId)) throw new Conflict('This response has changed. Refresh before reading aloud.');
    const text = messageText(message);
    if (!text) throw new Conflict('This response has no readable text.');
    if (text !== p.text) throw new Conflict('This response changed. Refresh before reading aloud.');
    return gateway.http(`/api/audio/speak?profile=${encodeURIComponent(profile)}`, { text });
  });
  app.post('/api/v1/notifications/subscribe', async req => ({ id: notifications.subscribe(req.body) }));
  app.post('/api/v1/notifications/status', async req => { const { endpoint } = z.object({ endpoint: z.string().max(4096) }).parse(req.body); return notifications.status(endpoint); });
  app.post('/api/v1/notifications/unsubscribe', async req => { const { endpoint } = z.object({ endpoint: z.string() }).parse(req.body); notifications.unsubscribe(endpoint); return { ok: true }; });
  app.post('/api/v1/notifications/test', async req => { const { endpoint, id } = z.object({ endpoint: z.string().max(4096), id: uuid }).parse(req.body); return notifications.test(endpoint, id); });
  app.get('/api/v1/notifications/tests/:id', async (req, reply) => notifications.testStatus(z.object({ id: uuid }).parse(req.params).id) || reply.code(404).send({ error: 'This notification test is no longer available.' }));
  app.post('/api/v1/notifications/tests/:id/shown', async req => { notifications.confirmTest(z.object({ id: uuid }).parse(req.params).id); return { ok: true }; });
  app.get('/api/v1/notifications/:id', async (req, reply) => { const n = store.db.prepare('SELECT task_id FROM notices WHERE id=?').get((req.params as any).id) as any; return n ? { taskId: n.task_id, route: store.notificationRoute(n.task_id) } : reply.code(404).send({ error: 'This notification is no longer available.' }); });
  const streams = new Set<any>();
  app.get('/api/v1/events', async (req, reply) => {
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }); reply.hijack();
    reply.raw.write('event: refresh\ndata: {}\n\n'); streams.add(reply.raw);
    const keepAlive = setInterval(() => reply.raw.write(': keepalive\n\n'), 20_000);
    req.raw.on('close', () => { clearInterval(keepAlive); streams.delete(reply.raw); });
  });
  const emit = () => { for (const stream of streams) if (!stream.destroyed && stream.writableLength < 1024 * 1024) stream.write('event: refresh\ndata: {}\n\n'); };
  store.on('change', emit);
  const dist = resolve('dist');
  if (existsSync(dist)) { await app.register(fastifyStatic, { root: dist, maxAge: 0 }); app.setNotFoundHandler((req, reply) => req.url.startsWith('/api/') ? reply.code(404).send({ error: 'Not found.' }) : reply.sendFile('index.html')); }
  app.addHook('preClose', async () => { for (const s of streams) s.end(); });
  app.addHook('onClose', async () => { snoozes.close(); articles.close(); actions.close(); notifications.close(); gateway.close(); store.close(); });
  if (config.hermesBase && config.hermesToken) void gateway.connect().catch(() => {});
  return { app, store, gateway, actions, articles };
}
