import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, writeFile, rm } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { resolve, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Conflict, messageText, conversationHidden, hasSavedMessage } from '../shared/core.js';
import { Store } from './store.js';
import { Gateway, GatewayError } from './gateway.js';
import { PluginRegistry } from './plugins/registry.js';
import { migrateLegacyPlugins } from './plugins/migration.js';
import { registerLegacyPluginRoutes,legacyConversationFilters,legacyConversationRow,clientSnapshot } from './plugins/compatibility.js';
import { Actions } from './actions.js';
import { registerSessionSettings } from './sessionSettings.js';
import { Notifications } from './notifications.js';
import { bindHermesTarget } from './config.js';
import { registerThemes } from './themes.js';
import { mediaRefs } from '../shared/media.js';

const uuid = z.string().uuid();
const historyOrder = z.enum(['oldest', 'latest']).default('oldest');
const actionSchema = z.object({ id: uuid, taskId: uuid.optional(), contextId: uuid.optional(), kind: z.enum(['send','continue','approve','deny','stop','clarify']), text: z.string().optional(), answers: z.record(z.string().max(200), z.string().max(20000)).optional(), uploadIds: z.array(uuid).max(20).optional(), targetId: uuid.optional(), generation: uuid.optional(), approvalId: z.string().max(200).optional(), settingsRevision: z.number().int().nonnegative().optional(), defaultsRevision: z.number().int().nonnegative().optional(), settingsConfirmation: uuid.optional() }).strict().superRefine((v, ctx) => {
  if ((!v.taskId && !v.contextId) || (v.taskId && v.contextId)) ctx.addIssue({ code: 'custom', message: 'Provide one conversation or task reference.' });
  if (v.kind === 'send' && !v.text?.trim() && !v.uploadIds?.length) ctx.addIssue({ code: 'custom', message: 'Write a message or attach a file.' });
  if (v.kind === 'clarify' && !v.text?.trim() && !Object.keys(v.answers || {}).length) ctx.addIssue({ code: 'custom', message: 'An answer is required.' });
});
export interface Config { themesDir?: string; pluginsDir?: string; dataDir: string; origin: string; identity: string; dev?: boolean; hermesBase: string; hermesToken: string; excluded?: string[]; hermesProfile?: string }
export async function createApp(config: Config) {
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  const uploadDir = join(config.dataDir, 'uploads'); await mkdir(uploadDir, { recursive: true, mode: 0o700 });
  const store = new Store(join(config.dataDir, 'tasks.sqlite'));
  const profile = config.hermesProfile || 'default';
  try { bindHermesTarget(store, config.hermesBase, profile); } catch (error) { store.close(); throw error; }
  const gateway = new Gateway(config.hermesBase, config.hermesToken, config.excluded, () => store.contexts().flatMap(c => c.aliases), profile);
  const plugins = new PluginRegistry(store,gateway,config.pluginsDir || resolve('plugins'),config.dataDir);
  migrateLegacyPlugins(store,plugins.storage);
  const actions = new Actions(store,gateway,uploadDir);
  await plugins.initialise(store.legacyInstallation);
  const notifications = new Notifications(store,config.origin.startsWith('https:') ? config.origin : undefined,plugins);
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
    if(req.headers['x-herts-plugin-api']&&req.headers['x-herts-plugin-api']!=='1')return reply.code(426).send({error:'Update Herts before using this plugin API version.'});
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      if ((req.headers['x-herts-request'] !== '1' && req.headers['x-tasks-request'] !== '1') || (config.dev ? !!origin && ![config.origin, 'http://127.0.0.1:5173', 'http://localhost:5173'].includes(origin) : origin !== config.origin)) return reply.code(403).send({ error: 'Invalid request origin.' });
    }
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: error.issues.map(i => i.message).join(' ') });
    if (error instanceof Conflict) return reply.code(409).send({ error: error.message, snapshot: clientSnapshot(store,req) });
    if (error instanceof GatewayError) return reply.code(error.code === 404 ? 404 : 503).send({ error: error.message });
    if((error as any)?.name==='ZodError'&&Array.isArray((error as any).issues))return reply.code(400).send({error:(error as any).issues.map((i:any)=>i.message).join(' ')});
    const e = error as Error & { statusCode?: number };
    if(e.statusCode===409)return reply.code(409).send({error:e.message,snapshot:clientSnapshot(store,req),pluginData:plugins.data()});
    reply.code(e.statusCode && e.statusCode < 500 ? e.statusCode : 500).send({ error: e.statusCode && e.statusCode < 500 ? e.message : 'The request could not be completed. Your saved work is retained.' });
  });
  registerThemes(app, config.themesDir || resolve('themes'));
  app.get('/api/v1/state', async req => ({ snapshot: clientSnapshot(store,req), actions: store.actions(), bindings: Object.fromEntries(store.bindings()), gateway: { online: gateway.online, configured: !!config.hermesToken, profile, promptProtocol: gateway.promptProtocol, promptError: gateway.promptError, promptWarning: gateway.promptWarning }, plugins:plugins.catalogue(), pluginData:plugins.data(), pushKey: notifications.keys.publicKey }));

  app.get('/manifest.webmanifest',async(_req,reply)=>{const manifest=JSON.parse(await readFile(resolve('public/manifest.webmanifest'),'utf8'));manifest.description='Private Hermes conversations with optional plugins';manifest.shortcuts=plugins.catalogue().entries.filter(e=>plugins.enabled(e.manifest.id)).flatMap(e=>(e.manifest.shortcuts||[]));return reply.type('application/manifest+json').header('Cache-Control','no-cache').send(manifest);});
  app.get('/api/v1/contexts/:id',async(req,reply)=>{const context=store.context((req.params as any).id);return context?{context}:reply.code(404).send({error:'Conversation reference not found.'});});
  app.get('/api/v1/plugins',async()=>({catalogue:plugins.catalogue(),data:plugins.data()}));
  app.post('/api/v1/plugins/rescan',async()=>plugins.serial(async()=>{await plugins.scan();return{catalogue:plugins.catalogue(),data:plugins.data()};}));
  app.post('/api/v1/plugins/order',async req=>plugins.serial(async()=>{const p=z.object({order:z.array(z.string()),revision:z.number().int()}).parse(req.body);if(p.revision!==plugins.catalogue().revision)throw Object.assign(new Error('Settings changed on another device. Refresh and try again.'),{statusCode:409});plugins.reorder(p.order);return{catalogue:plugins.catalogue()};}));
  app.post('/api/v1/plugins/:id/manage',async req=>plugins.serial(async()=>{
    const id=z.string().parse((req.params as any).id),p=z.object({action:z.enum(['enable','disable','update','reset']),confirmation:z.string().optional(),revision:z.number().int()}).parse(req.body);
    if(p.revision!==plugins.catalogue().revision)throw Object.assign(new Error('Plugin settings changed. Refresh and try again.'),{statusCode:409});
    if(p.action==='enable'||p.action==='update')await plugins.activate(id,p.action==='update');
    else if(p.action==='disable')await plugins.disable(id);else await plugins.reset(id,p.confirmation||'');
    return{catalogue:plugins.catalogue(),data:plugins.data()};
  }));
  app.post('/api/v1/plugins/:id/commands',async req=>{
    const id=z.string().parse((req.params as any).id),op=z.object({id:uuid,generation:z.number().int().nonnegative(),command:z.string().min(1).max(100),input:z.unknown()}).strict().parse(req.body);
    const result=await plugins.command(id,op);return{result,data:plugins.storage.data(id),snapshot:clientSnapshot(store,req)};
  });
  app.post('/api/v1/plugins/:id/queries/:query',async req=>plugins.query((req.params as any).id,(req.params as any).query,req.body));
  app.get('/_plugins/:id/:hash/*',async(req,reply)=>{const p=req.params as any;const file=await plugins.asset(p.id,p.hash,p['*']);return reply.type(file.endsWith('.css')?'text/css':/\.m?js$/.test(file)?'text/javascript':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.png')?'image/png':file.endsWith('.jpg')?'image/jpeg':'application/octet-stream').header('Cache-Control','private,max-age=31536000,immutable').send(createReadStream(file));});
  app.post('/api/v1/contexts',async req=>{
    const input=z.object({id:uuid,title:z.string().trim().min(1).max(2000)}).strict().parse(req.body);
    const context=store.context(input.id)||store.saveContext({...input,link:null,aliases:[]});store.bumpRevision();
    store.emit('change',{type:'contexts'});return{context,snapshot:clientSnapshot(store,req)};
  });
  registerLegacyPluginRoutes(app,store,gateway,plugins);
  registerSessionSettings(app, actions.settings);
  app.post('/api/v1/contexts/:id/title', async req => {
    const id = uuid.parse((req.params as any).id);
    const { title, baseTitle } = z.object({ title: z.string().trim().min(1).max(100), baseTitle: z.string().max(2000) }).strict().parse(req.body);
    const context = store.context(id);
    if (!context) throw new Conflict('This conversation is not available. Refresh before renaming.');
    if ((context.link?.title || context.title) !== baseTitle && (context.link?.title || context.title) !== title) throw new Conflict('The conversation title changed. Refresh before renaming.');
    if (actions.dispatching.size && store.actions(id).some(a => a.state === 'preparing' && a.receipt === 'pending')) throw new Conflict('Wait for the message to finish sending before renaming the conversation.');
    let link = context.link;
    if (link) {
      const conversation = await gateway.conversation(link.storedId);
      if (conversation.title !== baseTitle && conversation.title !== title) {
        store.openConversation({ ...link, storedId: conversation.id, title: conversation.title }, conversation.aliases);
        throw new Conflict('The conversation title changed in Hermes. Refresh before renaming.');
      }
      await gateway.renameConversation(conversation.id, title);
      link = { ...link, storedId: conversation.id, title };
    }
    const updated = store.saveContext({ ...store.context(id)!, title, link });
    store.bumpRevision(); store.emit('change', { type: 'contexts' });
    return { context: updated, snapshot: clientSnapshot(store, req) };
  });
  app.get('/api/v1/conversations', async req => {
    const { q = '', offset = 0, includeLinked, includeHidden, filters } = z.object({ filters:z.string().max(4000).optional(), q: z.string().max(500).optional(), offset: z.coerce.number().int().nonnegative().optional(), includeLinked: z.enum(['true', 'false']).default('false'), includeHidden: z.enum(['true', 'false']).default('false') }).parse(req.query);
    const conversations = await gateway.search(q); const snapshot = store.coreSnapshot();
    const enabledFilters=filters===undefined?legacyConversationFilters(includeLinked):filters.split(',').filter(Boolean);
    const rows=conversations.map(c=>legacyConversationRow({...plugins.decorateConversation(c),hidden:conversationHidden(c,snapshot.hiddenConversations||[])})).filter(c=>!c.pluginFilters.some((key:string)=>enabledFilters.includes(key))&&(includeHidden==='true'||!c.hidden));
    return { conversations: rows.slice(offset, offset + 50), hasMore: rows.length > offset + 50, total: rows.length, searchedContentLimit: q ? 100 : undefined };
  });
  app.post('/api/v1/conversations/visibility', async req => {
    const key = z.string().min(1).max(300);
    const op = z.object({ id: uuid, key, aliases: z.array(key).max(5000), hidden: z.boolean(), at: z.number().int().positive() }).strict().parse(req.body);
    const receipt = store.setConversationVisibility(op);
    return { ...receipt, snapshot: clientSnapshot(store,req) };
  });
  app.get('/api/v1/conversations/:id/history', async req => { const { id } = req.params as any; const { offset = 0, order } = z.object({ offset: z.coerce.number().int().nonnegative().optional(), order: historyOrder }).parse(req.query); return gateway.history(id, offset, order); });
  app.post('/api/v1/conversations/:id/context', async req => {
    const id = z.string().min(1).max(300).parse((req.params as any).id);
    // Save only the selected conversation's identity. Browsing never resumes a
    // session, submits a prompt, or creates a task or reading item.
    const c = await gateway.conversation(id);
    const context = store.openConversation({ key: c.key, storedId: c.id, title: c.title, source: c.source }, c.aliases);
    return { context, snapshot: clientSnapshot(store,req) };
  });
  app.post('/api/v1/media', async req => {
    const p = z.object({ conversationId: z.string().min(1).max(300), order: historyOrder, offset: z.number().int().nonnegative(), index: z.number().int().min(0).max(199), path: z.string().min(1).max(4096) }).strict().parse(req.body);
    const history = await gateway.history(p.conversationId, p.offset, p.order), message = history.messages[p.index];
    if (!message || !mediaRefs(message).some(ref => ref.path === p.path)) throw new Conflict('This file is not referenced in the selected conversation message.');
    const result = await gateway.http(`/api/fs/read-data-url?profile=${encodeURIComponent(profile)}&session_id=${encodeURIComponent(history.sessionId)}&path=${encodeURIComponent(p.path)}`);
    if (typeof result.dataUrl !== 'string' || !/^data:[^,]+;base64,/.test(result.dataUrl)) throw new GatewayError('The file response is unavailable.');
    return { dataUrl: result.dataUrl };
  });
  app.post('/api/v1/actions', async (req, reply) => { const input = actionSchema.parse(req.body); const a = actions.start(input); return reply.code(202).send({ action: a }); });
  app.post('/api/v1/actions/cancel', async req => actions.cancelUndispatched(actionSchema.parse(req.body)));
  app.get('/api/v1/actions/:id', async (req, reply) => { const a = store.action((req.params as any).id); return a ? { action: a } : reply.code(404).send({ error: 'Operation not found.' }); });
  app.post('/api/v1/actions/:id/discard-saved-message', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    z.object({}).strict().parse(req.body);
    const action = store.action(id);
    if (!action) return reply.code(404).send({ error: 'Saved message not found.' });
    if (action.savedMessageDeletedAt) return { action };
    if (!hasSavedMessage(action)) throw new Conflict('This operation does not have a saved message to delete.');
    // Retain the operation and receipt for deduplication and status recovery.
    // Discarding a saved copy never cancels, retries or deletes Hermes work.
    action.savedMessageDeletedAt = Date.now(); store.saveAction(action);
    return { action };
  });
  function guardUpload(upload:{owner?:string}){
    if(!upload.owner)return;
    const [id,generation]=upload.owner.split(':');
    if(plugins.storage.metadata(id).generation!==Number(generation))throw Object.assign(new Error('Plugin data was reset.'),{statusCode:410});
    if(!plugins.enabled(id))throw Object.assign(new Error('The plugin is paused.'),{statusCode:423});
  }
  const uploadLocks = new Set<string>();
  app.post('/api/v1/uploads', async req => {
    const p = z.object({ id: uuid, name: z.string().min(1).max(255), type: z.string().max(150), size: z.number().int().positive().max(25 * 1024 * 1024), hash: z.string().regex(/^[a-f0-9]{64}$/),owner:z.string().regex(/^[a-z][a-z0-9-]{0,63}:[0-9]+$/).optional() }).strict().parse(req.body);
    guardUpload(p);
    const u = store.upload(p.id);
    if (u && (u.hash !== p.hash || u.size !== p.size || u.name !== p.name || u.type !== p.type || u.owner!==p.owner)) throw new Conflict('Upload identity was reused for another file.');
    if (!u) store.saveUpload({ ...p, complete: false });
    let offset = 0; try { offset = (await stat(join(uploadDir, `${p.id}${u?.complete ? '' : '.part'}`))).size; } catch { /* New upload. */ }
    return { ...(u || p), complete: u?.complete || false, offset };
  });
  app.put('/api/v1/uploads/:id', async req => {
    const id = uuid.parse((req.params as any).id); const { offset } = z.object({ offset: z.coerce.number().int().nonnegative() }).parse(req.query);
    const u = store.upload(id); if (!u) throw new Conflict('Create the upload first.');
    guardUpload(u);
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
        guardUpload(u);await rename(path, join(uploadDir, id)); guardUpload(u);u.complete = true; store.saveUpload(u);
      }
      return { offset: size, complete: u.complete };
    } finally { uploadLocks.delete(id);if(u.owner&&!store.upload(id))for(const suffix of ['', '.part'])await rm(join(uploadDir,id+suffix),{force:true}); }
  });
  app.get('/api/v1/uploads/:id/info', async (req, reply) => {
    const upload = store.upload(uuid.parse((req.params as any).id));
    return upload?.complete ? { upload } : reply.code(404).send({ error: 'The saved attachment is unavailable.' });
  });
  app.get('/api/v1/uploads/:id', async (req, reply) => { const id = uuid.parse((req.params as any).id); const u = store.upload(id); if (!u?.complete) return reply.code(404).send({ error: 'File is unavailable.' }); return reply.type('application/octet-stream').header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(u.name)}`).send(createReadStream(join(uploadDir, id))); });
  app.post('/api/v1/audio/transcribe', async req => {
    const p = z.object({ id: uuid, uploadId: uuid }).strict().parse(req.body); const prior = store.receipt(p.id, p); if (prior) return prior;
    const u = store.upload(p.uploadId); if (!u?.complete || !/^(audio\/|video\/webm)/.test(u.type)) throw new Conflict('A complete audio recording is required.');
    guardUpload(u);
    if(u.owner){const [id,generation]=u.owner.split(':');store.db.prepare('INSERT OR IGNORE INTO plugin_resources VALUES (?,?,?,?)').run(id,Number(generation),'transcription',p.id);}
    const marker = store.getMeta(`audio:${p.id}`); if (marker) throw new Conflict('Transcription outcome is unconfirmed. Retry explicitly with a new request.');
    store.setMeta(`audio:${p.id}`, true);
    const bytes = await readFile(join(uploadDir, p.uploadId));
    const r = await gateway.http(`/api/audio/transcribe?profile=${encodeURIComponent(profile)}`, { data_url: `data:${u.type};base64,${bytes.toString('base64')}`, mime_type: u.type });
    guardUpload(u);const result = { transcript: String(r.transcript || '') }; store.saveReceipt(p.id, p, result); return result;
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
  app.get('/api/v1/notifications/:id', async (req, reply) => { const n = store.db.prepare('SELECT task_id FROM notices WHERE id=?').get((req.params as any).id) as any; return n ? { taskId: n.task_id, route: (()=>{const pn=store.db.prepare('SELECT * FROM plugin_notices WHERE id=?').get((req.params as any).id)as any;if(pn){const notice=JSON.parse(pn.data);return plugins.enabled(pn.plugin_id)?notice.route:notice.contextId&&store.context(notice.contextId)?.link?`/conversation/${encodeURIComponent(store.context(notice.contextId)!.link!.key)}`:`/plugins-unavailable/${pn.plugin_id}`;}return plugins.conversation(n.task_id)?.route||(store.context(n.task_id)?.link?`/conversation/${encodeURIComponent(store.context(n.task_id)!.link!.key)}`:'/conversations');})() } : reply.code(404).send({ error: 'This notification is no longer available.' }); });
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
  app.addHook('onClose', async () => { await plugins.close(); actions.close(); notifications.close(); gateway.close(); store.close(); });
  if (config.hermesBase && config.hermesToken) void gateway.connect().catch(() => {});
  return { app, store, gateway, actions, plugins, articles:plugins.web };
}
