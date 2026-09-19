import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, cp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app';
import { Store } from '../server/store';
const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const fn of cleanup.splice(0).reverse())await fn();});
async function fixture(legacy=false){
  const root=await mkdtemp('/tmp/herts-plugin-test-'),dataDir=join(root,'data'),pluginsDir=join(root,'plugins');
  cleanup.push(()=>rm(root,{recursive:true,force:true}));
  await mkdir(pluginsDir,{recursive:true});
  for(const id of ['tasks','reading'])await cp(resolve('plugins',id),join(pluginsDir,id),{recursive:true});
  if(legacy){const s=new Store(join(dataDir,'tasks.sqlite'));s.mutate({id:randomUUID(),taskId:randomUUID(),kind:'create',title:'Legacy fixture',at:1});s.close();}
  const app=await createApp({dataDir,pluginsDir,origin:'http://127.0.0.1:8790',identity:'fixture',dev:true,hermesBase:'',hermesToken:''});
  cleanup.push(()=>app.app.close());return{...app,root,pluginsDir,dataDir};
}
const op=(command:string,input:any,generation=0)=>({id:input.id,generation,command,input});
describe('public plugin framework',()=>{
  it('starts fresh with core only and migrates an existing installation with its tasks and order',async()=>{
    const fresh=await fixture();expect(fresh.plugins.catalogue().order).toEqual(['conversations']);expect(fresh.plugins.catalogue().entries.every(e=>!e.enabled)).toBe(true);
    const legacy=await fixture(true);expect(legacy.plugins.catalogue().order).toEqual(['tasks','conversations','reading']);expect(legacy.plugins.enabled('tasks')).toBe(true);expect(legacy.plugins.enabled('reading')).toBe(true);
    expect(legacy.plugins.storage.data('tasks').records.state).toMatchObject({tasks:[{title:'Legacy fixture'}]});expect(legacy.store.db.prepare('SELECT * FROM tasks').all()).toEqual([]);
  });
  it('retains records when disabled or removed and requires explicit re-enabling after restoration',async()=>{
    const f=await fixture();await f.plugins.activate('tasks');
    const taskId=randomUUID(),input={id:randomUUID(),taskId,kind:'create',title:'Retained task',at:1};
    await f.plugins.command('tasks',op('task',input));await f.plugins.disable('tasks');
    expect(f.store.task(taskId)?.title).toBe('Retained task');await expect(f.plugins.command('tasks',op('task',input))).rejects.toMatchObject({statusCode:423});
    await rm(join(f.pluginsDir,'tasks'),{recursive:true});await f.plugins.scan();expect(f.plugins.catalogue().entries.find(e=>e.manifest.id==='tasks')?.status).toBe('unavailable');
    await cp(resolve('plugins/tasks'),join(f.pluginsDir,'tasks'),{recursive:true});await f.plugins.scan();expect(f.plugins.enabled('tasks')).toBe(false);await f.plugins.activate('tasks');expect(f.store.task(taskId)?.title).toBe('Retained task');
  });
  it('reset fences old operations, preserves conversations and other plugins, and requires the exact confirmation',async()=>{
    const f=await fixture();await f.plugins.activate('tasks');await f.plugins.activate('reading');
    const taskId=randomUUID(),input={id:randomUUID(),taskId,kind:'create',title:'Reset fixture',at:1};await f.plugins.command('tasks',op('task',input));
    const contexts=f.store.contexts();
    await expect(f.plugins.reset('tasks','yes')).rejects.toMatchObject({statusCode:400});expect(f.store.task(taskId)).toBeDefined();
    await f.plugins.reset('tasks','Tasks');expect(f.store.snapshot().tasks).toEqual([]);expect(f.store.contexts()).toEqual(contexts);expect(f.plugins.enabled('tasks')).toBe(true);expect(f.plugins.enabled('reading')).toBe(true);
    await expect(f.plugins.command('tasks',op('task',input))).rejects.toMatchObject({statusCode:410});
    const response=await f.app.inject({method:'POST',url:'/api/v1/sync',headers:{'x-herts-request':'1'},payload:input});expect(response.statusCode).toBe(410);
    await f.plugins.command('tasks',op('task',{...input,id:randomUUID(),taskId:randomUUID()},1));expect(f.store.snapshot().tasks).toHaveLength(1);
  });
  it('discovers an independent prepared plugin and retains its namespace through removal and reset without its code',async()=>{
    const f=await fixture();await cp(resolve('examples/notes'),join(f.pluginsDir,'notes'),{recursive:true});await f.plugins.scan();
    expect(f.plugins.enabled('notes')).toBe(false);await f.plugins.activate('notes');const input={id:randomUUID(),title:'SDK note'};
    await f.plugins.command('notes',op('save',input));expect(f.plugins.storage.data('notes').records[`note:${input.id}`]).toMatchObject({title:'SDK note'});
    await rm(join(f.pluginsDir,'notes'),{recursive:true});await f.plugins.scan();await f.plugins.reset('notes','Notes');expect(f.plugins.storage.data('notes').records).toEqual({});expect(f.plugins.storage.data('notes').generation).toBe(1);
  });
  it('pauses jobs and combines reminders due while disabled into one catch-up notice',async()=>{
    const f=await fixture();await f.plugins.activate('tasks');await f.plugins.disable('tasks');
    const storage=f.plugins.storage,now=Date.now(),state=storage.data('tasks').records.state as any;
    for(let i=0;i<2;i++){const id=randomUUID();state.tasks.push({id,contextId:id,spaceId:state.defaultSpaceId,title:`Reminder ${i}`,status:'snoozed',previousStatus:'inbox',completedAt:null,snoozedUntil:now-1000,snoozeId:randomUUID(),createdAt:1,updatedAt:1,link:null});state.spaceLists[state.defaultSpaceId].snoozed.ids.push(id);}
    storage.transaction('tasks',0,()=>{},tx=>tx.put('state',state));
    expect(f.store.db.prepare('SELECT * FROM notices').all()).toEqual([]);await f.plugins.activate('tasks');
    const notices=f.store.db.prepare('SELECT * FROM plugin_notices').all()as any[];expect(notices).toHaveLength(1);expect(JSON.parse(notices[0].data).title).toBe('2 reminders are back in Inbox');expect(f.store.snapshot().tasks.every(t=>t.status==='inbox')).toBe(true);
    await f.plugins.disable('tasks');await f.plugins.activate('tasks');expect(f.store.db.prepare('SELECT * FROM notices').all()).toHaveLength(1);
  });
  it('stages changed packages and refuses incompatible versions without running them',async()=>{
    const f=await fixture();await f.plugins.activate('tasks');const file=join(f.pluginsDir,'tasks','plugin.json'),manifest=JSON.parse(await readFile(file,'utf8'));
    await writeFile(file,JSON.stringify({...manifest,version:'1.0.1'}));await f.plugins.scan();expect(f.plugins.catalogue().entries.find(e=>e.manifest.id==='tasks')).toMatchObject({enabled:true,candidateVersion:'1.0.1'});
    await f.plugins.activate('tasks',true);expect(f.plugins.catalogue().entries.find(e=>e.manifest.id==='tasks')?.manifest.version).toBe('1.0.1');
    await writeFile(file,JSON.stringify({...manifest,apiVersion:999}));await f.plugins.scan();expect(f.plugins.enabled('tasks')).toBe(false);expect(f.plugins.catalogue().entries.find(e=>e.manifest.id==='tasks')?.status).toBe('incompatible');
  });
  it('rejects late writes and rolls back a failed package migration without touching core data',async()=>{
    const f=await fixture(),root=join(f.pluginsDir,'probe'),key=`herts-test-${randomUUID()}`;
    await mkdir(root);
    const manifest={id:'probe',name:'Probe',description:'Lifecycle fixture',version:'1',apiVersion:1,schemaVersion:1,server:'server.mjs'};
    await writeFile(join(root,'plugin.json'),JSON.stringify(manifest));
    await writeFile(join(root,'server.mjs'),`export default api=>{globalThis[${JSON.stringify(key)}]=api;return{migrate:(_from,tx)=>{tx.put('kept',{value:1});tx.put('private:secret',{fixture:true});}}}`);
    try{
      await f.plugins.scan();await f.plugins.activate('probe');
      const old=(globalThis as any)[key];
      let expired:any;old.transaction((tx:any)=>{expired=tx;});expect(()=>expired.put('late',true)).toThrow('transaction has finished');
      expect(f.plugins.storage.data('probe').records).toEqual({kept:{value:1}});
      const pendingFile = old.files.write('same-key', Buffer.alloc(1024 * 1024, 1)).catch(() => {});
      await f.plugins.disable('probe');expect(()=>old.transaction((tx:any)=>tx.put('late',true))).toThrow('paused');
      await f.plugins.activate('probe');expect(()=>old.transaction((tx:any)=>tx.put('late',true))).toThrow('paused');
      const current = (globalThis as any)[key];
      await current.files.write('same-key', Buffer.from('New activation'));
      await pendingFile;
      expect((await current.files.read('same-key')).toString()).toBe('New activation');
      await expect(old.files.remove('same-key')).rejects.toThrow('paused');
      await writeFile(join(root,'plugin.json'),JSON.stringify({...manifest,version:'2',schemaVersion:2}));
      await writeFile(join(root,'server.mjs'),`export default ()=>({migrate:(_from,tx)=>{tx.put('kept',{value:2});throw new Error('Fixture migration failure');}})`);
      await f.plugins.scan();await expect(f.plugins.activate('probe',true)).rejects.toThrow('Fixture migration failure');
      expect(f.plugins.storage.data('probe')).toMatchObject({schemaVersion:1,records:{kept:{value:1}}});
      expect(f.plugins.enabled('probe')).toBe(false);
      await f.plugins.reset('probe','Probe');expect(f.plugins.storage.data('probe').records).toEqual({});
      expect(()=>old.transaction((tx:any)=>tx.put('late',true))).toThrow();
    }finally{delete (globalThis as any)[key];}
  });
  it('preserves legacy receipts across migration and prevents generation-zero data returning after reset',async()=>{
    const root=await mkdtemp('/tmp/herts-receipt-migration-'),dataDir=join(root,'data');
    cleanup.push(()=>rm(root,{recursive:true,force:true}));
    const store=new Store(join(dataDir,'tasks.sqlite')),input={id:randomUUID(),taskId:randomUUID(),kind:'create' as const,title:'Receipt fixture',at:1};
    store.mutate(input);const before=store.snapshot();store.close();
    const f=await createApp({dataDir,origin:'http://127.0.0.1:8790',identity:'fixture',dev:true,hermesBase:'',hermesToken:''});cleanup.push(()=>f.app.close());
    await f.plugins.command('tasks',op('task',input));expect(f.store.snapshot().tasks).toEqual(before.tasks);
    await f.plugins.reset('tasks','Tasks');await expect(f.plugins.command('tasks',op('task',input))).rejects.toMatchObject({statusCode:410});
    expect(f.store.snapshot().tasks).toEqual([]);
    expect(f.store.context(input.taskId)).toBeDefined();
  });
  it('keeps immutable assets and rejects route conflicts or changes made after rescan',async()=>{
    const f=await fixture();await f.plugins.activate('tasks');
    const hash=f.plugins.catalogue().entries.find(e=>e.manifest.id==='tasks')!.hash!;
    const original=await readFile(await f.plugins.asset('tasks',hash,'client.js'),'utf8');
    await writeFile(join(f.pluginsDir,'tasks','client.js'),original+'\n// update fixture');await f.plugins.scan();
    expect(await readFile(await f.plugins.asset('tasks',hash,'client.js'),'utf8')).toBe(original);
    await writeFile(join(f.pluginsDir,'tasks','client.js'),original+'\n// changed again');
    await expect(f.plugins.activate('tasks',true)).rejects.toThrow('changed during installation');
    const duplicate=join(f.pluginsDir,'route-probe');await mkdir(duplicate);
    await writeFile(join(duplicate,'plugin.json'),JSON.stringify({id:'route-probe',name:'Route probe',description:'Fixture',version:'1',apiVersion:1,schemaVersion:1,server:'server.mjs',routes:['/tasks']}));
    await writeFile(join(duplicate,'server.mjs'),'export default ()=>({})');await f.plugins.scan();
    expect(f.plugins.catalogue().entries.find(e=>e.manifest.id==='tasks')!.status).toBe('incompatible');
    expect(f.plugins.catalogue().entries.find(e=>e.manifest.id==='route-probe')!.status).toBe('incompatible');
  });

  it('clears capture audio and rejects a late transcription while preserving accepted conversation attachments',async()=>{
    const f=await fixture();await f.plugins.activate('tasks');
    const capture=randomUUID(),attachment=randomUUID(),transcription=randomUUID(),contextId=randomUUID();
    for(const id of [capture,attachment]){f.store.saveUpload({id,name:'voice.webm',type:'audio/webm',size:7,hash:'fixture',complete:true,owner:'tasks:0'});await writeFile(join(f.dataDir,'uploads',id),'fixture');}
    f.store.saveContext({id:contextId,title:'Core context',link:null,aliases:[]});
    f.store.saveAction({id:randomUUID(),taskId:contextId,kind:'send',text:'Accepted fixture',uploadIds:[attachment],createdAt:1,updatedAt:1,state:'finished',phase:'complete',receipt:'accepted'});
    let release!:(value:any)=>void,started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});
    f.gateway.http=async()=>{started();return new Promise(resolve=>{release=resolve;});};
    const response=f.app.inject({method:'POST',url:'/api/v1/audio/transcribe',headers:{'x-herts-request':'1'},payload:{id:transcription,uploadId:capture}}).then(result=>result);
    await ready;await f.plugins.reset('tasks','Tasks');release({transcript:'Late fixture'});
    expect((await response).statusCode).toBe(410);
    expect(f.store.upload(capture)).toBeUndefined();await expect(readFile(join(f.dataDir,'uploads',capture))).rejects.toMatchObject({code:'ENOENT'});
    expect(f.store.getMeta(`audio:${transcription}`)).toBeUndefined();expect(f.store.db.prepare('SELECT id FROM receipts WHERE id=?').get(transcription)).toBeUndefined();
    expect(f.store.upload(attachment)).toMatchObject({complete:true});expect(f.store.upload(attachment)?.owner).toBeUndefined();expect(await readFile(join(f.dataDir,'uploads',attachment),'utf8')).toBe('fixture');
  });

});
