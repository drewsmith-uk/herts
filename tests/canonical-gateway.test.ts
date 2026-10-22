import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanonicalGateway } from '../server/canonicalGateway';
import { Gateway, GatewayError } from '../server/gateway';
import { Actions } from '../server/actions';
import { Store } from '../server/store';
import { conversationRef } from '../shared/conversations';

const cleanup: (() => void)[] = [];
afterEach(() => { for (const close of cleanup.splice(0)) close(); });
const identity = (profile = 'default') => ({ profile_id: `/fixture/${profile}`, capabilities: ['durable-admission-v1', 'event-replay-v1'] });
const snapshot = (profile = 'default', changes: any = {}) => ({ session_id: 'stored', stored_session_id: 'stored',
  running: false, authority_epoch: 1, revision: 3, execution_generation: 2, replay_epoch: `replay-${profile}`, last_sequence: 4,
  subscription_id: 'subscription', pending: [], prompts: [], messages: [], message_count: 0, info: { profile_name: profile }, ...changes });
const receipt = (changes: any = {}) => ({ admission_id: 'admission', ref: { profile_id: '/fixture/default', session_id: 'stored' },
  sequence: 1, status: 'queued', outcome: null, authority_epoch: 1, execution_generation: null, ...changes });
function fixture() {
  const store = new Store(':memory:'), emit = vi.fn(), restore = vi.fn(); cleanup.push(() => store.close());
  const adapter = new CanonicalGateway((id, profile) => conversationRef(profile, id), emit, restore, store);
  adapter.identify('default', identity());
  const request = vi.fn(async (method: string, params: any): Promise<any> => {
    if (method === 'runtime.describe') return identity(params.profile);
    if (['session.create', 'session.resume'].includes(method)) return snapshot(params.profile);
    if (method === 'prompt.submit') return receipt();
    if (method === 'session.mutate') return { session_id: 'stored', revision: 4, title: params.payload.title };
    throw new Error(`Unexpected ${method}`);
  });
  const call = (method: string, params: any = {}, intent?: string) => adapter.call(method, { profile: 'default', ...params }, request, 0, 'instance', intent);
  return { adapter, store, emit, restore, request, call };
}

describe('canonical gateway protocol', () => {
  it('retains creation and submission identities across adapter restarts', async () => {
    const f = fixture();
    const params = { source: 'desktop', close_on_disconnect: false, reasoning_effort: 'high', fast: true };
    await f.call('session.create', params, 'creation');
    const first = f.request.mock.calls[0][1];
    expect(first).toMatchObject({ request_id: expect.any(String), source: 'gui', reasoning: 'high', service_tier: 'priority' });
    expect(first).not.toHaveProperty('close_on_disconnect');
    f.adapter.reset();
    await f.call('session.create', params, 'creation');
    expect(f.request.mock.calls.at(-1)?.[1]).toEqual(first);
    const sent = await f.call('prompt.submit', { session_id: 'stored', text: 'Synthetic text' }, 'submission');
    expect(sent).toMatchObject({ submission_id: 'submission', admission_id: 'admission' });
    expect(f.request.mock.calls.at(-1)?.[1]).toMatchObject({ submission_id: 'submission' });
    const retained = f.store.db.prepare("SELECT value FROM meta WHERE key LIKE 'gateway-operation:%'").all();
    expect(JSON.stringify(retained)).not.toContain('Synthetic text');
    await expect(f.call('prompt.submit', { session_id: 'stored', text: 'Changed text' }, 'submission')).rejects.toThrow('different content');
    f.request.mockRejectedValueOnce(new GatewayError('Lost receipt', true));
    await expect(f.call('prompt.submit', { session_id: 'stored', text: 'Another text' }, 'lost')).rejects.toThrow('Lost receipt');
    expect(f.request.mock.calls.filter(([m]) => m === 'prompt.submit')).toHaveLength(2);
  });
  it('fences mutations with the observed revision and refuses unconfirmed responses', async () => {
    const f = fixture(); await f.call('session.resume', { session_id: 'stored' });
    await f.call('session.title', { session_id: 'stored', title: 'New title' }, 'edit');
    expect(f.request.mock.calls.at(-1)).toEqual(['session.mutate', expect.objectContaining({ expected_revision: 3, operation: 'rename', payload: { title: 'New title' } })]);
    expect(f.request.mock.calls.at(-1)?.[1]).not.toHaveProperty('expected_generation');
    f.request.mockResolvedValueOnce({ session_id: 'stored', revision: 5, cwd: '/fixture' });
    await f.call('session.cwd.set', { session_id: 'stored', cwd: '/fixture' });
    expect(f.request.mock.calls.at(-1)?.[1]).toMatchObject({ expected_revision: 4, expected_generation: 2, operation: 'workspace' });
    f.request.mockResolvedValueOnce({ session_id: 'foreign', revision: 6 });
    await expect(f.call('session.title', { session_id: 'stored', title: 'Other' })).rejects.toMatchObject({ uncertain: true });
  });
  it('rejects receipts for another session or profile', async () => {
    const f = fixture(); await f.call('session.resume', { session_id: 'stored' });
    for (const ref of [{ profile_id: '/fixture/foreign', session_id: 'stored' }, { profile_id: '/fixture/default', session_id: 'other' }]) {
      f.request.mockResolvedValueOnce(receipt({ ref }));
      await expect(f.call('prompt.submit', { session_id: 'stored', text: 'Synthetic' })).rejects.toMatchObject({ uncertain: true });
    }
  });
  it('retains model confirmation tokens and uses the generation returned by a settings change', async () => {
    const f = fixture(); await f.call('session.resume', { session_id: 'stored' });
    const params = { session_id: 'stored', key: 'model', value: 'synthetic-model --provider custom --session' };
    f.request.mockResolvedValueOnce({ session_id: 'stored', status: 'confirmation_required', confirm: 'synthetic-confirmation' });
    expect(await f.call('config.set', params)).toMatchObject({ confirm_required: true });
    f.request.mockResolvedValueOnce({ session_id: 'stored', revision: 4, execution_generation: 3, model: 'synthetic-model' });
    expect(await f.call('config.set', { ...params, confirm_expensive_model: true })).toMatchObject({ value: 'synthetic-model' });
    expect(f.request.mock.calls.at(-1)?.[1].payload.confirm).toBe('synthetic-confirmation');
    f.request.mockResolvedValueOnce({ session_id: 'stored', revision: 5, execution_generation: 4, effort: 'high' });
    await f.call('config.set', { session_id: 'stored', key: 'reasoning', scope: 'session', value: 'high' });
    expect(f.request.mock.calls.at(-1)?.[1]).toMatchObject({ expected_generation: 3, expected_revision: 4 });
    expect(f.adapter.state('stored')?.remote.executionGeneration).toBe(4);
  });
  it('rejects a snapshot from a different authority lifetime', async () => {
    const f = fixture(); f.adapter.identify('default', { ...identity(), authority_epoch: 2 });
    await expect(f.call('session.resume', { session_id: 'stored' })).rejects.toThrow('authority changed');
    expect(f.restore).not.toHaveBeenCalled();
  });
  it('rejects snapshots with inconsistent stored and running identities', async () => {
    const f = fixture(); f.request.mockResolvedValueOnce(snapshot('default', { stored_session_id: 'foreign' }));
    await expect(f.call('session.resume', { session_id: 'stored' })).rejects.toThrow('invalid session snapshot');
    expect(f.restore).not.toHaveBeenCalled();
  });
  it('routes events by profile and replay epoch, ignoring obsolete generations and duplicate events', async () => {
    const f = fixture(); await f.call('session.resume', { session_id: 'stored' });
    const event = { session_id: 'stored', seq: 5, replay_epoch: 'replay-work', execution_generation: 2, authority_epoch: 1, type: 'message.delta', payload: { text: 'work' } };
    f.adapter.event(event); expect(f.emit).not.toHaveBeenCalled();
    await f.call('session.resume', { session_id: 'stored', profile: 'work' });
    expect(f.emit).toHaveBeenCalledWith(expect.objectContaining({ session_id: 'herts-profile:work:stored' }));
    f.adapter.event(event); f.adapter.event({ ...event, seq: 6, execution_generation: 1 });
    expect(f.emit).toHaveBeenCalledTimes(1);
    f.adapter.event({ ...event, seq: 6, replay_epoch: 'replay-default' });
    expect(f.emit.mock.calls.at(-1)?.[0].session_id).toBe('stored');
  });
  it('restores a snapshot after a replay gap without submitting any work', async () => {
    const f = fixture(); await f.call('session.resume', { session_id: 'stored' });
    f.request.mockResolvedValueOnce({ events: [], replay_epoch: 'replay-default', last_sequence: 20, snapshot_required: true });
    f.request.mockResolvedValueOnce(snapshot('default', { last_sequence: 20 }));
    const result = await f.call('session.events.since', { session_id: 'stored', last_seen: 4 });
    expect(result).toMatchObject({ snapshot_required: true, remote: { sequence: 20 } });
    expect(f.request.mock.calls.map(([method]) => method)).toEqual(['session.resume', 'session.events.since', 'session.resume']);
  });
  it('answers canonical prompts with their execution generation and confirmed acknowledgement', async () => {
    const f = fixture();
    f.request.mockResolvedValueOnce(snapshot('default', { prompts: [{ kind: 'approval', prompt_id: 'approval', execution_generation: 2, choices: ['once', 'deny'], command: null, description: 'Synthetic command' }] }));
    await f.call('session.resume', { session_id: 'stored' });
    const prompt = f.restore.mock.calls.at(-1)?.[1][0];
    f.request.mockResolvedValueOnce({ prompt_id: 'approval', status: 'resolved' });
    await f.adapter.answer('stored', prompt.id, { choice: 'once' }, f.request);
    expect(f.request.mock.calls.at(-1)).toEqual(['approval.respond', { session_id: 'stored', profile: 'default', prompt_id: 'approval', execution_generation: 2, choice: 'once' }]);
    await expect(f.adapter.answer('stored', prompt.id, { choice: 'once' }, f.request)).rejects.toThrow('stale');
  });
});

describe('canonical action recovery', () => {
  function actionFixture() {
    const f = fixture(), gateway = new Gateway('', '');
    gateway.protocol = 'hermes-gateway-v1'; gateway.online = true; gateway.epoch = 'instance:1';
    Object.defineProperty(gateway, 'canonical', { value: f.adapter });
    gateway.rpc = async (method, params, _timeout, intent) => f.call(method, params, intent);
    const context = f.store.ensureContext({ key: 'stored', storedId: 'stored', source: 'gui', title: 'Fixture' });
    const engine = new Actions(f.store, gateway, '/tmp'); cleanup.push(() => { engine.close(); gateway.close(); });
    return { ...f, gateway, engine, context };
  }
  it('recovers a lost acknowledgement by submission identity, then reads its terminal receipt', async () => {
    const f = actionFixture();
    const live = await f.call('session.resume', { session_id: 'stored' });
    f.store.saveBinding(f.context.id, { runtimeId: 'stored', storedId: 'stored', epoch: f.gateway.epoch, generation: 'binding', seq: 4, ready: false, monitored: true, known: true, remote: live.remote });
    f.store.saveAction({ id: 'action', taskId: f.context.id, kind: 'send', text: 'Saved text', uploadIds: [], createdAt: 1, updatedAt: 1, state: 'unknown', phase: 'unknown', receipt: 'unknown', sendStage: 'submitting', submissionId: 'submission' });
    f.request.mockResolvedValueOnce(snapshot('default', { pending: [receipt({ input_id: 'foreign', text: 'Saved text' })] }));
    await f.engine.reconcile(f.context.id);
    expect(f.store.action('action')?.receipt).toBe('unknown');
    f.request.mockResolvedValueOnce(snapshot('default', { pending: [receipt({ input_id: 'submission', text: 'Saved text' })] }));
    await f.engine.reconcile(f.context.id);
    expect(f.store.action('action')).toMatchObject({ receipt: 'accepted', admissionId: 'admission', state: 'running' });
    f.request.mockResolvedValueOnce(snapshot()); f.request.mockResolvedValueOnce(receipt({ status: 'terminal', outcome: 'completed', execution_generation: 2 }));
    await f.engine.reconcile(f.context.id);
    expect(f.store.action('action')).toMatchObject({ state: 'finished', remoteOutcome: 'completed', text: 'Saved text' });
    expect(f.request.mock.calls.some(([m]) => m === 'prompt.submit')).toBe(false);
  });
  it('does not attribute another client’s completion to the saved submission', async () => {
    const f = actionFixture(), live = await f.call('session.resume', { session_id: 'stored' });
    f.store.saveBinding(f.context.id, { runtimeId: 'stored', storedId: 'stored', epoch: f.gateway.epoch, generation: 'binding', seq: 4, ready: false, monitored: true, known: true, remote: live.remote });
    f.store.saveAction({ id: 'action', taskId: f.context.id, kind: 'send', text: 'Saved text', uploadIds: [], createdAt: 1, updatedAt: 1, state: 'running', phase: 'working', receipt: 'accepted', sendStage: 'submitted', admissionId: 'mine' });
    f.engine.event({ type: 'message.complete', session_id: 'stored', seq: 5, remote: live.remote, admission_id: 'theirs', payload: { status: 'complete' } });
    expect(f.store.action('action')?.terminal).toBeUndefined();
    expect(f.store.binding(f.context.id)?.seq).toBe(5);
  });
  it('persists the submission before dispatch and confirms an already-finished admission through its receipt', async () => {
    const f = actionFixture(), live = await f.call('session.resume', { session_id: 'stored' });
    f.gateway.connect = async () => {};
    f.store.saveBinding(f.context.id, { runtimeId: 'stored', storedId: 'stored', epoch: f.gateway.epoch, generation: 'binding', seq: 4, ready: true, monitored: true, known: true, remote: live.remote });
    f.request.mockImplementation(async (method, params) => {
      if (method === 'session.resume') return snapshot();
      if (method === 'session.control.read') return { control: {} };
      if (method === 'prompt.submit') {
        expect(f.store.action('submitted')?.submissionId).toBe(params.submission_id);
        expect(f.store.action('submitted')?.sendStage).toBe('submitting');
        return receipt();
      }
      if (method === 'prompt.receipt') return receipt({ status: 'terminal', outcome: 'completed', execution_generation: 2 });
      throw new Error(`Unexpected ${method}`);
    });
    f.engine.start({ id: 'submitted', taskId: f.context.id, kind: 'send', text: 'Synthetic saved message' });
    await expect.poll(() => f.store.action('submitted')?.state).toBe('finished');
    expect(f.store.action('submitted')).toMatchObject({ receipt: 'accepted', admissionId: 'admission', submissionId: 'submitted' });
    expect(f.request.mock.calls.filter(([m]) => m === 'prompt.submit')).toHaveLength(1);
  });
  it('recovers an earlier admission after a newer message becomes the main action', async () => {
    const f = actionFixture(), live = await f.call('session.resume', { session_id: 'stored' });
    const binding = { runtimeId: 'stored', storedId: 'stored', epoch: f.gateway.epoch, generation: 'binding', seq: 4, ready: false, monitored: true, known: true, remote: live.remote };
    f.store.saveBinding(f.context.id, binding);
    for (const id of ['earlier', 'latest']) f.store.saveAction({ id, taskId: f.context.id, kind: 'send', text: 'Saved', uploadIds: [], createdAt: 1, updatedAt: 1,
      state: 'unknown', phase: 'unknown', receipt: 'unknown', submissionId: id, admissionId: `${id}-receipt`, sendStage: 'submitting', binding });
    f.request.mockImplementation(async (method, params) => method === 'session.resume' ? snapshot()
      : receipt({ admission_id: params.admission_id, status: 'terminal', outcome: 'completed', execution_generation: 2 }));
    await f.engine.reconcile(f.context.id);
    expect(f.store.action('earlier')).toMatchObject({ state: 'finished', receipt: 'accepted', admissionId: 'earlier-receipt' });
    expect(f.store.action('latest')).toMatchObject({ state: 'finished', receipt: 'accepted', admissionId: 'latest-receipt' });
    expect(f.request.mock.calls.filter(([method]) => method === 'prompt.submit')).toHaveLength(0);
  });
  it('selects a free initial title before changing a canonical session', async () => {
    const f = actionFixture(), live = await f.call('session.resume', { session_id: 'stored' });
    const binding = { runtimeId: 'stored', storedId: 'stored', epoch: f.gateway.epoch, generation: 'binding', seq: 4, ready: false, monitored: true, known: true, remote: live.remote };
    const action = { id: 'naming', taskId: f.context.id, kind: 'send' as const, text: 'Repeated opening', uploadIds: [], createdAt: 1, updatedAt: 1,
      state: 'preparing' as const, phase: 'naming', receipt: 'pending' as const };
    f.store.saveAction(action);
    f.request.mockResolvedValueOnce({ sessions: [{ session_id: 'other', title: 'Repeated opening' }] });
    f.request.mockResolvedValueOnce({ sessions: [] });
    f.request.mockResolvedValueOnce({ session_id: 'stored', revision: 4, title: 'Repeated opening (2)' });
    await f.engine.nameConversation(action, binding, 'New conversation');
    expect(f.store.context(f.context.id)?.title).toBe('Repeated opening (2)');
    expect(f.request.mock.calls.filter(([method]) => method === 'session.mutate')).toHaveLength(1);
  });
});
