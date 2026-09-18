import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { Store } from '../server/store';
import { Snoozes } from '../server/snoozes';
import { originalSpaceId, spaceLists, taskSpaceId, type TaskOp, type Status } from '../shared/model';

const stores: Store[] = [], schedulers: Snoozes[] = [];
afterEach(() => { schedulers.splice(0).forEach(s => s.close()); stores.splice(0).forEach(s => s.close()); vi.useRealTimers(); });
const fresh = () => { const s = new Store(':memory:'); stores.push(s); return s; };
function capture(s: Store, spaceId=originalSpaceId) { const op: TaskOp={id:randomUUID(),taskId:randomUUID(),kind:'create',title:'Private task',spaceId,at:100}; s.mutate(op);return op.taskId; }
function snooze(s: Store, id: string, until=1000, at=200): TaskOp { const t=s.task(id)!;return {id:randomUUID(),taskId:id,kind:'snooze',spaceId:taskSpaceId(t),baseSpaceId:taskSpaceId(t),baseStatus:t.status,baseSnoozeId:t.snoozeId||null,snoozedUntil:until,at}; }
function move(s: Store, id: string, status: Status, spaceId=taskSpaceId(s.task(id)!)) { const t=s.task(id)!;s.mutate({id:randomUUID(),taskId:id,kind:'move',spaceId,baseSpaceId:taskSpaceId(t),baseStatus:t.status,baseSnoozeId:t.snoozeId||null,status,at:500}); }

describe('snoozed task reminders',()=>{
  it('orders reminders by time and atomically returns due tasks to their own Inbox top once',()=>{
    const s=fresh(),work=randomUUID();s.mutateSpace({id:randomUUID(),spaceId:work,kind:'create',name:'Work',at:1});
    const personal=capture(s),old=capture(s,work),later=capture(s,work),first=capture(s,work);
    s.mutate(snooze(s,later,2000));const op=snooze(s,first,1000);s.mutate(op);
    expect(spaceLists(s.snapshot(),work).snoozed.ids).toEqual([first,later]);expect(s.wakeSnoozed(999)).toBe(0);
    expect(s.wakeSnoozed(1000)).toBe(1);expect(spaceLists(s.snapshot(),work).inbox.ids).toEqual([first,old]);expect(s.snapshot().lists.inbox.ids).toEqual([personal]);
    expect(s.task(first)).toMatchObject({status:'inbox',snoozedUntil:null,snoozeId:null,completedAt:null});
    expect(s.db.prepare('SELECT * FROM notices').all()).toEqual([{id:`snooze:${first}:${op.id}`,task_id:first,kind:'reminder',at:1000}]);
    const revision=s.snapshot().revision;s.mutate(op);expect(s.wakeSnoozed(1500)).toBe(0);expect(s.snapshot().revision).toBe(revision);
    expect(s.notificationRoute(first)).toBe(`/task/${first}`);expect(s.actions()).toEqual([]);
  });
  it('changing a reminder invalidates older schedules and conflicts with stale changes',()=>{
    const s=fresh(),id=capture(s);s.mutate(snooze(s,id));const stale=snooze(s,id,3000);const newer=snooze(s,id,5000);s.mutate(newer);
    expect(()=>s.mutate(stale)).toThrow('reminder changed');expect(s.wakeSnoozed(1000)).toBe(0);expect(s.wakeSnoozed(5000)).toBe(1);
    expect(s.db.prepare('SELECT id FROM notices').all()).toEqual([{id:`snooze:${id}:${newer.id}`}]);
    expect(()=>s.mutate({...stale,id:randomUUID()})).toThrow('another list');
  });
  it.each<Status>(['inbox','next','waiting','parked','done'])('moving a snoozed task to %s cancels its reminder',status=>{
    const s=fresh(),id=capture(s);s.mutate(snooze(s,id));move(s,id,status);expect(s.wakeSnoozed(5000)).toBe(0);
    expect(s.task(id)).toMatchObject({status,snoozedUntil:null,snoozeId:null});expect(s.db.prepare('SELECT * FROM notices').all()).toEqual([]);
    if(status==='done'){expect(s.task(id)?.previousStatus).toBe('inbox');move(s,id,'inbox');expect(s.task(id)?.snoozedUntil).toBeNull();}
  });
  it('cross-space moves cancel snoozing while titles, conversations and active work are preserved',()=>{
    const s=fresh(),id=capture(s),work=randomUUID();s.mutateSpace({id:randomUUID(),spaceId:work,kind:'create',name:'Work',at:1});
    s.linkNew(id,{key:'chat',storedId:'chat',source:'desktop',title:'Chat'});s.mutate(snooze(s,id));
    const action={id:randomUUID(),taskId:id,kind:'send',state:'running',phase:'working',text:'saved',uploadIds:[],createdAt:1,updatedAt:1,receipt:'accepted'} as const;s.saveAction({...action,uploadIds:[]});const before=s.actions();
    s.mutate({id:randomUUID(),taskId:id,kind:'title',title:'Renamed',baseTitle:'Private task',at:400});expect(s.task(id)?.snoozedUntil).toBe(1000);
    move(s,id,'inbox',work);expect(s.wakeSnoozed(1000)).toBe(0);expect(s.task(id)).toMatchObject({spaceId:work,status:'inbox',title:'Renamed',link:{key:'chat'}});expect(s.actions()).toEqual(before);
  });
  it('requires a valid future choice and rejects snoozing from other lists or unqualified moves',()=>{
    const s=fresh(),id=capture(s);
    expect(()=>s.mutate(snooze(s,id,100))).toThrow('future');expect(()=>s.mutate(snooze(s,id,NaN))).toThrow('future');
    expect(()=>move(s,id,'snoozed')).toThrow('Choose a reminder');move(s,id,'next');expect(()=>s.mutate(snooze(s,id))).toThrow('Only Inbox');
    expect(s.db.prepare('SELECT * FROM notices').all()).toEqual([]);
  });
  it('schedules independently of browsers and recovers overdue synced changes and server downtime',async()=>{
    vi.useFakeTimers();vi.setSystemTime(500);const s=fresh(),id=capture(s);s.mutate(snooze(s,id,1000));const scheduler=new Snoozes(s);schedulers.push(scheduler);
    await vi.advanceTimersByTimeAsync(499);expect(s.task(id)?.status).toBe('snoozed');await vi.advanceTimersByTimeAsync(1);expect(s.task(id)?.status).toBe('inbox');
    scheduler.close();s.mutate(snooze(s,id,2000,1100));vi.setSystemTime(5000);schedulers.push(new Snoozes(s));expect(s.task(id)?.status).toBe('inbox');
    // An offline choice made in the future at the time of selection is still
    // accepted after its deadline, then becomes due immediately on the server.
    s.mutate(snooze(s,id,4000,3000));await vi.advanceTimersByTimeAsync(1);expect(s.task(id)?.status).toBe('inbox');expect(s.db.prepare('SELECT * FROM notices').all()).toHaveLength(3);
  });
  it('upgrades old list snapshots without changing task data, legacy receipts or existing order',async()=>{
    const dir=await mkdtemp('/tmp/snooze-migration-');let s=new Store(`${dir}/tasks.sqlite`);
    try {
      capture(s);capture(s);const before=s.snapshot(),tasks=s.db.prepare('SELECT * FROM tasks').all(),receipts=s.db.prepare('SELECT * FROM receipts').all();
      const meta=s.getMeta('snapshot');delete meta.lists.snoozed;for(const lists of Object.values(meta.spaceLists) as any[])delete lists.snoozed;s.setMeta('snapshot',meta);s.db.exec('DROP TABLE notification_tests; DROP TABLE subscriptions; CREATE TABLE subscriptions (id TEXT PRIMARY KEY, data TEXT NOT NULL);');s.db.pragma('user_version = 3');s.close();s=new Store(`${dir}/tasks.sqlite`);
      expect(s.snapshot()).toEqual(before);expect(s.db.prepare('SELECT * FROM tasks').all()).toEqual(tasks);expect(s.db.prepare('SELECT * FROM receipts').all()).toEqual(receipts);expect(s.db.pragma('user_version',{simple:true})).toBe(5);expect(s.db.pragma('foreign_key_check')).toEqual([]);
    }finally{s.close();await rm(dir,{recursive:true,force:true});}
  });
});
