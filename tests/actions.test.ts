import { afterEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store';
import { Actions } from '../server/actions';
import { Gateway, GatewayError } from '../server/gateway';

class FakeGateway extends EventEmitter {
  profile = 'default'; epoch = 'epoch-a'; online = true; metadata = undefined; calls: { method: string; params: any }[] = []; failSubmit = false; approvals: any[] = []; running = false;
  failResume = false; resumeBusy = false; seq = 1; queued = false; submitStatus = 'streaming'; replayEvents: any[] = []; truncated = false;
  emitEvent(type: string, payload: any = {}) { const e = {type,session_id:'runtime',seq:++this.seq,payload}; this.emit('event',e); return e; }
  async connect() {}
  async conversation(id: string) { return { id, aliases: [id], key: id }; }
  async rpc(method: string, params: any): Promise<any> {
    this.calls.push({ method, params });
    if (method === 'session.create') return { session_id: 'runtime', stored_session_id: 'stored', info: { profile_name: this.profile } };
    if (method === 'session.resume') {
      if (this.failResume) throw new GatewayError('Resume reply lost', true);
      this.running = this.resumeBusy;
      return {session_id:'runtime',session_key:'stored',messages_omitted:true,info:{profile_name:this.profile},running:this.running,status:this.running?'working':'idle',auto_continue:this.resumeBusy?{attempt:1}:undefined};
    }
    if (method === 'session.title') { this.emit('event', {type: 'session.info', session_id: 'runtime', seq: 1, payload: {}}); return { title: params.title, pending: false }; }
    if (method === 'session.activate') return { session_id: 'runtime', session_key: 'stored', info: { lazy: true }, running: this.running, queued:this.queued?{text:'Waiting message'}:undefined };
    if (method === 'approval.pending') return { approvals: this.approvals };
    if (method === 'session.control.read') return { control: {} };
    if (method === 'prompt.submit') { if (this.failSubmit) throw new GatewayError('reply lost', true); this.running = true; if(this.submitStatus==='streaming') this.emitEvent('message.start'); if(this.submitStatus==='queued') this.queued=true; return { status: this.submitStatus }; }
    if (method === 'approval.respond') { this.approvals = []; return { resolved: 1 }; }
    if (method === 'session.interrupt') return { status: 'interrupted' };
    if (method === 'session.events.since') return { epoch: this.epoch, events: this.replayEvents, latest_seq: this.seq, truncated: this.truncated };
    throw new Error(`Unexpected method ${method}`);
  }
}
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach(f => f()));
function fixture() {
  const store = new Store(':memory:'), gateway = new FakeGateway(), engine = new Actions(store, gateway as unknown as Gateway, '/tmp');
  const taskId = randomUUID(); store.mutate({ id: randomUUID(), taskId, kind: 'create', title: 'Write notes', at: Date.now() });
  cleanup.push(() => { engine.close(); store.close(); }); return { store, gateway, engine, taskId };
}
describe('deliberate execution and receipts', () => {
  it('resolves confirmed title collisions on one session and submits the message once', async () => {
    const { store, gateway, engine, taskId } = fixture();
    store.saveContext({ ...store.context(taskId)!, title: 'New conversation' });
    const rpc = gateway.rpc.bind(gateway); let collisions = 0;
    gateway.rpc = async (method, params) => {
      if (method === 'session.title' && collisions++ < 2) {
        gateway.calls.push({ method, params });
        throw new GatewayError(`Title '${params.title}' is already in use by session existing`, false, 4022);
      }
      return rpc(method, params);
    };
    const input = { id: randomUUID(), taskId, kind: 'send' as const, text: 'Help me plan a holiday' };
    engine.start(input); await expect.poll(() => store.action(input.id)?.receipt).toBe('accepted'); engine.start(input);
    expect(gateway.calls.filter(c => c.method === 'session.create')).toHaveLength(1);
    expect(gateway.calls.find(c => c.method === 'session.create')!.params).not.toHaveProperty('title');
    expect(gateway.calls.filter(c => c.method === 'session.title').map(c => c.params.title)).toEqual(['Help me plan a holiday', 'Help me plan a holiday (2)', 'Help me plan a holiday (3)']);
    expect(gateway.calls.filter(c => c.method === 'prompt.submit')).toHaveLength(1);
    expect(store.context(taskId)?.link?.title).toBe('Help me plan a holiday (3)');
  });
  it('does not retry an uncertain title write or send its saved message', async () => {
    const { store, gateway, engine, taskId } = fixture(); const rpc = gateway.rpc.bind(gateway);
    gateway.rpc = async (method, params) => {
      if (method === 'session.title') { gateway.calls.push({ method, params }); throw new GatewayError('Title reply lost', true); }
      return rpc(method, params);
    };
    const input = { id: randomUUID(), taskId, kind: 'send' as const, text: 'Keep this message' };
    engine.start(input); await expect.poll(() => store.action(input.id)?.receipt).toBe('unknown');
    expect(store.action(input.id)).toMatchObject({ text: input.text, sendStage: 'preparing' });
    expect(gateway.calls.filter(c => c.method === 'session.create')).toHaveLength(1);
    expect(gateway.calls.filter(c => c.method === 'session.title')).toHaveLength(1);
    expect(gateway.calls.filter(c => c.method === 'prompt.submit')).toHaveLength(0);
  });
  it('repairs an older duplicate-title failure on its existing conversation only when sent again', async () => {
    const { store, gateway, engine, taskId } = fixture();
    store.linkNew(taskId, { key: 'stored', storedId: 'stored', title: 'New conversation', source: 'desktop' });
    store.saveAction({ id: randomUUID(), taskId, kind: 'send', text: 'Original saved request', uploadIds: [], createdAt: 1, updatedAt: 1, state: 'failed', phase: 'saving conversation', receipt: 'rejected', sendStage: 'preparing', error: "Title 'New conversation' is already in use by session original" });
    expect(gateway.calls).toEqual([]);
    const input = { id: randomUUID(), taskId, kind: 'send' as const, text: 'Original saved request' };
    engine.start(input); await expect.poll(() => store.action(input.id)?.receipt).toBe('accepted');
    expect(store.context(taskId)?.link?.storedId).toBe('stored');
    expect(gateway.calls.filter(c => c.method === 'session.create')).toHaveLength(0);
    expect(gateway.calls.filter(c => c.method === 'session.title')).toHaveLength(1);
    expect(gateway.calls.filter(c => c.method === 'prompt.submit')).toHaveLength(1);
  });
  it('creates and resumes in a named profile and rejects a mismatched identity before sending', async () => {
    const {store,gateway,engine,taskId}=fixture();gateway.profile='research';
    const first={id:randomUUID(),taskId,kind:'send' as const,text:'A fixture message'};
    engine.start(first);await expect.poll(()=>store.action(first.id)?.receipt).toBe('accepted');
    expect(gateway.calls.find(c=>c.method==='session.create')?.params.profile).toBe('research');
    gateway.running=false;gateway.emitEvent('message.complete',{status:'complete'});await engine.reconcile(taskId);await expect.poll(()=>store.action(first.id)?.state).toBe('finished');
    gateway.epoch='epoch-b';const second={...first,id:randomUUID()};engine.start(second);
    await expect.poll(()=>store.action(second.id)?.receipt).toBe('accepted');
    expect(gateway.calls.find(c=>c.method==='session.resume')?.params.profile).toBe('research');
    gateway.running=false;gateway.emitEvent('message.complete',{status:'complete'});await engine.reconcile(taskId);await expect.poll(()=>store.action(second.id)?.state).toBe('finished');
    gateway.epoch='epoch-c';const rpc=gateway.rpc.bind(gateway);gateway.rpc=async(method,params)=>{const result=await rpc(method,params);return method==='session.resume'?{...result,info:{profile_name:'default'}}:result;};
    const rejected={...first,id:randomUUID()};engine.start(rejected);await expect.poll(()=>store.action(rejected.id)?.receipt).toBe('unknown');
    expect(gateway.calls.filter(c=>c.method==='prompt.submit')).toHaveLength(2);
  });

  it('keeps active work and controls intact when moving a task to another space', async () => {
    const {store,gateway,engine,taskId}=fixture(); const input={id:randomUUID(),taskId,kind:'send' as const,text:'Keep working'};
    engine.start(input);await expect.poll(()=>store.action(input.id)?.receipt).toBe('accepted');
    const before=store.action(input.id),binding=store.binding(taskId),calls=gateway.calls.length,spaceId=randomUUID();
    store.mutateSpace({id:randomUUID(),spaceId,kind:'create',name:'Work',at:Date.now()});
    store.mutate({id:randomUUID(),taskId,kind:'move',spaceId,baseSpaceId:store.task(taskId)!.spaceId,baseStatus:'inbox',status:'inbox',at:Date.now()});
    expect(store.action(input.id)).toEqual(before);expect(store.binding(taskId)).toEqual(binding);expect(gateway.calls).toHaveLength(calls);expect(store.notificationRoute(taskId)).toBe(`/task/${taskId}`);
  });
  it('shares execution and controls between a reading item and a task, retaining original receipts', async () => {
    const { store, gateway, engine } = fixture();
    const contextId = randomUUID(), itemId = randomUUID();
    store.readingMutation({ id: randomUUID(), itemId, contextId, kind: 'create', url: 'https://example.com/article', at: Date.now() });
    const input = { id: randomUUID(), contextId, kind: 'send' as const, text: 'https://example.com/article' };
    engine.start(input); await expect.poll(() => store.action(input.id)?.receipt).toBe('accepted');
    expect(gateway.calls.filter(c => c.method === 'prompt.submit').map(c => c.params.text)).toEqual([input.text]);
    const taskId = randomUUID(); store.createLinked({ id: randomUUID(), taskId, kind: 'create', title: 'Follow up', at: Date.now() }, store.context(contextId)!.link!);
    expect(store.task(taskId)?.contextId).toBe(contextId); expect(engine.main(taskId)?.id).toBe(input.id); expect(store.binding(taskId)).toEqual(store.binding(contextId));
    expect(() => engine.start({ id: randomUUID(), taskId, kind: 'send', text: 'Duplicate work' })).toThrow('already active');
    gateway.approvals = [{ request_id: 'reading-approval', command: 'echo allowed' }]; gateway.emitEvent('approval.request', gateway.approvals[0]);
    const binding = store.binding(contextId)!;
    const decision = { id: randomUUID(), taskId, kind: 'approve' as const, targetId: input.id, generation: binding.generation, approvalId: 'reading-approval' };
    engine.start(decision); await expect.poll(() => store.action(decision.id)?.receipt).toBe('accepted'); engine.start(decision);
    expect(gateway.calls.filter(c => c.method === 'approval.respond')).toHaveLength(1);
    expect(store.notificationRoute(contextId)).toBe(`/task/${taskId}`);
    store.mutate({ id: randomUUID(), taskId, kind: 'move', status: 'done', baseStatus: 'inbox', at: Date.now() });
    expect(store.reading().items[0].readAt).toBeNull(); expect(gateway.calls.filter(c => c.method === 'session.interrupt')).toHaveLength(0);
  });
  it('marks a receipt lost during restart uncertain even when start events arrived first', () => {
    const {store,gateway,engine,taskId}=fixture(); engine.close(); const id=randomUUID();
    store.saveAction({id,taskId,kind:'send',text:'Saved message',uploadIds:[],createdAt:Date.now(),updatedAt:Date.now(),state:'running',phase:'working',receipt:'pending'});
    const restarted=new Actions(store,gateway as unknown as Gateway,'/tmp');
    expect(store.action(id)?.receipt).toBe('unknown'); expect(store.action(id)?.state).toBe('running'); expect(gateway.calls).toEqual([]); restarted.close();
  });
  it('clears only the obsolete preview approval warning at startup without starting work or changing receipts', () => {
    const { store, gateway, engine, taskId } = fixture(); engine.close();
    const original = { id: randomUUID(), taskId, kind: 'send' as const, text: 'Preserve the saved message', uploadIds: [], createdAt: 1, updatedAt: 1, state: 'finished' as const, phase: 'complete', receipt: 'accepted' as const };
    store.saveAction({ ...original, promptWarning: 'Herts cannot display the Hermes “preview.read” prompt. Update Herts or use a compatible Hermes client. No approval was given.' });
    const other = { ...original, id: randomUUID(), promptWarning: 'Herts cannot display the Hermes “sudo” prompt. Update Herts or use a compatible Hermes client. No approval was given.' };
    store.saveAction(other);
    const restarted = new Actions(store, gateway as unknown as Gateway, '/tmp');
    expect(store.action(original.id)?.promptWarning).toBeUndefined();
    expect(store.action(original.id)).toMatchObject({ text: original.text, state: 'finished', receipt: 'accepted', phase: 'complete' });
    expect(store.action(other.id)?.promptWarning).toBe(other.promptWarning);
    expect(gateway.calls).toEqual([]); restarted.close();
  });
  it('cancels an unseen submission durably and rejects its later delayed arrival', () => {
    const { gateway, engine, taskId } = fixture(); const input = { id: randomUUID(), taskId, kind: 'send' as const, text: 'Keep this draft' };
    expect(engine.cancelUndispatched(input).cancelled).toBe(true);
    expect(engine.start(input).receipt).toBe('rejected'); expect(gateway.calls).toEqual([]);
  });
  it('does not cancel or resubmit a request that the server already accepted', async () => {
    const { store, gateway, engine, taskId } = fixture(); const input = { id: randomUUID(), taskId, kind: 'send' as const, text: 'Hello' };
    engine.start(input); await expect.poll(() => store.action(input.id)?.receipt).toBe('accepted');
    expect(engine.cancelUndispatched(input).cancelled).toBe(false);
    expect(engine.cancelUndispatched({...input, id: randomUUID(), text: 'Delayed draft'}).cancelled).toBe(true); expect(engine.main(taskId)?.id).toBe(input.id);
    expect(gateway.calls.filter(c => c.method === 'prompt.submit')).toHaveLength(1);
  });
  it('capture, editing, ordering and completion make no gateway calls', () => {
    const { store, gateway, taskId } = fixture();
    store.mutate({ id: randomUUID(), taskId, kind: 'title', title: 'Edit notes', baseTitle: 'Write notes', at: Date.now() });
    store.mutate({ id: randomUUID(), taskId, kind: 'move', status: 'done', baseStatus: 'inbox', at: Date.now() });
    expect(gateway.calls).toEqual([]);
  });
  it('creates only on first Send, then submits once despite duplicate app requests', async () => {
    const { store, gateway, engine, taskId } = fixture(); const input = { id: randomUUID(), taskId, kind: 'send' as const, text: 'Hello' };
    engine.start(input); await expect.poll(() => store.action(input.id)?.receipt).toBe('accepted'); engine.start(input);
    expect(gateway.calls.filter(c => c.method === 'session.create')).toHaveLength(1); expect(gateway.calls.filter(c => c.method === 'prompt.submit')).toHaveLength(1);
    expect(store.task(taskId)?.link?.storedId).toBe('stored');
  });
  it('keeps a lost send acknowledgement uncertain and refuses automatic repetition', async () => {
    const { store, gateway, engine, taskId } = fixture(); gateway.failSubmit = true;
    const input = { id: randomUUID(), taskId, kind: 'send' as const, text: 'Preserve me' }; engine.start(input);
    await expect.poll(() => store.action(input.id)?.state).toBe('unknown'); engine.start(input);
    expect(store.action(input.id)?.text).toBe('Preserve me'); expect(gateway.calls.filter(c => c.method === 'prompt.submit')).toHaveLength(1);
    expect(() => engine.start({ ...input, id: randomUUID() })).toThrow('uncertain');
  });
  it('rejects stale approval controls and binds consent to one pending request', async () => {
    const { store, gateway, engine, taskId } = fixture(); const input = { id: randomUUID(), taskId, kind: 'send' as const, text: 'Hello' }; engine.start(input); await expect.poll(() => store.action(input.id)?.receipt).toBe('accepted');
    const b = store.binding(taskId)!; gateway.approvals = [{ request_id: 'approval-1', command: 'echo hi' }];
    expect(() => engine.start({ id: randomUUID(), taskId, kind: 'approve', generation: randomUUID(), targetId: input.id, approvalId: 'approval-1' })).toThrow('stale');
    const control = { id: randomUUID(), taskId, kind: 'approve' as const, generation: b.generation, targetId: input.id, approvalId: 'approval-1' }; engine.start(control);
    await expect.poll(() => store.action(control.id)?.receipt).toBe('accepted');
    expect(() => engine.start({ ...control, id: randomUUID(), kind: 'deny' })).toThrow('already submitted');
    expect(gateway.calls.find(c => c.method === 'approval.respond')?.params).toEqual({ session_id: 'runtime', request_id: 'approval-1', choice: 'once', all: false });
  });
  it('treats a stop acknowledgement as stopping until actual terminal evidence', async () => {
    const { store, gateway, engine, taskId } = fixture(); const input = { id: randomUUID(), taskId, kind: 'send' as const, text: 'Hello' }; engine.start(input); await expect.poll(() => store.action(input.id)?.receipt).toBe('accepted');
    const control = { id: randomUUID(), taskId, kind: 'stop' as const, generation: store.binding(taskId)!.generation, targetId: input.id }; engine.start(control); await expect.poll(() => store.action(control.id)?.receipt).toBe('accepted');
    expect(store.action(input.id)?.state).toBe('stopping'); gateway.running = false;
    gateway.emitEvent('message.complete', { status: 'interrupted' }); await engine.reconcile(taskId);
    await expect.poll(() => store.action(input.id)?.state).toBe('finished'); expect(store.action(input.id)?.phase).toBe('stopped');
  });
  it('does not cold-resume or resubmit on gateway restart', async () => {
    const { store, gateway, engine, taskId } = fixture(); const input = { id: randomUUID(), taskId, kind: 'send' as const, text: 'Hello' }; engine.start(input); await expect.poll(() => store.action(input.id)?.receipt).toBe('accepted');
    gateway.epoch = 'epoch-b'; await engine.reconnect();
    expect(store.action(input.id)?.state).toBe('unknown'); expect(store.binding(taskId)?.ready).toBe(false);
    expect(gateway.calls.filter(c => c.method === 'session.resume')).toHaveLength(0); expect(gateway.calls.filter(c => c.method === 'prompt.submit')).toHaveLength(1);
  });
  it('prepares a linked conversation only on Send and deduplicates the whole operation', async () => {
    const {store,gateway,engine,taskId}=fixture(); store.linkNew(taskId,{key:'stored',storedId:'stored',title:'Existing conversation',source:'telegram'});
    expect(gateway.calls).toHaveLength(0);
    const input={id:randomUUID(),taskId,kind:'send' as const,text:'Use the existing context.'};
    engine.start(input); engine.start(input); await expect.poll(()=>store.action(input.id)?.receipt).toBe('accepted');
    expect(gateway.calls.filter(c=>['session.resume','session.create','prompt.submit'].includes(c.method)).map(c=>c.method)).toEqual(['session.resume','prompt.submit']);
    expect(gateway.calls.find(c=>c.method==='prompt.submit')?.params).toEqual({session_id:'runtime',text:input.text});
    gateway.running=false; gateway.emitEvent('message.complete',{status:'complete'}); await engine.reconcile(taskId);
    await expect.poll(()=>store.binding(taskId)?.ready).toBe(true);
    const next={...input,id:randomUUID(),text:'And one more thing.'}; engine.start(next);
    await expect.poll(()=>store.action(next.id)?.receipt).toBe('accepted');
    expect(gateway.calls.filter(c=>c.method==='session.resume')).toHaveLength(1);
  });
  it('prepares again on a deliberate new Send after a backend restart', async () => {
    const {store,gateway,engine,taskId}=fixture(); const original={id:randomUUID(),taskId,kind:'send' as const,text:'Original message'};
    engine.start(original); await expect.poll(()=>store.action(original.id)?.receipt).toBe('accepted');
    gateway.epoch='epoch-b'; await engine.reconnect(); expect(gateway.calls.filter(c=>c.method==='session.resume')).toHaveLength(0);
    const next={...original,id:randomUUID(),text:'Change direction.'}; engine.start(next); await expect.poll(()=>store.action(next.id)?.receipt).toBe('accepted');
    expect(gateway.calls.filter(c=>c.method==='session.resume')).toHaveLength(1);
    expect(gateway.calls.filter(c=>c.method==='prompt.submit').map(c=>c.params.text)).toEqual(['Original message','Change direction.']);
  });
  it.each(['queued','redirected','steered'])('uses native %s handling when resuming starts work', async status => {
    const {store,gateway,engine,taskId}=fixture(); store.linkNew(taskId,{key:'stored',storedId:'stored',title:'Interrupted',source:'desktop'});
    gateway.resumeBusy=true; gateway.submitStatus=status;
    gateway.replayEvents=[{type:'message.complete',session_id:'runtime',seq:1,payload:{status:'complete'}}];
    const input={id:randomUUID(),taskId,kind:'send' as const,text:'Change direction.'}; engine.start(input);
    await expect.poll(()=>store.action(input.id)?.receipt).toBe('accepted');
    expect(store.action(input.id)?.state).toBe('running'); expect(store.action(input.id)?.terminal).toBeUndefined();
    if(status==='queued') {
      gateway.emitEvent('message.complete',{status:'interrupted'}); gateway.running=false; gateway.queued=false;
      await engine.reconcile(taskId); expect(store.action(input.id)?.state).toBe('running'); expect(store.action(input.id)?.terminal).toBeUndefined();
      gateway.running=true; gateway.emitEvent('message.start');
    }
    gateway.running=false; gateway.emitEvent('message.complete',{status:'complete'}); await engine.reconcile(taskId);
    await expect.poll(()=>store.action(input.id)?.state).toBe('finished');
    expect(gateway.calls.filter(c=>c.method==='prompt.submit')).toHaveLength(1);
  });
  it('keeps failed preparation distinct from an unconfirmed prompt and never retries either on reconnect', async () => {
    const {store,gateway,engine,taskId}=fixture(); store.linkNew(taskId,{key:'stored',storedId:'stored',title:'Existing',source:'desktop'});
    gateway.failResume=true; const input={id:randomUUID(),taskId,kind:'send' as const,text:'Preserve this.'}; engine.start(input);
    await expect.poll(()=>store.action(input.id)?.receipt).toBe('unknown');
    expect(store.action(input.id)?.sendStage).toBe('preparing'); expect(store.action(input.id)?.error).toContain('not sent');
    engine.start(input); await engine.reconnect(); expect(gateway.calls.filter(c=>c.method==='session.resume')).toHaveLength(1); expect(gateway.calls.filter(c=>c.method==='prompt.submit')).toHaveLength(0);
    gateway.failResume=false; gateway.failSubmit=true; const second={...input,id:randomUUID()}; engine.start(second);
    await expect.poll(()=>store.action(second.id)?.receipt).toBe('unknown'); expect(store.action(second.id)?.sendStage).toBe('submitting');
    engine.start(second); await engine.reconnect(); expect(gateway.calls.filter(c=>c.method==='prompt.submit')).toHaveLength(1);
    expect(()=>engine.start({...second,id:randomUUID()})).toThrow('uncertain');
    gateway.failSubmit=false; const third={...input,id:randomUUID(),text:'Please report current progress.'}; engine.start(third);
    await expect.poll(()=>store.action(third.id)?.receipt).toBe('accepted'); expect(store.action(second.id)?.receipt).toBe('unknown');
  });
  it('does not strand new sends when old event replay was truncated', async () => {
    const {store,gateway,engine,taskId}=fixture(); store.linkNew(taskId,{key:'stored',storedId:'stored',title:'Older',source:'desktop'});
    gateway.truncated=true; gateway.seq=500;
    const input={id:randomUUID(),taskId,kind:'send' as const,text:'New question'}; engine.start(input);
    await expect.poll(()=>store.action(input.id)?.receipt).toBe('accepted'); expect(store.binding(taskId)?.seq).toBe(501);
  });
  it('a stop during preparation prevents a later prompt from being submitted', async () => {
    const {store,gateway,engine,taskId}=fixture(); store.linkNew(taskId,{key:'stored',storedId:'stored',title:'Existing',source:'desktop'});
    const rpc=gateway.rpc.bind(gateway); let release!:()=>void; const gate=new Promise<void>(resolve=>release=resolve); let held=false;
    gateway.rpc=async (method,params)=>{if(method==='session.control.read'&&!held){held=true;await gate;}return rpc(method,params);};
    const input={id:randomUUID(),taskId,kind:'send' as const,text:'Do not send after stopping.'}; engine.start(input);
    await expect.poll(()=>held).toBe(true);
    const stop={id:randomUUID(),taskId,kind:'stop' as const,targetId:input.id,generation:store.binding(taskId)!.generation};
    engine.start(stop); await expect.poll(()=>store.action(stop.id)?.receipt).toBe('accepted'); release();
    await expect.poll(()=>store.action(input.id)?.receipt).toBe('rejected'); await expect.poll(()=>store.action(stop.id)?.state).toBe('finished');
    expect(gateway.calls.filter(c=>c.method==='prompt.submit')).toHaveLength(0); expect(store.action(input.id)?.text).toBe(input.text);
  });
  it('submits despite ongoing recovery events and retains explicit approval/denial controls', async () => {
    const {store,gateway,engine,taskId}=fixture(); store.linkNew(taskId,{key:'stored',storedId:'stored',title:'Interrupted',source:'desktop'});
    gateway.resumeBusy=true; gateway.submitStatus='queued'; gateway.approvals=[{request_id:'recovered-approval',command:'echo pending'}];
    const rpc=gateway.rpc.bind(gateway);
    gateway.rpc=async(method,params)=>{const result=await rpc(method,params);if(['session.activate','approval.pending','session.control.read'].includes(method))gateway.emitEvent('message.delta',{text:'Progress. '});return result;};
    const input={id:randomUUID(),taskId,kind:'send' as const,text:'Use this updated instruction.'}; engine.start(input);
    await expect.poll(()=>store.action(input.id)?.receipt).toBe('accepted'); gateway.rpc=rpc;
    await engine.reconcile(taskId); await expect.poll(()=>store.action(input.id)?.state).toBe('awaiting_input');
    expect(gateway.calls.filter(c=>c.method==='approval.respond')).toHaveLength(0);
    const deny={id:randomUUID(),taskId,kind:'deny' as const,targetId:input.id,generation:store.binding(taskId)!.generation,approvalId:'recovered-approval'}; engine.start(deny);
    await expect.poll(()=>store.action(deny.id)?.receipt).toBe('accepted');
    expect(gateway.calls.find(c=>c.method==='approval.respond')?.params.choice).toBe('deny');
  });
  it('recovers a reaped idle runtime on the same Send',async()=>{
    const {store,gateway,engine,taskId}=fixture(); const first={id:randomUUID(),taskId,kind:'send' as const,text:'First request'};engine.start(first);
    await expect.poll(()=>store.action(first.id)?.receipt).toBe('accepted');gateway.running=false;gateway.emitEvent('message.complete',{status:'complete'});await engine.reconcile(taskId);
    const rpc=gateway.rpc.bind(gateway);let reaped=true;
    gateway.rpc=async(method,params)=>{if(method==='session.activate'&&reaped){reaped=false;throw new GatewayError('Session not found',false,4001);}return rpc(method,params);};
    const next={...first,id:randomUUID(),text:'Next request'};engine.start(next);await expect.poll(()=>store.action(next.id)?.receipt).toBe('accepted');
    expect(gateway.calls.filter(c=>c.method==='session.resume')).toHaveLength(1);expect(gateway.calls.filter(c=>c.method==='prompt.submit')).toHaveLength(2);
  });
  it.each(['streaming','queued'])('reports a %s failure even if no new turn started',async status=>{
    const {store,gateway,engine,taskId}=fixture();store.linkNew(taskId,{key:'stored',storedId:'stored',title:'Existing',source:'desktop'});
    gateway.resumeBusy=status==='queued';gateway.submitStatus=status;
    const emitEvent=gateway.emitEvent.bind(gateway);gateway.emitEvent=(type,payload)=>type==='message.start'?{type,session_id:'runtime',seq:gateway.seq,payload}:emitEvent(type,payload);
    const input={id:randomUUID(),taskId,kind:'send' as const,text:'Saved if the backend fails.'};engine.start(input);
    await expect.poll(()=>store.action(input.id)?.receipt).toBe('accepted');gateway.running=false;gateway.queued=false;
    if(status==='streaming')gateway.emitEvent('message.complete',{status:'error',text:'Agent build failed.'});
    else gateway.emitEvent('error',{message:'Queued prompt failed.'});
    await engine.reconcile(taskId);await expect.poll(()=>store.action(input.id)?.state).toBe('failed');
    expect(store.action(input.id)?.text).toBe(input.text);expect(gateway.calls.filter(c=>c.method==='prompt.submit')).toHaveLength(1);
  });
});
