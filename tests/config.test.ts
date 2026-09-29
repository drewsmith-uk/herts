import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { configuration, bindHermesTarget } from '../server/config';
import { Store } from '../server/store';
import { Gateway } from '../server/gateway';
import { createApp } from '../server/app';
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
const prod = { HERTS_ORIGIN: 'https://herts.example.com', HERTS_IDENTITY: 'owner@example.com' };
function database() { const s = new Store(':memory:'); cleanups.push(() => s.close()); return s; }
function linked(s: Store) { s.ensureContext({key:'stored',storedId:'stored',title:'Fixture conversation',source:'desktop'}); }

describe('portable configuration and safe upgrades', () => {
  it('requires explicit private production access and validates origins without echoing credentials', () => {
    expect(() => configuration({})).toThrow('HERTS_ORIGIN');
    expect(() => configuration({HERTS_ORIGIN:prod.HERTS_ORIGIN})).toThrow('HERTS_IDENTITY');
    for (const origin of ['http://herts.example.com','https://herts.example.com/','https://herts.example.com/path','https://user:fixture@herts.example.com','https://herts.example.com#fragment']) expect(() => configuration({...prod,HERTS_ORIGIN:origin})).toThrow('HERTS_ORIGIN');
    expect(configuration({HERTS_DEV:'1',HERTS_PORT:'9000'})).toMatchObject({dev:true,port:9000,origin:'http://127.0.0.1:9000',hermesBase:'',hermesProfile:'default'});
    expect(configuration({ ...prod, HERTS_THEMES_DIR: '/tmp/custom-herts-themes' }).themesDir).toBe('/tmp/custom-herts-themes');
    for (const port of ['0','65536','bad','1.5']) expect(() => configuration({...prod,HERTS_PORT:port})).toThrow('HERTS_PORT');
  });
  it('retains legacy configuration while new settings take precedence', () => {
    expect(configuration({TASKS_ORIGIN:prod.HERTS_ORIGIN,TASKS_IDENTITY:prod.HERTS_IDENTITY,TASKS_DATA_DIR:'legacy-data',PORT:'9001'})).toMatchObject({identity:prod.HERTS_IDENTITY,port:9001,dev:false});
    expect(configuration({...prod,TASKS_ORIGIN:'https://old.example.com',TASKS_IDENTITY:'old@example.com',TASKS_DEV:'1',HERTS_DEV:'0',HERTS_PORT:'9002',PORT:'9001'})).toMatchObject({origin:prod.HERTS_ORIGIN,identity:prod.HERTS_IDENTITY,dev:false,port:9002});
    expect(() => configuration({...prod,HERTS_ORIGIN:'',TASKS_ORIGIN:prod.HERTS_ORIGIN})).toThrow('HERTS_ORIGIN');
  });
  it('loads a private token file without exporting its contents to client settings', () => {
    const dir=mkdtempSync(join(tmpdir(),'herts-config-'));cleanups.push(()=>rmSync(dir,{recursive:true,force:true}));const file=join(dir,'backend-token');writeFileSync(file,'fixture-file-token\n');
    expect(configuration({...prod,HERMES_BASE_URL:'http://127.0.0.1:8788/',HERMES_TOKEN:'ignored',HERMES_TOKEN_FILE:file,HERMES_PROFILE:'research'})).toMatchObject({hermesToken:'fixture-file-token',hermesBase:'http://127.0.0.1:8788',hermesProfile:'research'});
    for (const base of ['http://remote.example.com','https://user:fixture@remote.example.com','https://remote.example.com/api']) expect(()=>configuration({...prod,HERMES_BASE_URL:base,HERMES_TOKEN:'fixture'})).toThrow('HERMES_BASE_URL');
    expect(()=>configuration({...prod,HERMES_TOKEN:'fixture'})).toThrow('both');
    expect(()=>configuration({...prod,HERMES_PROFILE:'../other'})).toThrow('HERMES_PROFILE');
  });
  it('pins a legacy linked store before connecting, retaining its keys and data', () => {
    const s=database();linked(s);s.setMeta('vapid',{publicKey:'fixture-public',privateKey:'fixture-private'});
    expect(()=>bindHermesTarget(s,'http://127.0.0.1:8788','work')).toThrow('separate HERTS_DATA_DIR');
    bindHermesTarget(s,'http://127.0.0.1:8788','default');bindHermesTarget(s,'','default');
    expect(()=>bindHermesTarget(s,'http://127.0.0.1:8789','default')).toThrow('different Hermes target');
    expect(()=>bindHermesTarget(s,'http://127.0.0.1:8788','work')).toThrow('different Hermes target');
    bindHermesTarget(s,'http://127.0.0.1:8788/','default');expect(s.contexts()).toHaveLength(1);expect(s.getMeta('vapid').privateKey).toBe('fixture-private');
    const empty=database();bindHermesTarget(empty,'http://127.0.0.1:8788','default');bindHermesTarget(empty,'http://127.0.0.1:8789','work');expect(empty.getMeta('hermesTarget').profile).toBe('work');
  });
  it('scopes listing, search, history and owned-session fallback to the selected profile', async () => {
    const g=new Gateway('','',[],()=>['owned'],'research'),paths:string[]=[];
    g.http=async path=>{paths.push(path);if(path.includes('/messages?'))return{session_id:'owned',profile:'research',messages:[]};if(path.startsWith('/api/sessions/owned?'))return{id:'owned',profile:'research',source:'desktop'};if(path.includes('/search?'))return{results:[]};return{sessions:[],total:0};};
    await g.conversations();await g.search('term');await g.history('owned',0);
    expect(paths).toHaveLength(4);expect(paths.every(p=>new URL(p,'http://localhost').searchParams.get('profile')==='research')).toBe(true);
    g.http=async()=>({session_id:'owned',profile:'default',messages:[]});await expect(g.history('owned',0)).rejects.toThrow('ownership');
  });
  it('uses the selected profile for attachment reads, transcription and response speech', async () => {
    const dir=mkdtempSync(join(tmpdir(),'herts-media-profile-'));
    const {app,gateway,store}=await createApp({dataDir:dir,origin:'http://127.0.0.1:8787',identity:'fixture',dev:true,hermesBase:'',hermesToken:'',hermesProfile:'research'});
    cleanups.push(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
    const content='[file](/tmp/fixture.pdf)',paths:string[]=[];
    gateway.history=async()=>({sessionId:'stored',order:'oldest',offset:0,hasMore:false,fetchedAt:1,messages:[{id:1,role:'assistant',content}]});
    gateway.http=async path=>{paths.push(path);return{dataUrl:'data:application/pdf;base64,Zml4dHVyZQ==',transcript:'Fixture transcript'};};
    const headers={'x-herts-request':'1'},post=(url:string,payload:any)=>app.inject({method:'POST',url,headers,payload});
    expect((await post('/api/v1/media',{conversationId:'stored',offset:0,index:0,path:'/tmp/fixture.pdf'})).statusCode).toBe(200);
    expect((await post('/api/v1/audio/speak',{conversationId:'stored',offset:0,index:0,text:content})).statusCode).toBe(200);
    const uploadId=randomUUID();writeFileSync(join(dir,'uploads',uploadId),'fixture');store.saveUpload({id:uploadId,name:'voice.webm',type:'audio/webm',size:7,hash:'fixture',complete:true});
    expect((await post('/api/v1/audio/transcribe',{id:randomUUID(),uploadId})).statusCode).toBe(200);
    expect(paths).toHaveLength(3);expect(paths.every(path=>new URL(path,'http://localhost').searchParams.get('profile')==='research')).toBe(true);
  });
  it('accepts installed clients’ request header and the Herts header while rejecting missing or foreign-origin headers', async () => {
    const dir=mkdtempSync(join(tmpdir(),'herts-api-'));
    const {app,plugins}=await createApp({dataDir:dir,origin:prod.HERTS_ORIGIN,identity:prod.HERTS_IDENTITY,hermesBase:'',hermesToken:'',hermesProfile:'research'});
    cleanups.push(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
    await plugins.activate('tasks');
    const base={host:'herts.example.com','tailscale-user-login':prod.HERTS_IDENTITY,origin:prod.HERTS_ORIGIN};
    for (const header of ['x-tasks-request','x-herts-request']) expect((await app.inject({method:'POST',url:'/api/v1/sync',headers:{...base,[header]:'1'},payload:{id:randomUUID(),taskId:randomUUID(),kind:'create',title:'Offline-capable task',at:Date.now()}})).statusCode).toBe(200);
    expect((await app.inject({method:'POST',url:'/api/v1/sync',headers:base,payload:{}})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:'/api/v1/sync',headers:{...base,'x-herts-request':'1',origin:'https://attacker.example'},payload:{}})).statusCode).toBe(403);
    const state=(await app.inject({url:'/api/v1/state',headers:base})).json();expect(state.snapshot.tasks).toHaveLength(2);expect(state.gateway).toEqual({online:false,configured:false,profile:'research',promptProtocol:'unknown'});expect(JSON.stringify(state)).not.toContain('hermesToken');
  });
});
