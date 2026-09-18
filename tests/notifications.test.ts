import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import webpush from 'web-push';
import { Store } from '../server/store';
import { Notifications } from '../server/notifications';

describe('private reminder notifications',()=>{
  it('delivers a generic reminder when the task is unavailable, retaining retries after failures',async()=>{
    const store=new Store(':memory:'),service=new Notifications(store);const send=vi.spyOn(webpush,'sendNotification').mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({statusCode:201,headers:{},body:''});
    try {
      const taskId=randomUUID(),id=`snooze:${taskId}:${randomUUID()}`;
      service.subscribe({endpoint:'https://fcm.googleapis.com/fcm/send/fixture',keys:{p256dh:'fixture',auth:'fixture'}});
      store.db.prepare('INSERT INTO notices VALUES (?,?,?,?)').run(id,taskId,'reminder',Date.now());
      await service.flush();await service.flush();await service.flush();
      expect(send).toHaveBeenCalledTimes(2);expect(JSON.parse(send.mock.calls[1][1] as string)).toEqual({id,kind:'reminder'});
      expect(store.db.prepare('SELECT delivered,attempts FROM deliveries').get()).toEqual({delivered:1,attempts:2});
    }finally{service.close();store.close();send.mockRestore();}
  });
  it('uses current local task titles for both reminder IDs and Hermes context IDs',async()=>{
    const store=new Store(':memory:'),service=new Notifications(store),send=vi.spyOn(webpush,'sendNotification').mockResolvedValue({statusCode:201,headers:{},body:''});
    try {
      const taskId=randomUUID(),contextId=randomUUID();
      store.mutate({id:randomUUID(),taskId,kind:'create',title:'Initial title',at:Date.now()});
      const task=store.task(taskId)!;task.contextId=contextId;task.link={key:'chat',storedId:'chat',source:'desktop',title:'Original conversation title'};store.saveTask(task);
      store.saveContext({id:contextId,title:'Original conversation title',link:task.link,aliases:[]});
      store.mutate({id:randomUUID(),taskId,kind:'title',baseTitle:'Initial title',title:'Fixture reminder: review sample notes',at:Date.now()});
      service.subscribe({endpoint:'https://fcm.googleapis.com/fcm/send/fixture',keys:{p256dh:'fixture',auth:'fixture'}});
      for(const kind of ['reminder','approval','completion','failure'])store.db.prepare('INSERT INTO notices VALUES (?,?,?,?)').run(kind,kind==='reminder'?taskId:contextId,kind,Date.now());
      store.db.prepare('INSERT INTO notices VALUES (?,?,?,?)').run('conversation-only',randomUUID(),'completion',Date.now());
      await service.flush();
      const payloads=send.mock.calls.map(call=>JSON.parse(call[1] as string));
      expect(payloads).toHaveLength(5);
      for(const kind of ['reminder','approval','completion','failure'])expect(payloads.find(p=>p.id===kind)).toEqual({id:kind,kind,taskTitle:'Fixture reminder: review sample notes'});
      expect(payloads.find(p=>p.id==='conversation-only')).toEqual({id:'conversation-only',kind:'completion'});
      expect(JSON.stringify(payloads)).not.toContain('Original conversation title');
    }finally{service.close();store.close();send.mockRestore();}
  });
  it('shortens long Unicode titles so they fit in encrypted push payloads',async()=>{
    const store=new Store(':memory:'),service=new Notifications(store),send=vi.spyOn(webpush,'sendNotification').mockResolvedValue({statusCode:201,headers:{},body:''});
    try {
      const taskId=randomUUID();store.mutate({id:randomUUID(),taskId,kind:'create',title:'📚'.repeat(1000),at:Date.now()});
      service.subscribe({endpoint:'https://fcm.googleapis.com/fcm/send/fixture',keys:{p256dh:'fixture',auth:'fixture'}});
      store.db.prepare('INSERT INTO notices VALUES (?,?,?,?)').run('long-title',taskId,'reminder',Date.now());await service.flush();
      const payload=send.mock.calls[0][1] as string;expect(JSON.parse(payload).taskTitle).toBe('📚'.repeat(240)+'…');expect(Buffer.byteLength(payload)).toBeLessThan(2000);
    }finally{service.close();store.close();send.mockRestore();}
  });
  it.each([undefined, 'Fixture reminder: review sample notes'])('shows the task title when available (%s), deduplicates delivery and opens its notice route',async(taskTitle)=>{
    const listeners:Record<string,Function>={},seen=new Map(),shown:any[]=[];let opened='';
    const self={location:{origin:'https://tasks.example'},addEventListener:(type:string,fn:Function)=>listeners[type]=fn,registration:{showNotification:async(title:string,options:any)=>shown.push({title,...options})},clients:{matchAll:async()=>[],openWindow:async(url:string)=>opened=url}};
    const caches={open:async()=>({match:async(key:Request)=>seen.get(key.url),put:async(key:Request,value:Response)=>seen.set(key.url,value),keys:async()=>[...seen.keys()].map(key=>new Request(key)),delete:async(key:Request)=>seen.delete(key.url)})};
    runInNewContext(await readFile('public/sw.js','utf8'),{self,caches,Request,Response,URL});
    const id='snooze:opaque-task:opaque-operation';
    async function push(){let work:Promise<void>|undefined;listeners.push({data:{json:()=>({id,kind:'reminder',taskTitle})},waitUntil:(p:Promise<void>)=>work=p});await work;}
    await push();await push();expect(shown).toEqual([{title:taskTitle?'Herts · Reminder':'Herts',body:taskTitle||'A snoozed task is back in your Inbox.',tag:id,renotify:false,icon:'/icon-192.png',data:{id}}]);
    let work:Promise<void>|undefined;listeners.notificationclick({notification:{data:{id},close:()=>{}},waitUntil:(p:Promise<void>)=>work=p});await work;expect(opened).toBe(`/?notice=${encodeURIComponent(id)}`);
  });
});

describe('notification registration recovery', () => {
  const subscription = (suffix='fixture') => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${suffix}`, keys: { p256dh: 'fixture', auth: 'fixture' } });
  it('migrates a legacy subscription without changing VAPID keys or delivery receipts',async()=>{
    const dir=await mkdtemp('/tmp/tasks-push-migration-');let store=new Store(`${dir}/tasks.sqlite`);
    try {
      const service=new Notifications(store),sub=subscription(),id=service.subscribe(sub),keys=service.keys;service.close();
      store.db.prepare('INSERT INTO deliveries VALUES (?,?,?,?)').run('notice',id,1,2);
      store.db.exec('CREATE TABLE legacy_subscriptions (id TEXT PRIMARY KEY,data TEXT NOT NULL); INSERT INTO legacy_subscriptions SELECT id,data FROM subscriptions; DROP TABLE subscriptions; ALTER TABLE legacy_subscriptions RENAME TO subscriptions; DROP TABLE notification_tests; PRAGMA user_version = 4;');
      store.close();store=new Store(`${dir}/tasks.sqlite`);
      expect(store.getMeta('vapid')).toEqual(keys);expect(store.db.prepare('SELECT * FROM subscriptions').get()).toMatchObject({id,data:JSON.stringify(sub),created_at:0,invalid:0});
      expect(store.db.prepare('SELECT * FROM deliveries').get()).toEqual({notice_id:'notice',subscription_id:id,delivered:1,attempts:2});expect(store.db.pragma('user_version',{simple:true})).toBe(5);
    }finally{store.close();await rm(dir,{recursive:true,force:true});}
  });
  it.each([404,410])('retains an expired %i registration for repair, stops sends and never silently revives it', async statusCode => {
    const store=new Store(':memory:'),service=new Notifications(store),sub=subscription();
    const send=vi.spyOn(webpush,'sendNotification').mockRejectedValue({statusCode,body:'SECRET PROVIDER RESPONSE'});
    try {
      expect(service.status(sub.endpoint)).toMatchObject({registered:false,needsRepair:true});service.subscribe(sub);
      expect(service.status(sub.endpoint)).toMatchObject({registered:true,needsRepair:false});
      for(let i=0;i<3;i++)store.db.prepare('INSERT INTO notices VALUES (?,?,?,?)').run(`reminder-${i}`,'task','reminder',Date.now());
      await service.flush();await service.flush();expect(send).toHaveBeenCalledTimes(1);
      expect(service.status(sub.endpoint)).toMatchObject({registered:false,needsRepair:true,error:expect.stringContaining('expired')});
      expect(JSON.stringify(store.db.prepare('SELECT * FROM subscriptions').all())).not.toContain('SECRET');
      expect(()=>service.subscribe(sub)).toThrow('expired');
      service.unsubscribe(sub.endpoint);expect(service.status(sub.endpoint).registered).toBe(false);
      service.subscribe(subscription('new'));expect(service.status(subscription('new').endpoint).registered).toBe(true);
    }finally{service.close();store.close();send.mockRestore();}
  });
  it('preserves registration and sanitizes temporary/provider credential errors', async()=>{
    const store=new Store(':memory:'),service=new Notifications(store),sub=subscription();
    const send=vi.spyOn(webpush,'sendNotification').mockRejectedValueOnce({statusCode:403,body:'secret'}).mockResolvedValue({statusCode:201,headers:{},body:''});
    try {
      service.subscribe(sub);store.db.prepare('INSERT INTO notices VALUES (?,?,?,?)').run('reminder','task','reminder',Date.now());
      await service.flush();expect(service.status(sub.endpoint)).toMatchObject({registered:true,needsRepair:false,error:expect.stringContaining('credentials (403)')});
      await service.flush();expect(service.status(sub.endpoint)).toMatchObject({registered:true,error:undefined,lastAcceptedAt:expect.any(Number)});
    }finally{service.close();store.close();send.mockRestore();}
  });
  it('does not send a backlog to a new registration and preserves the cutoff on re-registration',async()=>{
    const store=new Store(':memory:'),service=new Notifications(store),sub=subscription();
    const send=vi.spyOn(webpush,'sendNotification').mockResolvedValue({statusCode:201,headers:{},body:''});
    try {
      store.db.prepare('INSERT INTO notices VALUES (?,?,?,?)').run('old','task','reminder',Date.now()-60_000);
      const id=service.subscribe(sub),created=(store.db.prepare('SELECT created_at FROM subscriptions WHERE id=?').get(id) as any).created_at;
      store.db.prepare('INSERT INTO notices VALUES (?,?,?,?)').run('new','task','reminder',Date.now());
      service.subscribe(sub);expect((store.db.prepare('SELECT created_at FROM subscriptions WHERE id=?').get(id) as any).created_at).toBe(created);
      await service.flush();expect(send).toHaveBeenCalledTimes(1);expect(JSON.parse(send.mock.calls[0][1] as string).id).toBe('new');
    }finally{service.close();store.close();send.mockRestore();}
  });
  it('tests one device without Hermes, confirms actual display and never repeats an uncertain or failed test',async()=>{
    const store=new Store(':memory:'),service=new Notifications(store),sub=subscription(),id=randomUUID();
    const send=vi.spyOn(webpush,'sendNotification').mockImplementation(async()=>{service.confirmTest(id);return{statusCode:201,headers:{},body:''};});
    try {
      service.subscribe(sub);service.subscribe(subscription('other'));
      expect(await service.test(sub.endpoint,id)).toMatchObject({id,state:'accepted',shownAt:expect.any(Number)});
      await service.test(sub.endpoint,id);expect(send).toHaveBeenCalledTimes(1);expect(JSON.parse(send.mock.calls[0][1] as string)).toEqual({id,kind:'test'});
      expect(send.mock.calls[0][0].endpoint).toBe(sub.endpoint);expect(store.actions()).toEqual([]);expect(store.db.prepare('SELECT * FROM notices').all()).toEqual([]);
      send.mockRejectedValue(new Error('Timeout: SECRET'));const failedId=randomUUID();
      expect(await service.test(sub.endpoint,failedId)).toMatchObject({state:'failed',error:expect.stringContaining('unconfirmed')});
      await service.test(sub.endpoint,failedId);expect(send).toHaveBeenCalledTimes(2);
      const uncertainId=randomUUID();store.db.prepare('INSERT INTO notification_tests VALUES (?,?,?)').run(uncertainId,service.subscribe(sub),JSON.stringify({id:uncertainId,state:'sending'}));
      expect(await service.test(sub.endpoint,uncertainId)).toMatchObject({state:'sending'});expect(send).toHaveBeenCalledTimes(2);
      await expect(service.test(subscription('other').endpoint,id)).rejects.toThrow('another');
    }finally{service.close();store.close();send.mockRestore();}
  });
  it('acknowledges tests only after display, retries an acknowledgement without duplicating the alert and opens Settings',async()=>{
    const listeners:Record<string,Function>={},seen=new Map(),shown:any[]=[];let opened='';
    const display=vi.fn(async(title:string,options:any)=>shown.push({title,...options})),fetch=vi.fn(async()=>new Response('{}'));
    const self={location:{origin:'https://tasks.example'},addEventListener:(type:string,fn:Function)=>listeners[type]=fn,registration:{showNotification:display},clients:{matchAll:async()=>[],openWindow:async(url:string)=>opened=url}};
    const caches={open:async()=>({match:async(key:Request)=>seen.get(key.url),put:async(key:Request,value:Response)=>seen.set(key.url,value),keys:async()=>[...seen.keys()].map(key=>new Request(key)),delete:async(key:Request)=>seen.delete(key.url)})};
    runInNewContext(await readFile('public/sw.js','utf8'),{self,caches,Request,Response,URL,fetch,AbortSignal});
    const id=randomUUID();let work:Promise<void>|undefined;
    async function push(){listeners.push({data:{json:()=>({id,kind:'test'})},waitUntil:(p:Promise<void>)=>work=p});await work;}
    display.mockRejectedValueOnce(new Error('OS blocked display'));await expect(push()).rejects.toThrow('blocked');expect(fetch).not.toHaveBeenCalled();
    await push();await push();expect(shown).toHaveLength(1);expect(shown[0]).toMatchObject({body:expect.stringContaining('Test notification'),data:{id,kind:'test'}});expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]).toEqual([`/api/v1/notifications/tests/${id}/shown`,expect.objectContaining({method:'POST',credentials:'same-origin',headers:expect.objectContaining({'X-Herts-Request':'1'})})]);
    listeners.notificationclick({notification:{data:{id,kind:'test'},close:()=>{}},waitUntil:(p:Promise<void>)=>work=p});await work;expect(opened).toBe('/#/settings');
  });
  it('registers browser-rotated subscriptions before retiring the old endpoint, retaining it if the server is unavailable',async()=>{
    const listeners:Record<string,Function>={},next=subscription('rotated');
    const fetch=vi.fn(async()=>new Response('{}'));
    const self={addEventListener:(type:string,fn:Function)=>listeners[type]=fn,registration:{pushManager:{subscribe:vi.fn(async()=>({endpoint:next.endpoint,toJSON:()=>next}))}}};
    runInNewContext(await readFile('public/sw.js','utf8'),{self,fetch,Response,AbortSignal});
    let work:Promise<void>|undefined;
    async function rotate(){listeners.pushsubscriptionchange({oldSubscription:{endpoint:subscription().endpoint,options:{userVisibleOnly:true}},waitUntil:(p:Promise<void>)=>work=p});await work;}
    await rotate();expect(fetch.mock.calls).toEqual([
      ['/api/v1/notifications/subscribe',expect.objectContaining({body:JSON.stringify(next)})],
      ['/api/v1/notifications/unsubscribe',expect.objectContaining({body:JSON.stringify({endpoint:subscription().endpoint})})]
    ]);
    fetch.mockClear();fetch.mockResolvedValue(new Response('{}',{status:503}));await rotate();expect(fetch).toHaveBeenCalledTimes(1);
  });

});
