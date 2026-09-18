import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { Store } from '../server/store';
import { applyTaskOp, originalSpaceId, spaceLists, taskSpaceId, withSpaces, type Status, type TaskOp, type SpaceOp } from '../shared/model';
const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach(s => s.close()));
const fresh = () => { const s = new Store(':memory:'); stores.push(s); return s; };
const capture = (spaceId = originalSpaceId): TaskOp => ({ id: randomUUID(), taskId: randomUUID(), spaceId, kind: 'create', title: 'Task', at: Date.now() });
function newSpace(store: Store, name = 'Work') { const op: SpaceOp = { id: randomUUID(), spaceId: randomUUID(), kind: 'create', name, at: Date.now() }; store.mutateSpace(op); return op; }
function move(store: Store, taskId: string, status: Status, spaceId = taskSpaceId(store.task(taskId)!)) { const t = store.task(taskId)!; return store.mutate({ id: randomUUID(), taskId, kind: 'move', spaceId, baseSpaceId: taskSpaceId(t), baseStatus: t.status, status, listVersion: spaceLists(store.snapshot(), spaceId)[status].version, at: Date.now() }); }

describe('independent task spaces', () => {
  it('creates independent lists and preserves the original lists as a legacy projection', () => {
    const s = fresh(), work = newSpace(s), personal = capture(), job = capture(work.spaceId);
    s.mutate(personal); s.mutate(job);
    expect(s.snapshot().lists.inbox.ids).toEqual([personal.taskId]);
    expect(spaceLists(s.snapshot(),work.spaceId).inbox.ids).toEqual([job.taskId]);
    expect(s.snapshot().defaultSpaceId).toBe(originalSpaceId);
    const before = s.snapshot().revision; s.mutateSpace(work); expect(s.snapshot().revision).toBe(before);
    expect(() => s.mutateSpace({...work,name:'Changed'})).toThrow('operation ID');
  });
  it('renames spaces by stable identity and syncs the default without moving tasks or changing receipts', () => {
    const s = fresh(), work = newSpace(s), task = capture(work.spaceId); s.mutate(task);
    const op: SpaceOp = { id: randomUUID(), spaceId: work.spaceId, kind: 'default', baseDefaultSpaceId: originalSpaceId, at: 1 }; s.mutateSpace(op);
    s.mutateSpace({ id: randomUUID(), spaceId: work.spaceId, kind: 'rename', baseName:'Work',name:'Family',at:2 });
    expect(withSpaces(s.snapshot()).spaces.find(v=>v.id===work.spaceId)?.name).toBe('Family'); expect(s.snapshot().defaultSpaceId).toBe(work.spaceId);
    expect(taskSpaceId(s.task(task.taskId)!)).toBe(work.spaceId); s.mutate(task); expect(s.snapshot().tasks).toHaveLength(1);
    s.mutateSpace({ id: randomUUID(), spaceId: originalSpaceId, kind:'default',baseDefaultSpaceId:work.spaceId,at:3 }); s.mutateSpace(op); expect(s.snapshot().defaultSpaceId).toBe(originalSpaceId);
  });
  it('rejects duplicate names and conflicting renames/default changes', () => {
    const s=fresh(), work=newSpace(s), family=newSpace(s,'Family');
    expect(()=>newSpace(s,' work ')).toThrow('already exists');
    expect(()=>s.mutateSpace({id:randomUUID(),spaceId:work.spaceId,kind:'rename',name:'Family',baseName:'Work',at:1})).toThrow('already exists');
    s.mutateSpace({id:randomUUID(),spaceId:work.spaceId,kind:'rename',name:'Business',baseName:'Work',at:2});
    expect(()=>s.mutateSpace({id:randomUUID(),spaceId:work.spaceId,kind:'rename',name:'Office',baseName:'Work',at:3})).toThrow('renamed');
    s.mutateSpace({id:randomUUID(),spaceId:work.spaceId,kind:'default',baseDefaultSpaceId:originalSpaceId,at:4});
    expect(()=>s.mutateSpace({id:randomUUID(),spaceId:family.spaceId,kind:'default',baseDefaultSpaceId:originalSpaceId,at:5})).toThrow('default space changed');
  });
  it.each<Status>(['inbox','next','waiting','parked','done'])('moves %s to the top of the other Inbox without changing the conversation', status => {
    const s=fresh(), work=newSpace(s), target=capture(work.spaceId), source=capture(); s.mutate(target);s.mutate(source);
    s.linkNew(source.taskId,{key:'conversation',storedId:'conversation',source:'desktop',title:'Unchanged'});
    if(status!=='inbox')move(s,source.taskId,status);
    const before=s.task(source.taskId)!; move(s,source.taskId,status,work.spaceId);
    const after=s.task(source.taskId)!;
    expect(after).toMatchObject({spaceId:work.spaceId,status:'inbox',completedAt:null,previousStatus:'inbox',contextId:before.contextId,link:before.link,createdAt:before.createdAt});
    expect(spaceLists(s.snapshot(),work.spaceId).inbox.ids).toEqual([source.taskId,target.taskId]);
    expect(Object.values(s.snapshot().lists).flatMap(l=>l.ids)).not.toContain(source.taskId);
  });
  it('rejects stale and legacy moves after a cross-space move but merges independent title edits', () => {
    const s=fresh(), work=newSpace(s), task=capture();s.mutate(task);
    const stale: TaskOp={id:randomUUID(),taskId:task.taskId,kind:'move',baseStatus:'inbox',status:'next',at:2};
    move(s,task.taskId,'inbox',work.spaceId);
    expect(()=>s.mutate(stale)).toThrow('another list or space');
    expect(()=>s.mutate({...stale,id:randomUUID(),spaceId:originalSpaceId,baseSpaceId:originalSpaceId})).toThrow('another list or space');
    s.mutate({id:randomUUID(),taskId:task.taskId,kind:'title',title:'Updated',baseTitle:'Task',at:3}); expect(s.task(task.taskId)).toMatchObject({spaceId:work.spaceId,title:'Updated'});
  });
  it('keeps ordering and Done timestamps independent and legacy captures pinned to the original space', () => {
    const s=fresh(), work=newSpace(s), a=capture(), b=capture(work.spaceId);s.mutate(a);s.mutate(b);
    const version=spaceLists(s.snapshot(),work.spaceId).inbox.version; s.mutate(capture()); expect(spaceLists(s.snapshot(),work.spaceId).inbox.version).toBe(version);
    move(s,b.taskId,'done');const completed=s.task(b.taskId)!.completedAt; move(s,a.taskId,'done'); expect(s.task(b.taskId)!.completedAt).toBe(completed);
    s.mutateSpace({id:randomUUID(),spaceId:work.spaceId,kind:'default',baseDefaultSpaceId:originalSpaceId,at:4});
    const legacy=capture();delete legacy.spaceId;s.mutate(legacy);expect(taskSpaceId(s.task(legacy.taskId)!)).toBe(originalSpaceId);
  });
  it('rejects a missing destination and keeps the source lists unchanged', () => {
    const s=fresh(),task=capture();s.mutate(task);const before=s.snapshot();
    expect(()=>s.mutate({...task,id:randomUUID(),kind:'move',spaceId:randomUUID(),baseSpaceId:originalSpaceId,baseStatus:'inbox',status:'inbox'})).toThrow('space is not available'); expect(s.snapshot()).toEqual(before);
  });
  it('preserves version-two data and operation hashes through migration',async()=>{
    const dir=await mkdtemp('/tmp/spaces-migration-');let s=new Store(`${dir}/tasks.sqlite`);
    try {
      const task=capture();delete task.spaceId;s.mutate(task);s.linkNew(task.taskId,{key:'old-chat',storedId:'old-chat',source:'telegram',title:'Old'});move(s,task.taskId,'done');
      const before=s.snapshot(),receipts=s.db.prepare('SELECT * FROM receipts ORDER BY rowid').all();
      for(const task of before.tasks){delete task.spaceId;s.saveTask(task);}s.setMeta('snapshot',{lists:before.lists,revision:before.revision});s.db.exec('DROP TABLE notification_tests; DROP TABLE subscriptions; CREATE TABLE subscriptions (id TEXT PRIMARY KEY, data TEXT NOT NULL);');s.db.pragma('user_version = 2');s.close();s=new Store(`${dir}/tasks.sqlite`);
      expect(s.snapshot().lists).toEqual(before.lists);expect(s.snapshot().tasks[0]).toEqual({...before.tasks[0],spaceId:originalSpaceId});expect(s.db.prepare('SELECT * FROM receipts ORDER BY rowid').all()).toEqual(receipts);
      expect(s.mutate(task)).toEqual({accepted:true,id:task.id});expect(s.db.pragma('user_version',{simple:true})).toBe(5);expect(s.db.pragma('foreign_key_check')).toEqual([]);
    }finally{s.close();await rm(dir,{recursive:true,force:true});}
  });
});
