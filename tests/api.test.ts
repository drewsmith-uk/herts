import webpush from 'web-push';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createApp } from '../server/app';
import { originalSpaceId, type Conversation } from '../shared/model';
const closes: (()=>Promise<void>)[] = [];
afterEach(async () => { for (const close of closes.splice(0)) await close(); });
async function fixture(dev = true) { const dir = await mkdtemp(join(tmpdir(), 'tasks-test-')); const result = await createApp({ dataDir: dir, origin: 'https://tasks.example:8443', identity: 'owner@example.com', dev, hermesBase: '', hermesToken: '' }); closes.push(async () => { await result.app.close(); await rm(dir, { recursive: true, force: true }); }); return result; }
describe('private API and upload recovery', () => {
  it('opens one shared conversation reference without agent work or a task, and reuses it after linking', async () => {
    const { app, store, gateway, articles } = await fixture();
    articles.fetchHtml = async () => { throw new Error('Article unavailable'); };
    const conversation: Conversation = { id: 'latest', key: 'root/with space', aliases: ['older', 'latest', 'root/with space'], title: 'Standalone conversation', preview: '', source: 'telegram', updatedAt: 1 };
    gateway.http = async () => ({ sessions: [ { id: conversation.id, _lineage_root_id: conversation.key, _lineage_ids: conversation.aliases, title: conversation.title, source: conversation.source } ], total: 1 });
    const rpc = vi.spyOn(gateway, 'rpc');
    const headers = { 'x-herts-request': '1' };
    const open = (id: string) => app.inject({ method: 'POST', url: `/api/v1/conversations/${encodeURIComponent(id)}/context`, headers, payload: {} });
    expect((await app.inject('/api/v1/conversations')).json().total).toBe(1);
    expect(store.contexts()).toEqual([]);
    const responses = await Promise.all([open(conversation.key), open('older')]);
    for (const response of responses) expect(response.statusCode).toBe(200);
    const contextId = responses[0].json().context.id;
    expect(responses[1].json().context.id).toBe(contextId);
    expect(store.contexts()).toHaveLength(1); expect(store.snapshot().revision).toBe(1);
    expect(store.snapshot().tasks).toEqual([]); expect(store.reading().items).toEqual([]);
    expect(store.actions()).toEqual([]); expect(store.bindings()).toEqual([]); expect(rpc).not.toHaveBeenCalled();
    expect((await app.inject('/api/v1/conversations')).json().conversations[0].linkedTaskId).toBeUndefined();
    store.notify('standalone-notice', contextId, 'complete');
    expect((await app.inject('/api/v1/notifications/standalone-notice')).json().route).toBe('/conversation/root%2Fwith%20space');
    const itemId = randomUUID();
    const reading = await app.inject({ method: 'POST', url: '/api/v1/reading/sync', headers, payload: { id: randomUUID(), itemId, contextId: randomUUID(), conversationId: 'older', kind: 'create', url: 'https://example.com/standalone', at: 1 } });
    expect(reading.statusCode).toBe(200); expect(store.reading().items[0].contextId).toBe(contextId);
    expect(store.notificationRoute(contextId)).toBe(`/reading-item/${itemId}`);
    expect((await app.inject('/api/v1/conversations')).json().total).toBe(1);
    const taskId = randomUUID();
    expect((await app.inject({ method: 'POST', url: '/api/v1/conversations/latest/task', headers, payload: { id: randomUUID(), taskId, title: 'Related task', at: 2 } })).statusCode).toBe(200);
    expect(store.task(taskId)?.contextId).toBe(contextId);
    expect((await open('older')).json().context.id).toBe(contextId);
    expect(store.contexts()).toHaveLength(1); expect(store.notificationRoute(contextId)).toBe(`/task/${taskId}`);
    expect((await app.inject('/api/v1/conversations')).json().total).toBe(0);
    expect(store.actions()).toEqual([]); expect(rpc).not.toHaveBeenCalled();
  });
  it('requires private access and a personal conversation before saving a standalone reference', async () => {
    const { app, store, gateway } = await fixture(false);
    const headers = { host: 'tasks.example:8443', 'tailscale-user-login': 'owner@example.com', origin: 'https://tasks.example:8443', 'x-herts-request': '1' };
    const http = vi.spyOn(gateway, 'http').mockResolvedValue({ sessions: [
      { id: 'worker', source: 'worker', title: 'Internal worker' },
      { id: 'test', source: 'desktop', title: 'Test conversation' },
      { id: 'hidden', source: 'telegram', title: 'Hidden internally', hidden: true },
    ], total: 3 });
    const open = (id: string, requestHeaders = headers) => app.inject({ method: 'POST', url: `/api/v1/conversations/${id}/context`, headers: requestHeaders, payload: {} });
    expect((await open('worker', {} as typeof headers)).statusCode).toBe(403);
    expect((await open('worker', { ...headers, origin: 'https://attacker.example' })).statusCode).toBe(403);
    expect(http).not.toHaveBeenCalled();
    for (const id of ['worker', 'test', 'hidden', 'missing']) expect((await open(id)).statusCode).toBe(404);
    expect(store.contexts()).toEqual([]); expect(store.actions()).toEqual([]);
  });
  it('verifies device registration and sends an idempotent test through the private API', async () => {
    const {app,store}=await fixture(),headers={'x-tasks-request':'1'},id=randomUUID();
    const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/api-fixture',keys:{p256dh:'fixture',auth:'fixture'}};
    const send=vi.spyOn(webpush,'sendNotification').mockResolvedValue({statusCode:201,headers:{},body:''});
    try {
      const post=(path:string,payload:any)=>app.inject({method:'POST',url:`/api/v1/notifications${path}`,headers,payload});
      expect((await post('/status',{endpoint:subscription.endpoint})).json()).toMatchObject({registered:false,needsRepair:true});
      expect((await post('/subscribe',subscription)).statusCode).toBe(200);
      const health=(await post('/status',{endpoint:subscription.endpoint})).json();expect(health).toMatchObject({registered:true,needsRepair:false});expect(JSON.stringify(health)).not.toContain('api-fixture');
      expect((await post('/subscribe',{...subscription,endpoint:'https://127.0.0.1/private'})).statusCode).toBe(400);
      expect((await post('/test',{endpoint:'https://fcm.googleapis.com/fcm/send/unknown',id})).statusCode).toBe(409);
      expect((await post('/test',{endpoint:subscription.endpoint,id})).json()).toEqual({id,state:'accepted'});
      await post('/test',{endpoint:subscription.endpoint,id});expect(send).toHaveBeenCalledTimes(1);
      expect((await post(`/tests/${id}/shown`,{})).statusCode).toBe(200);
      expect((await app.inject(`/api/v1/notifications/tests/${id}`)).json()).toMatchObject({id,state:'accepted',shownAt:expect.any(Number)});
      await post('/unsubscribe',{endpoint:subscription.endpoint});expect((await post('/status',{endpoint:subscription.endpoint})).json().registered).toBe(false);expect(store.actions()).toEqual([]);
    }finally{send.mockRestore();}
  });
  it('protects notification registration, tests, status and device acknowledgements with private access and origin checks',async()=>{
    const {app}=await fixture(false),id=randomUUID();
    const headers={host:'tasks.example:8443','tailscale-user-login':'owner@example.com',origin:'https://attacker.example','x-tasks-request':'1'};
    for(const path of ['/subscribe','/status','/test',`/tests/${id}/shown`]){
      expect((await app.inject({method:'POST',url:`/api/v1/notifications${path}`,payload:{}})).statusCode).toBe(403);
      expect((await app.inject({method:'POST',url:`/api/v1/notifications${path}`,headers,payload:{}})).statusCode).toBe(403);
    }
    expect((await app.inject(`/api/v1/notifications/tests/${id}`)).statusCode).toBe(403);
  });
  it('snoozes with Hermes unavailable, validates the choice and routes its reminder back to the task', async () => {
    const {app,store,gateway}=await fixture();let calls=0;gateway.rpc=async()=>{calls++;throw new Error('Hermes is offline');};
    const headers={'x-tasks-request':'1'},at=Date.now(),taskId=randomUUID();
    await app.inject({method:'POST',url:'/api/v1/sync',headers,payload:{id:randomUUID(),taskId,kind:'create',title:'Reminder test',at}});
    const op={id:randomUUID(),taskId,kind:'snooze',baseStatus:'inbox',baseSnoozeId:null,snoozedUntil:at+60_000,at};
    expect((await app.inject({method:'POST',url:'/api/v1/sync',headers,payload:{...op,snoozedUntil:undefined}})).statusCode).toBe(400);
    expect((await app.inject({method:'POST',url:'/api/v1/sync',headers,payload:{...op,snoozedUntil:at-1}})).statusCode).toBe(409);
    expect((await app.inject({method:'POST',url:'/api/v1/sync',headers,payload:op})).json().snapshot.tasks[0].status).toBe('snoozed');
    store.wakeSnoozed(at+60_000);
    expect((await app.inject({method:'POST',url:'/api/v1/sync',headers,payload:op})).json().snapshot.tasks[0].status).toBe('inbox');
    const notice=store.db.prepare('SELECT id FROM notices WHERE kind=?').get('reminder') as any;
    expect((await app.inject(`/api/v1/notifications/${encodeURIComponent(notice.id)}`)).json()).toMatchObject({taskId,route:`/task/${taskId}`});
    expect(store.db.prepare('SELECT * FROM notices').all()).toHaveLength(1);expect(calls).toBe(0);
  });
  it('persists spaces with Hermes unavailable and pins conversation conversion to its saved space', async () => {
    const {app,gateway,store}=await fixture(); const headers={'x-tasks-request':'1'},spaceId=randomUUID();
    const create={id:randomUUID(),spaceId,kind:'create',name:'Work',at:1};
    expect((await app.inject({method:'POST',url:'/api/v1/spaces/sync',headers,payload:create})).statusCode).toBe(200);
    expect((await app.inject({method:'POST',url:'/api/v1/spaces/sync',headers,payload:create})).statusCode).toBe(200);
    expect((await app.inject({method:'POST',url:'/api/v1/spaces/sync',headers,payload:{id:randomUUID(),spaceId,kind:'default',baseDefaultSpaceId:originalSpaceId,at:2}})).statusCode).toBe(200);
    const c:Conversation={id:'space-chat',key:'space-chat',aliases:[],title:'Global conversation',preview:'',source:'telegram',updatedAt:1};gateway.conversation=async()=>c;gateway.search=async()=>[c];
    const intent={id:randomUUID(),taskId:randomUUID(),title:'Pinned task',spaceId,at:3};
    const first=await app.inject({method:'POST',url:'/api/v1/conversations/space-chat/task',headers,payload:intent});expect(first.statusCode).toBe(200);
    expect(first.json().snapshot.tasks[0].spaceId).toBe(spaceId);expect(first.json().snapshot.lists.inbox.ids).toEqual([]);
    store.mutateSpace({id:randomUUID(),spaceId:originalSpaceId,kind:'default',baseDefaultSpaceId:spaceId,at:4});
    expect((await app.inject({method:'POST',url:'/api/v1/conversations/space-chat/task',headers,payload:intent})).json().taskId).toBe(intent.taskId);
    expect(store.snapshot().tasks).toHaveLength(1);expect(store.task(intent.taskId)?.spaceId).toBe(spaceId);
    expect((await app.inject('/api/v1/conversations')).json().total).toBe(0);expect((await app.inject('/api/v1/conversations?includeLinked=true')).json().total).toBe(1);
    expect(store.actions()).toEqual([]);
    expect((await app.inject({method:'POST',url:'/api/v1/conversations/space-chat/task',headers,payload:{...intent,id:randomUUID(),taskId:randomUUID(),spaceId:originalSpaceId}})).statusCode).toBe(409);
  });
  it('keeps reading conversations in the general list, independently of task conversion', async () => {
    const { app, gateway, store, articles } = await fixture(); articles.fetchHtml = async () => { throw new Error('Article unavailable'); };
    const c: Conversation = { id: 'tip', key: 'root', title: 'Reading conversation', preview: '', source: 'telegram', updatedAt: 1, aliases: ['root','tip'] };
    gateway.search = async () => [c]; gateway.conversation = async () => c;
    const headers = { 'x-tasks-request': '1' }, op = { id: randomUUID(), itemId: randomUUID(), contextId: randomUUID(), conversationId: c.id, kind: 'create', url: 'https://example.com/article', at: 1 };
    expect((await app.inject({ method: 'POST', url: '/api/v1/reading/sync', headers, payload: op })).statusCode).toBe(200);
    expect(store.snapshot().tasks).toHaveLength(0); expect(store.actions()).toHaveLength(0);
    expect((await app.inject('/api/v1/conversations')).json().total).toBe(1);
    const duplicate = await app.inject({ method: 'POST', url: '/api/v1/reading/sync', headers, payload: { ...op, id: randomUUID(), itemId: randomUUID(), contextId: randomUUID() } });
    expect(duplicate.json().itemId).toBe(op.itemId);
    const conversion = await app.inject({ method: 'POST', url: '/api/v1/conversations/tip/task', headers, payload: { id: randomUUID(), taskId: randomUUID(), title: 'Follow up', at: 2 } });
    expect(conversion.statusCode).toBe(200); expect((await app.inject('/api/v1/conversations')).json().total).toBe(0);
    expect((await app.inject('/api/v1/conversations?includeLinked=true')).json().total).toBe(1);
    expect(store.reading().items).toHaveLength(1); expect(store.reading().items[0].readAt).toBeNull();
  });
  it('requires authenticated, same-origin reading mutations and validates action references', async () => {
    const { app } = await fixture(false);
    expect((await app.inject('/api/v1/reading/00000000-0000-4000-8000-000000000000/article')).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:'/api/v1/spaces/sync',payload:{}})).statusCode).toBe(403);
    const headers = { host: 'tasks.example:8443', 'tailscale-user-login': 'owner@example.com', origin: 'https://attacker.example', 'x-tasks-request': '1' };
    expect((await app.inject({ method: 'POST', url: '/api/v1/reading/sync', headers, payload: {} })).statusCode).toBe(403);
    headers.origin = 'https://tasks.example:8443';
    expect((await app.inject({ method: 'POST', url: '/api/v1/actions', headers, payload: { id: randomUUID(), kind: 'send', text: 'No context' } })).statusCode).toBe(400);
  });
  it('validates reading-title edits and returns conflicts without calling Hermes', async () => {
    const { app, gateway, store, articles } = await fixture(); let calls = 0;
    gateway.rpc = async () => { calls++; throw new Error('Hermes unavailable'); };
    gateway.http = async () => { calls++; throw new Error('Hermes unavailable'); };
    articles.fetchHtml = async () => { throw new Error('Article unavailable'); };
    const headers = { 'x-tasks-request': '1' }, itemId = randomUUID();
    const post = (payload: any) => app.inject({ method: 'POST', url: '/api/v1/reading/sync', headers, payload });
    await post({ id: randomUUID(), itemId, contextId: randomUUID(), kind: 'create', title: 'Shared title', url: 'https://example.com/rename', at: 1 });
    const op = { id: randomUUID(), itemId, kind: 'title', title: 'Updated title', baseTitle: 'Shared title', at: 2 };
    for (const invalid of [{ title: '' }, { title: '   ' }, { title: 'x'.repeat(2001) }, { title: undefined }, { baseTitle: undefined }]) expect((await post({ ...op, ...invalid })).statusCode).toBe(400);
    expect((await post(op)).json().snapshot.reading.items[0].title).toBe('Updated title');
    expect((await post(op)).statusCode).toBe(200);
    const conflict = await post({ ...op, id: randomUUID(), title: 'Stale edit' });
    expect(conflict.statusCode).toBe(409); expect(conflict.json().snapshot.reading.items[0].title).toBe('Updated title');
    expect(store.actions()).toEqual([]); expect(calls).toBe(0);
  });
  it('saves hide/unhide without consulting Hermes, and supports recovery with the same operation ID', async () => {
    const { app, gateway } = await fixture(); let hermesCalls = 0;
    gateway.rpc = async () => { hermesCalls++; throw new Error('Hermes is unavailable'); };
    gateway.http = async () => { hermesCalls++; throw new Error('Hermes is unavailable'); };
    const headers = { 'x-tasks-request': '1' }, payload = { id: randomUUID(), key: 'personal', aliases: ['old-personal'], hidden: true, at: Date.now() };
    const hide = await app.inject({ method: 'POST', url: '/api/v1/conversations/visibility', headers, payload });
    expect(hide.statusCode).toBe(200); expect(hide.json().snapshot.hiddenConversations).toEqual(['personal']);
    const show = await app.inject({ method: 'POST', url: '/api/v1/conversations/visibility', headers, payload: { ...payload, id: randomUUID(), hidden: false } });
    expect(show.json().snapshot.hiddenConversations).toEqual([]);
    const retry = await app.inject({ method: 'POST', url: '/api/v1/conversations/visibility', headers, payload });
    expect(retry.statusCode).toBe(200); expect(retry.json().snapshot).toEqual(show.json().snapshot);
    expect((await app.inject({ method: 'POST', url: '/api/v1/conversations/visibility', headers, payload: { ...payload, hidden: 'false' } })).statusCode).toBe(400);
    expect(hermesCalls).toBe(0);
  });
  it('combines hidden and linked filters before pagination and preserves direct history access', async () => {
    const { app, gateway, store } = await fixture();
    const rows: Conversation[] = Array.from({ length: 60 }, (_, i) => ({ id: `tip-${i}`, key: `root-${i}`, aliases: [`old-${i}`], title: `Hide needle ${i}`, preview: '', source: 'desktop', updatedAt: Date.now() - i }));
    gateway.search = async query => rows.filter(c => c.title.includes(query));
    gateway.history = async id => ({ sessionId: id, messages: [{ id: 1, role: 'assistant', content: 'Still available' }], offset: 0, hasMore: false, fetchedAt: Date.now() });
    for (let i = 0; i < 5; i++) store.setConversationVisibility({ id: randomUUID(), key: `old-${i}`, aliases: [], hidden: true, at: Date.now() });
    for (const i of [0, 5]) store.createLinked({ id: randomUUID(), taskId: randomUUID(), kind: 'create', title: `Task ${i}`, at: Date.now() }, { key: rows[i].key, storedId: rows[i].id, source: 'desktop', title: rows[i].title });
    const first = (await app.inject('/api/v1/conversations')).json();
    expect(first.total).toBe(54); expect(first.conversations).toHaveLength(50); expect(first.hasMore).toBe(true);
    expect(first.conversations[0].key).toBe('root-6');
    const last = (await app.inject('/api/v1/conversations?offset=50')).json();
    expect(last.conversations.map((c: Conversation) => c.key)).toEqual(['root-56', 'root-57', 'root-58', 'root-59']); expect(last.hasMore).toBe(false);
    expect((await app.inject('/api/v1/conversations?includeHidden=true')).json().total).toBe(58);
    expect((await app.inject('/api/v1/conversations?includeLinked=true')).json().total).toBe(55);
    expect((await app.inject('/api/v1/conversations?includeHidden=true&includeLinked=true')).json().total).toBe(60);
    expect((await app.inject('/api/v1/conversations?q=needle%200&includeLinked=true')).json().total).toBe(0);
    expect((await app.inject('/api/v1/conversations?q=needle%200&includeLinked=true&includeHidden=true')).json().conversations[0]).toMatchObject({ key: 'root-0', hidden: true });
    expect((await app.inject('/api/v1/conversations/root-0/history')).json().messages).toHaveLength(1);
  });
  it('hides linked conversations before pagination and search, with an explicit option to include them', async () => {
    const { app, gateway, store } = await fixture();
    const conversations: Conversation[] = Array.from({ length: 110 }, (_, i) => ({ id: `latest-${i}`, key: `root-${i}`, aliases: [`legacy-${i}`], title: i === 0 ? 'Needle linked only' : `Needle ${i}`, preview: '', source: 'desktop', updatedAt: Date.now() - i }));
    const linkedIds: string[] = [];
    for (let i = 0; i < 55; i++) {
      const taskId = randomUUID(); linkedIds.push(taskId);
      const key = i % 4 === 0 ? `root-${i}` : i % 4 === 1 ? `legacy-${i}` : `old-root-${i}`;
      const storedId = i % 4 === 2 ? `latest-${i}` : i % 4 === 3 ? `legacy-${i}` : `old-stored-${i}`;
      store.createLinked({ id: randomUUID(), taskId, kind: 'create', title: `Task ${i}`, at: Date.now() }, { key, storedId, source: 'desktop', title: `Conversation ${i}` });
      if (i === 0) store.mutate({ id: randomUUID(), taskId, kind: 'move', status: 'done', baseStatus: 'inbox', at: Date.now() });
    }
    gateway.search = async query => conversations.filter(c => c.title.toLowerCase().includes(query.toLowerCase()));
    const first = (await app.inject('/api/v1/conversations')).json();
    expect(first.total).toBe(55); expect(first.hasMore).toBe(true);
    expect(first.conversations.map((c: Conversation) => c.key)).toEqual(conversations.slice(55, 105).map(c => c.key));
    const second = (await app.inject('/api/v1/conversations?includeLinked=false&offset=50')).json();
    expect(second.total).toBe(55); expect(second.hasMore).toBe(false);
    expect(second.conversations.map((c: Conversation) => c.key)).toEqual(conversations.slice(105).map(c => c.key));
    const all = (await app.inject('/api/v1/conversations?includeLinked=true')).json();
    expect(all.total).toBe(110); expect(all.hasMore).toBe(true);
    expect(all.conversations.map((c: Conversation) => c.linkedTaskId)).toEqual(linkedIds.slice(0, 50));
    const search = (await app.inject('/api/v1/conversations?q=linked%20only')).json();
    expect(search.conversations).toEqual([]); expect(search.total).toBe(0); expect(search.hasMore).toBe(false);
    const includeSearch = (await app.inject('/api/v1/conversations?q=linked%20only&includeLinked=true')).json();
    expect(includeSearch.total).toBe(1); expect(includeSearch.conversations[0].linkedTaskId).toBe(linkedIds[0]);
    expect((await app.inject('/api/v1/conversations?includeLinked=maybe')).statusCode).toBe(400);
  });
  it('uses the selected history page order for history, media and read-aloud', async () => {
    const {app,gateway}=await fixture(); const orders: (string | undefined)[]=[];
    gateway.history=async (_id,offset,order)=>{ orders.push(order); return {sessionId:'personal',offset,order,hasMore:false,fetchedAt:Date.now(),messages:[{id:1,role:'assistant',content:'Latest response @file:/tmp/latest.pdf'}]}; };
    gateway.http=async()=>({dataUrl:'data:application/pdf;base64,JVBERg=='});
    const headers={'x-tasks-request':'1'}, base={conversationId:'personal',order:'latest',offset:200,index:0};
    expect((await app.inject('/api/v1/conversations/personal/history?order=latest&offset=200')).statusCode).toBe(200);
    expect((await app.inject({method:'POST',url:'/api/v1/media',headers,payload:{...base,path:'/tmp/latest.pdf'}})).statusCode).toBe(200);
    expect((await app.inject({method:'POST',url:'/api/v1/audio/speak',headers,payload:{...base,text:'Latest response @file:/tmp/latest.pdf'}})).statusCode).toBe(200);
    expect(orders).toEqual(['latest','latest','latest']);
    await app.inject('/api/v1/conversations/personal/history'); expect(orders.at(-1)).toBe('oldest');
  });
  it('denies unknown identities and invalid origins', async () => {
    const { app } = await fixture(false);
    expect((await app.inject({ method: 'GET', url: '/api/v1/state' })).statusCode).toBe(403);
    const headers = { host: 'tasks.example:8443', 'tailscale-user-login': 'owner@example.com' };
    expect((await app.inject({ method: 'GET', url: '/api/v1/state', headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/sync', headers: { ...headers, origin: 'https://attacker.example', 'x-tasks-request': '1' }, payload: {} })).statusCode).toBe(403);
  });
  it('persists task changes with Hermes unavailable and rejects invalid titles', async () => {
    const { app } = await fixture(); const headers = { 'x-tasks-request': '1' };
    const op = { id: randomUUID(), taskId: randomUUID(), kind: 'create', title: 'Offline from Hermes', at: Date.now() };
    expect((await app.inject({ method: 'POST', url: '/api/v1/sync', headers, payload: op })).statusCode).toBe(200);
    const state = (await app.inject('/api/v1/state')).json(); expect(state.snapshot.tasks[0].title).toBe(op.title); expect(state.gateway.configured).toBe(false);
    expect((await app.inject({ method: 'POST', url: '/api/v1/sync', headers, payload: { ...op, id: randomUUID(), title: '' } })).statusCode).toBe(400);
  });
  it('resumes uploads at the confirmed offset, verifies bytes and rejects ID reuse', async () => {
    const { app } = await fixture(); const bytes = Buffer.from('preserve this attachment');
    const u = { id: randomUUID(), name: 'notes.txt', type: 'text/plain', size: bytes.length, hash: createHash('sha256').update(bytes).digest('hex') };
    const headers = { 'x-tasks-request': '1' };
    expect((await app.inject({ method: 'POST', url: '/api/v1/uploads', headers, payload: u })).statusCode).toBe(200);
    const put = (offset:number, data:Buffer) => app.inject({ method: 'PUT', url: `/api/v1/uploads/${u.id}?offset=${offset}`, headers: { ...headers, 'content-type': 'application/octet-stream' }, payload: data });
    expect((await put(0, bytes.subarray(0,7))).json().offset).toBe(7);
    expect((await put(0, bytes.subarray(0,7))).json().offset).toBe(7);
    expect((await put(7, bytes.subarray(7))).json().complete).toBe(true);
    expect((await app.inject(`/api/v1/uploads/${u.id}`)).body).toBe(bytes.toString());
    expect((await app.inject({ method: 'POST', url: '/api/v1/uploads', headers, payload: { ...u, name: 'different.txt' } })).statusCode).toBe(409);
  });
  it('does not expose arbitrary existing-task conversation linking or remote credentials', async () => {
    const { app } = await fixture();
    expect((await app.inject({ method: 'POST', url: '/api/v1/tasks/a/link', headers: { 'x-tasks-request': '1' }, payload: {} })).statusCode).toBe(404);
    const state = (await app.inject('/api/v1/state')).json(); expect(JSON.stringify(state)).not.toContain('privateKey'); expect(JSON.stringify(state)).not.toContain('hermesToken');
  });
  it('serves only files referenced in the selected personal message and speaks assistant responses only', async () => {
    const { app, gateway } = await fixture(); const headers = {'x-tasks-request':'1'}; const requests: string[] = [];
    gateway.history = async () => ({sessionId:'personal',offset:0,hasMore:false,fetchedAt:Date.now(),messages:[{id:1,role:'user',content:'My private question'}, {id:2,role:'assistant',content:'Response with @file:/tmp/report.pdf'}]});
    gateway.http = async path => { requests.push(path); return {dataUrl:'data:application/pdf;base64,JVBERg=='}; };
    const body = {conversationId:'personal',offset:0,index:1,path:'/etc/passwd'};
    expect((await app.inject({method:'POST',url:'/api/v1/media',headers,payload:body})).statusCode).toBe(409); expect(requests).toHaveLength(0);
    expect((await app.inject({method:'POST',url:'/api/v1/media',headers,payload:{...body,path:'/tmp/report.pdf'}})).statusCode).toBe(200); expect(requests[0]).toContain('session_id=personal');
    expect((await app.inject({method:'POST',url:'/api/v1/audio/speak',headers,payload:{conversationId:'personal',offset:0,index:0,text:'My private question'}})).statusCode).toBe(409);
    expect((await app.inject({method:'POST',url:'/api/v1/audio/speak',headers,payload:{conversationId:'personal',offset:0,index:1,text:'Arbitrary injected speech'}})).statusCode).toBe(409);
  });
});
