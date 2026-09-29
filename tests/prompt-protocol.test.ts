import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { Gateway } from '../server/gateway';
import { PromptRequests } from '../server/promptRequests';
import { Store } from '../server/store';
import { Actions } from '../server/actions';

const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const approval = (id = 'srq-approval', session = 'runtime', choices = ['once', 'deny']) => ({ id, method: 'approval', params: { session_id: session, request_id: 'queue-' + id, description: 'Allow the fixture command?', command: 'echo fixture', choices } });
async function fixture(mode = 'modern') {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>(resolve => server.once('listening', resolve));
  cleanup.push(() => new Promise<void>(resolve => { for (const s of server.clients) s.terminate(); server.close(() => resolve()); }));
  const state = { socket: undefined as WebSocket | undefined, mode, contract: 8, declinesNotShown: false, previewOwner: false, pending: [] as any[], calls: [] as any[], seq: 0, answer: 'ok', answers: [] as any[], snapshots: [] as (() => void)[], holdSnapshot: false };
  const emit = (type: string, payload: any, session = 'runtime') => state.socket!.send(JSON.stringify({ method: 'event', params: { type, payload, session_id: session, seq: ++state.seq } }));
  server.on('connection', socket => {
    state.socket = socket;
    socket.send(JSON.stringify({ method: 'event', params: { type: 'gateway.ready', payload: { replay_epoch: 'epoch' } } }));
    socket.on('message', raw => {
      const frame = JSON.parse(raw.toString()); state.calls.push(frame);
      if (!frame.method) {
        if (!(frame.error?.code === 4404 && state.previewOwner)) state.pending = state.pending.filter(p => p.id !== frame.id);
        return;
      }
      const { id, method, params } = frame;
      const ok = (result: any) => socket.send(JSON.stringify({ id, result }));
      const error = (code: number) => socket.send(JSON.stringify({ id, error: { code, message: 'Fixture refusal' } }));
      if (method === 'client.capabilities') {
        if (state.mode === 'legacy') error(-32601);
        else if (state.mode === 'broken') error(5001);
        else ok(state.mode === 'malformed' ? {} : { server_requests: ['approval', 'clarify', 'sudo', 'preview.read'], ...(state.declinesNotShown ? { declines_not_shown: true } : {}) });
      } else if (method === 'session.activate') {
        const result = { session_id: 'runtime', session_key: 'stored', info: { profile_name: 'default', desktop_contract: state.contract }, running: true, ...(state.pending.length ? { open_requests: structuredClone(state.pending) } : {}) };
        if (state.holdSnapshot) state.snapshots.push(() => ok(result)); else ok(result);
      } else if (method === 'approval.pending') ok({ approvals: state.pending.filter(p => p.method === 'approval').map(p => p.params) });
      else if (method === 'session.control.read') ok({ control: {} });
      else if (method === 'session.events.since') ok({ epoch: 'epoch', latest_seq: state.seq, events: [], open_requests: state.pending });
      else if (method === 'request.answer') {
        if (state.answer === 'unsupported') { error(-32601); return; }
        const found = state.pending.find(p => p.id === params.id);
        if (state.answer === 'expired' || !found) { state.pending = state.pending.filter(p => p.id !== params.id); ok({ status: 'expired' }); return; }
        state.answers.push(params); state.pending = state.pending.filter(p => p.id !== params.id);
        if (state.answer === 'lost') { socket.terminate(); return; }
        ok({ status: 'ok' });
      } else if (method === 'approval.respond') { state.answers.push(params); state.pending = []; ok({ resolved: 1 }); }
      else if (method === 'gateway.ping') ok({ pong: true });
      else ok({});
    });
  });
  const gateway = new Gateway(`http://127.0.0.1:${(server.address() as any).port}`, 'fixture-token');
  cleanup.push(() => gateway.close());
  const receive = (value: any) => { state.pending.push(value); state.socket!.send(JSON.stringify({ jsonrpc: '2.0', ...value })); };
  return { gateway, state, receive, emit };
}
async function tracked() {
  const f = await fixture(); await f.gateway.connect();
  const store = new Store(':memory:'), id = randomUUID(), run = randomUUID();
  store.saveContext({ id, title: 'Fixture', aliases: ['stored'], link: { key: 'stored', storedId: 'stored', title: 'Fixture', source: 'desktop' } });
  store.saveBinding(id, { runtimeId: 'runtime', storedId: 'stored', epoch: 'epoch', generation: 'generation', seq: 0, ready: false, monitored: true, known: true });
  store.saveAction({ id: run, taskId: id, kind: 'send', text: 'Fixture', uploadIds: [], createdAt: 1, updatedAt: 1, state: 'running', phase: 'working', receipt: 'accepted', sendStage: 'submitted' });
  const actions = new Actions(store, f.gateway, '/tmp');
  cleanup.push(async () => { actions.close(); const socket = f.gateway.socket; f.gateway.close(); if (socket && socket.readyState !== 3) await new Promise<void>(resolve => socket.once('close', () => resolve())); store.close(); });
  const respond = (kind: 'approve' | 'deny' | 'clarify', approvalId = 'srq-approval', rest = {}) => { const input = { id: randomUUID(), taskId: id, kind, approvalId, targetId: run, generation: 'generation', ...rest }; actions.start(input); return input.id; };
  return { ...f, store, actions, id, run, respond };
}

describe('Hermes prompt protocol negotiation and transport', () => {
  it('advertises handling before allowing other RPCs and only falls back for method-not-found', async () => {
    for (const mode of ['modern', 'legacy']) {
      const { gateway, state } = await fixture(mode); await gateway.rpc('gateway.ping', {});
      expect(state.calls[0]).toMatchObject({ method: 'client.capabilities', params: { server_requests: true } });
      expect(gateway.promptProtocol).toBe(mode === 'modern' ? 'requests' : 'legacy');
    }
    for (const mode of ['broken', 'malformed']) {
      const { gateway } = await fixture(mode);
      await expect(gateway.connect()).rejects.toThrow('prompt compatibility'); expect(gateway.online).toBe(false); gateway.close();
    }
  });
  it('deduplicates replay, restores pending requests after reconnect, and removes cancellations', async () => {
    const { gateway, state, receive, emit } = await fixture(); await gateway.connect();
    receive(approval()); await expect.poll(() => gateway.prompts.list('runtime').length).toBe(1);
    state.socket!.send(JSON.stringify(approval())); await gateway.rpc('gateway.ping', {});
    expect(gateway.prompts.list('runtime')).toHaveLength(1);
    state.socket!.terminate(); await expect.poll(() => gateway.online).toBe(false);
    await gateway.connect(); await gateway.rpc('session.activate', { session_id: 'runtime' });
    expect(gateway.prompts.list('runtime')).toHaveLength(1);
    expect(state.calls.filter(c => c.method === 'client.capabilities')).toHaveLength(2);
    emit('request.cancel', { id: 'srq-approval', reason: 'timeout' });
    await expect.poll(() => gateway.prompts.list('runtime')).toEqual([]);
    await gateway.rpc('session.activate', { session_id: 'runtime' }); // deliberately stale fixture snapshot
    expect(gateway.prompts.list('runtime')).toEqual([]);
    expect(state.answers).toEqual([]);
  });
  it('does not let a late snapshot erase a new request or resurrect a cancellation', async () => {
    const { gateway, state, receive, emit } = await fixture(); await gateway.connect(); state.holdSnapshot = true;
    const read = gateway.rpc('session.activate', { session_id: 'runtime' });
    await expect.poll(() => state.snapshots.length).toBe(1); receive(approval());
    await expect.poll(() => gateway.prompts.list('runtime').length).toBe(1); state.snapshots.shift()!(); await read;
    expect(gateway.prompts.list('runtime')).toHaveLength(1);
    const stale = gateway.rpc('session.activate', { session_id: 'runtime' }); await expect.poll(() => state.snapshots.length).toBe(1);
    emit('request.cancel', { id: 'srq-approval' }); await expect.poll(() => gateway.prompts.list('runtime')).toEqual([]);
    state.snapshots.shift()!(); await stale; expect(gateway.prompts.list('runtime')).toEqual([]);
  });
  it('explicitly rejects unsupported and malformed prompts without saving secret parameters', async () => {
    const { gateway, state, receive } = await fixture(); await gateway.connect();
    receive({ id: 'srq-secret', method: 'secret', params: { session_id: 'runtime', prompt: 'Fixture private text' } });
    await expect.poll(() => state.calls.some(c => c.id === 'srq-secret' && c.error?.code === -32601)).toBe(true);
    expect(gateway.prompts.warning('runtime')).toContain('cannot display'); expect(gateway.prompts.warning('runtime')).not.toContain('Fixture private');
    receive({ id: 'srq-bad', method: 'approval', params: { session_id: 'runtime' } });
    await expect.poll(() => state.calls.some(c => c.id === 'srq-bad' && c.error?.code === -32602)).toBe(true);
    expect(gateway.prompts.list('runtime')).toEqual([]); expect(state.answers).toEqual([]);
  });
  it('returns an unavailable tool result for preview reads without creating an approval warning or losing other prompts', async () => {
    const { gateway, state, receive } = await fixture(); await gateway.connect();
    receive(approval());
    const request = { id: 'srq-preview', method: 'preview.read', params: { session_id: 'runtime', start: 0, count: 1000 } };
    receive(request);
    await expect.poll(() => state.calls.filter(c => c.id === request.id).length).toBe(1);
    const response = state.calls.find(c => c.id === request.id);
    expect(response.error).toBeUndefined();
    expect(JSON.parse(response.result.value)).toMatchObject({ success: false, error: expect.stringContaining('Herts does not support reading the Hermes Desktop browser preview') });
    expect(gateway.prompts.warning('runtime')).toBeUndefined();
    expect(gateway.prompts.list('runtime')).toEqual([approval()]);
    state.socket!.send(JSON.stringify(request)); await gateway.rpc('gateway.ping', {});
    expect(state.calls.filter(c => c.id === request.id)).toHaveLength(1);
    receive({ id: 'srq-sudo', method: 'sudo', params: { session_id: 'runtime' } });
    await expect.poll(() => gateway.prompts.warning('runtime')).toContain('sudo');
    receive({ ...request, id: 'srq-preview-again' });
    await expect.poll(() => state.calls.some(c => c.id === 'srq-preview-again')).toBe(true);
    expect(gateway.prompts.warning('runtime')).toContain('sudo');
    expect(state.answers).toEqual([]);
    expect(state.calls.some(c => ['request.answer', 'approval.respond', 'prompt.submit', 'session.resume'].includes(c.method))).toBe(false);
  });
  it('declines preview reads for newer backends without taking an attached Desktop window’s answer', async () => {
    const { gateway, state, receive } = await fixture(); state.declinesNotShown = true; state.previewOwner = true; await gateway.connect();
    const request = { id: 'srq-preview', method: 'preview.read', params: { session_id: 'runtime' } };
    receive(request);
    await expect.poll(() => state.calls.some(c => c.id === request.id)).toBe(true);
    expect(state.calls.find(c => c.id === request.id)).toMatchObject({ error: { code: 4404, message: expect.stringContaining('Herts does not support reading') } });
    expect(state.pending).toEqual([request]);
    await gateway.rpc('session.activate', { session_id: 'runtime' });
    expect(gateway.prompts.list('runtime')).toEqual([]); expect(gateway.prompts.warning('runtime')).toBeUndefined();
    expect(state.calls.filter(c => c.id === request.id)).toHaveLength(1);
    // Capabilities belong to this connection; do not keep a newer backend's flag after switching back.
    state.socket!.terminate(); await expect.poll(() => gateway.online).toBe(false);
    state.declinesNotShown = false; await gateway.connect(); await gateway.rpc('session.activate', { session_id: 'runtime' });
    await expect.poll(() => state.calls.filter(c => c.id === request.id).length).toBe(2);
    expect(JSON.parse(state.calls.filter(c => c.id === request.id)[1].result.value).success).toBe(false);
    expect(state.answers).toEqual([]);
  });
  it('does not treat malformed or foreign-session preview requests as valid pane reads', () => {
    const errors: any[] = [], declined: string[] = [], cache = new PromptRequests(() => {}, (...args) => errors.push(args), id => declined.push(id));
    cache.receive({ id: 'bad', method: 'preview.read', params: { session_id: 'runtime', count: 'invalid' } });
    cache.restore('runtime', [{ id: 'foreign', method: 'preview.read', params: { session_id: 'other' } }], cache.version);
    expect(declined).toEqual([]); expect(errors).toHaveLength(2);
  });
  it('ignores cross-session cancellation and rejects cross-session snapshot entries', () => {
    const errors: any[] = [], cache = new PromptRequests(() => {}, (...args) => errors.push(args));
    cache.receive(approval()); cache.close('srq-approval', 'other'); expect(cache.list('runtime')).toHaveLength(1);
    cache.restore('runtime', [approval('foreign', 'other')], cache.version);
    expect(cache.list('other')).toEqual([]); expect(errors).toHaveLength(1);
  });
  it('withdraws a reused approval ID with changed content instead of reusing consent', () => {
    const errors: any[] = [], cache = new PromptRequests(() => {}, (...args) => errors.push(args));
    cache.receive(approval()); cache.receive({ ...approval(), params: { ...approval().params, command: 'different fixture command' } });
    expect(cache.list('runtime')).toEqual([]); expect(errors).toHaveLength(1); expect(cache.warning('runtime')).toContain('changed');
  });
  it('warns about a newer contract and rejects modern sessions under a legacy handshake', async () => {
    const { gateway, state } = await fixture(); await gateway.connect(); state.contract = 9;
    await gateway.rpc('session.activate', { session_id: 'runtime' }); expect(gateway.promptWarning).toContain('newer Desktop interface');
    const legacy = await fixture('legacy'); await legacy.gateway.connect();
    await expect(legacy.gateway.rpc('session.activate', { session_id: 'runtime' })).rejects.toThrow('newer prompt protocol');
  });
});

describe('durable decisions through the current prompt protocol', () => {
  it.each(['approve', 'deny'] as const)('shows and deliberately answers %s exactly once', async kind => {
    const { store, state, receive, respond, run, actions, id } = await tracked(); receive(approval());
    await expect.poll(() => store.action(run)?.state).toBe('awaiting_input');
    expect(store.action(run)?.approvals?.[0].command).toBe('echo fixture'); expect(state.answers).toEqual([]);
    const decision = respond(kind); await expect.poll(() => store.action(decision)?.receipt).toBe('accepted');
    expect(state.answers).toEqual([{ id: 'srq-approval', result: { choice: kind === 'approve' ? 'once' : 'deny' } }]);
    expect(() => actions.start({ id: randomUUID(), taskId: id, kind, approvalId: 'srq-approval', targetId: run, generation: 'generation' })).toThrow('already submitted');
  });
  it('rejects a stale or disallowed choice without responding', async () => {
    const { state, store, receive, respond, run } = await tracked(); receive(approval('srq-approval', 'runtime', ['deny']));
    await expect.poll(() => store.action(run)?.state).toBe('awaiting_input');
    const invalid = respond('approve'); await expect.poll(() => store.action(invalid)?.receipt).toBe('rejected'); expect(state.answers).toEqual([]);
    const stale = respond('approve', 'srq-missing'); await expect.poll(() => store.action(stale)?.receipt).toBe('rejected'); expect(state.answers).toEqual([]);
  });
  it('keeps a lost acknowledgement uncertain and never repeats it after reconnect', async () => {
    const { gateway, state, store, receive, respond, run } = await tracked(); receive(approval());
    await expect.poll(() => store.action(run)?.state).toBe('awaiting_input'); state.answer = 'lost';
    const decision = respond('approve'); await expect.poll(() => store.action(decision)?.receipt).toBe('unknown');
    await gateway.connect(); await gateway.rpc('gateway.ping', {});
    expect(state.answers).toHaveLength(1); expect(store.action(decision)?.receipt).toBe('unknown');
  });
  it('does not report expired responses as accepted', async () => {
    const { state, store, receive, respond, run } = await tracked(); receive(approval());
    await expect.poll(() => store.action(run)?.state).toBe('awaiting_input'); state.answer = 'expired';
    const decision = respond('deny'); await expect.poll(() => store.action(decision)?.receipt).toBe('rejected'); expect(state.answers).toEqual([]);
  });
  it('answers single and batch clarification, preserving answers already locked elsewhere', async () => {
    const { state, store, receive, respond, run } = await tracked();
    receive({ id: 'srq-one', method: 'clarify', params: { session_id: 'runtime', question: 'Which one?', choices: ['One', 'Two'] } });
    await expect.poll(() => store.action(run)?.clarification?.request_id).toBe('srq-one');
    const first = respond('clarify', 'srq-one', { text: 'Two' }); await expect.poll(() => store.action(first)?.receipt).toBe('accepted');
    receive({ id: 'srq-batch', method: 'clarify', params: { session_id: 'runtime', questions: [{ qid: 'a', question: 'First?' }, { qid: 'b', question: 'Second?' }], answers: { a: 'Already confirmed' } } });
    await expect.poll(() => store.action(run)?.clarification?.request_id).toBe('srq-batch');
    const second = respond('clarify', 'srq-batch', { answers: { a: 'Do not overwrite', b: 'New answer' } }); await expect.poll(() => store.action(second)?.receipt).toBe('accepted');
    expect(state.answers).toEqual([{ id: 'srq-one', result: { answer: 'Two' } }, { id: 'srq-batch', result: { answers: { a: 'Already confirmed', b: 'New answer' } } }]);
  });
  it('uses the acknowledged approval queue on earlier request backends without request.answer', async () => {
    const { state, store, receive, respond, run } = await tracked(); receive(approval());
    await expect.poll(() => store.action(run)?.state).toBe('awaiting_input'); state.answer = 'unsupported';
    const decision = respond('approve'); await expect.poll(() => store.action(decision)?.receipt).toBe('accepted');
    expect(state.answers).toEqual([{ session_id: 'runtime', request_id: 'queue-srq-approval', choice: 'once', all: false }]);
  });
  it('labels an earlier backend’s unacknowledged clarification response uncertain', async () => {
    const { state, store, receive, respond, run } = await tracked();
    receive({ id: 'srq-old-clarify', method: 'clarify', params: { session_id: 'runtime', question: 'Which one?' } });
    await expect.poll(() => store.action(run)?.clarification?.request_id).toBe('srq-old-clarify'); state.answer = 'unsupported';
    const decision = respond('clarify', 'srq-old-clarify', { text: 'One' });
    await expect.poll(() => store.action(decision)?.receipt).toBe('unknown');
    expect(store.action(decision)?.text).toBe('One');
    await expect.poll(() => state.calls.filter(c => c.id === 'srq-old-clarify')).toHaveLength(1);
    expect(state.calls.find(c => c.id === 'srq-old-clarify')).toMatchObject({ result: { answer: 'One' } });
    expect(() => respond('clarify', 'srq-old-clarify', { text: 'One' })).toThrow('already submitted');
  });
});
