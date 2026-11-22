import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Action } from '../shared/core';
import { voiceLiveGreeting } from '../shared/voice';
import { CallController, SetupError, speechChunks, transcriptTurns, type CallRecord, type LiveEvent, type Transport } from '../plugins/calls/src/controller';

const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); vi.useRealTimers(); });
const context = { id: randomUUID(), title: 'Synthetic linked conversation', profile: 'research' };
const session = { session: { id: 'live-synthetic' }, transport: { type: 'webrtc' as const, sdp: 'answer\r\n' } };
const settled = async () => { for (let n = 0; n < 30; n++) await Promise.resolve(); };
function fixture(options: { start?: (create: (sdp: string) => Promise<typeof session>) => Promise<void>; submit?: () => Promise<Action>; save?: (record: CallRecord) => Promise<void> } = {}) {
  let event!: (event: LiveEvent) => void, lost!: () => void;
  const release = vi.fn(), save = vi.fn(options.save || (async () => {})), sent: Record<string, unknown>[] = [];
  const create = vi.fn(async () => session);
  const transport: Transport = { start: options.start || (async create => { await create('offer\r\n'); event({ type: 'session.started', session: session.session }); }),
    send: vi.fn(e => { sent.push(e); return true; }), mute: vi.fn(), stopMedia: vi.fn(), dispose: vi.fn() };
  const submit = vi.fn(options.submit || (async (_call?: CallRecord, request?: any) => ({ id: request.actionId, taskId: context.id, kind: 'send', state: 'running', receipt: 'accepted' } as Action)));
  const controller = new CallController({ greeting: voiceLiveGreeting, id: randomUUID, acquire: async () => release, save, create, changed: vi.fn(),
    transport: (e, l) => { event = e; lost = l; return transport; }, submit });
  cleanup.push(() => controller.dispose());
  const request = (id = 'delegation-1', text = 'Summarise this synthetic paragraph.') => {
    event({ type: 'session.input_transcript.delta', event_id: `text-${id}`, delta: text, start_ms: 1, end_ms: 20 });
    event({ type: 'session.delegation.created', delegation: { id }, offset_ms: 30 });
  };
  return { controller, transport, create, submit, save, release, sent, event: (e: LiveEvent) => event(e), lost: () => lost(), request };
}

describe('Calls lifecycle and delegation', () => {
  it('saves identity before dispatch and submits one request for duplicate delegation events', async () => {
    const f = fixture(); await f.controller.start(context); f.request(); f.request(); await settled();
    expect(f.submit).toHaveBeenCalledTimes(1);
    expect(f.save.mock.invocationCallOrder[0]).toBeLessThan(f.create.mock.invocationCallOrder[0]);
    const request = f.controller.record!.requests[0];
    expect(f.submit).toHaveBeenCalledWith(expect.objectContaining({ contextId: context.id, profile: 'research' }), expect.objectContaining({ actionId: request.actionId }));
    expect(f.controller.record!.transcript).toHaveLength(1);
  });
  it('queues a follow-up without cancelling work and routes results to their delegation', async () => {
    const f = fixture(); await f.controller.start(context); f.request(); await settled();
    f.event({ type: 'session.output_transcript.delta', delta: 'I will check.' });
    f.request('delegation-2', 'Use Thursday instead of Friday.'); await settled();
    expect(f.submit).toHaveBeenCalledTimes(1);
    const first = f.controller.record!.requests[0];
    f.controller.observe([{ id: first.actionId, taskId: context.id, receipt: 'accepted', state: 'finished', liveText: 'The result is ready.' } as Action]);
    await settled();
    expect(f.sent).toContainEqual(expect.objectContaining({ type: 'session.commentary.append', delegation_id: 'delegation-1', content: 'The result is ready.' }));
    expect(f.submit).toHaveBeenCalledTimes(2);
    expect(f.controller.record!.requests[1].text).toBe('Use Thursday instead of Friday.');
  });
  it('waits for work that was already active before the call', async () => {
    const f = fixture(), existing = { id: randomUUID(), taskId: context.id, receipt: 'accepted', state: 'running' } as Action;
    f.controller.observe([existing]); await f.controller.start(context); f.request(); await settled();
    expect(f.submit).not.toHaveBeenCalled();
    f.controller.observe([{ ...existing, state: 'finished' }]); await settled();
    expect(f.submit).toHaveBeenCalledOnce();
  });
  it('submits only new speech when consecutive requests have no voice reply between them', async () => {
    const f = fixture(); await f.controller.start(context);
    f.request('first', 'Create a synthetic task.'); await settled();
    f.request('second', 'Add a Thursday reminder.'); await settled();
    const first = f.controller.record!.requests[0];
    f.controller.observe([{ id: first.actionId, taskId: context.id, receipt: 'accepted', state: 'finished' } as Action]);
    await settled();
    expect(f.submit).toHaveBeenCalledTimes(2);
    expect(f.controller.record!.requests[1].text).toBe('Add a Thursday reminder.');
    expect(f.controller.record!.requests[1].context).toContain('Create a synthetic task.');
  });
  it('stops capture immediately and waits for confirmed closure', async () => {
    const f = fixture(); await f.controller.start(context); f.controller.end();
    expect(f.transport.stopMedia).toHaveBeenCalledOnce();
    expect(f.controller.record!.state).toBe('closing'); expect(f.transport.dispose).not.toHaveBeenCalled();
    f.event({ type: 'session.closed', usage: { seconds: 4 } });
    expect(f.controller.record).toMatchObject({ state: 'ended', usageSeconds: 4 });
    expect(f.release).toHaveBeenCalledOnce();
    f.lost(); expect(f.controller.record!.state).toBe('ended');
  });
  it('records a timeout as unconfirmed and never restarts on restoration', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.controller.start(context); f.controller.end();
    await vi.advanceTimersByTimeAsync(15000);
    expect(f.controller.record!.state).toBe('unconfirmed');
    const restored = fixture(); await restored.controller.restore(f.controller.record!);
    expect(restored.create).not.toHaveBeenCalled(); expect(restored.submit).not.toHaveBeenCalled();
  });
  it('freezes safely and ignores late callbacks', async () => {
    const f = fixture(); await f.controller.start(context); f.request(); await settled();
    f.controller.end(true); f.request('late'); f.event({ type: 'session.started' });
    expect(f.controller.record!.state).toBe('unconfirmed'); expect(f.submit).toHaveBeenCalledTimes(1);
    expect(f.sent).toContainEqual(expect.objectContaining({ type: 'session.close' }));
    expect(vi.mocked(f.transport.send).mock.invocationCallOrder.at(-1)).toBeLessThan(vi.mocked(f.transport.dispose).mock.invocationCallOrder[0]);
  });
  it('retains queued text after hangup and leaves accepted work running', async () => {
    const f = fixture(); await f.controller.start(context); f.request(); await settled();
    f.request('second'); f.controller.end();
    expect(f.controller.record!.requests.map(r => r.state)).toEqual(['accepted', 'unsent']);
    expect(f.submit).toHaveBeenCalledTimes(1);
    expect(f.sent.filter(e => e.type === 'session.close')).toHaveLength(1);
  });
  it('dispatches a new call request once after a previous call submission rejects', async () => {
    const f = fixture();
    let reject!: (error: Error) => void;
    const pending = new Promise<Action>((_, fail) => { reject = fail; });
    f.submit.mockImplementationOnce(() => pending);
    await f.controller.start(context);
    f.request('first');
    await settled();
    f.controller.end();
    f.event({ type: 'session.closed' });
    await f.controller.start(context);
    f.request('second');
    expect(f.controller.record!.requests[0].state).toBe('queued');
    reject(new Error('Lost reply'));
    await settled();
    expect(f.submit).toHaveBeenCalledTimes(2);
    expect(f.controller.record!.requests[0]).toMatchObject({ id: 'second', state: 'accepted' });
    expect(f.controller.record!.error).toBeUndefined();
  });
  it('keeps a locally rejected request for copying and accepts later speech', async () => {
    const f = fixture();
    const message = 'Conversation settings changed. Review them before sending.';
    f.submit.mockRejectedValueOnce(Object.assign(new Error(message), { submissionOutcome: 'unsent' }));
    await f.controller.start(context);
    f.request('first', 'Save this text.');
    await settled();
    expect(f.controller.record!.requests[0]).toMatchObject({ state: 'unsent', text: 'Save this text.', failureReason: message });
    f.request('second', 'Check tomorrow instead.');
    await settled();
    expect(f.submit).toHaveBeenCalledTimes(2);
    expect(f.controller.record!.requests[1].state).toBe('accepted');
  });
  it('blocks the queue after a lost submission receipt', async () => {
    const f = fixture({ submit: async () => { throw new Error('lost'); } });
    await f.controller.start(context); f.request(); await settled(); f.request('second'); await settled();
    expect(f.submit).toHaveBeenCalledOnce();
    expect(f.controller.record!.requests[0].state).toBe('unknown');
  });
  it('does not treat spoken approval as an approval action', async () => {
    const f = fixture(); await f.controller.start(context); f.request('yes', 'Yes'); await settled();
    f.controller.observe([{ id: f.controller.record!.requests[0].actionId, taskId: context.id, receipt: 'accepted', state: 'awaiting_input' } as Action]);
    expect(f.sent).toContainEqual(expect.objectContaining({ type: 'session.thinking.append', content: 'Hermes needs your input on screen.' }));
    expect(f.submit).toHaveBeenCalledTimes(1);
  });
  it('rejects empty delegation text without inventing a request', async () => {
    const f = fixture(); await f.controller.start(context); f.event({ type: 'session.delegation.created', delegation: { id: 'empty' } });
    await settled(); expect(f.submit).not.toHaveBeenCalled(); expect(f.controller.record!.requests[0].state).toBe('unsent');
  });
  it('does not reuse an old utterance when a new delegation precedes its transcript', async () => {
    const f = fixture(); await f.controller.start(context); f.request(); await settled();
    f.event({ type: 'session.delegation.created', delegation: { id: 'early-follow-up' }, offset_ms: 500 });
    await settled();
    expect(f.submit).toHaveBeenCalledOnce();
    expect(f.controller.record!.requests[1]).toMatchObject({ text: '', state: 'unsent' });
  });
  it('times out startup without activating a late remote session', async () => {
    vi.useFakeTimers(); let complete!: () => void;
    const f = fixture({ start: async create => { await create('offer'); await new Promise<void>(resolve => { complete = resolve; }); } });
    const starting = f.controller.start(context); await settled();
    await vi.advanceTimersByTimeAsync(45000);
    expect(f.controller.record!.state).toBe('unconfirmed'); expect(f.transport.dispose).toHaveBeenCalledOnce();
    complete(); await starting; f.event({ type: 'session.started' });
    expect(f.controller.record!.state).toBe('unconfirmed'); expect(f.create).toHaveBeenCalledOnce();
  });
  it('does not dispatch before durable recovery storage succeeds', async () => {
    const f = fixture({ save: async () => { throw new Error('disk full'); } });
    await f.controller.start(context); await settled();
    expect(f.create).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled(); expect(f.release).toHaveBeenCalledOnce();
  });
  it('cleans up late setup without activating audio after cancellation', async () => {
    let resume!: () => void;
    const f = fixture({ start: async create => { await new Promise<void>(resolve => { resume = resolve; }); await create('offer'); } });
    const starting = f.controller.start(context); await settled(); f.controller.end(); resume(); await starting;
    expect(f.create).not.toHaveBeenCalled(); expect(f.controller.record!.state).toBe('ended');
  });
  it('distinguishes explicit creation rejection from an unknown outcome', async () => {
    const f = fixture({ start: async create => { await create('offer'); throw new SetupError('Rejected', false); } });
    await f.controller.start(context); expect(f.controller.record!.state).toBe('failed');
  });
  it('bounds multilingual appends without breaking Unicode characters', () => {
    const text = 'Synthetic 世界🙂 '.repeat(200), chunks = speechChunks(text);
    expect(chunks.join('')).toBe(text.trim());
    expect(chunks.every(chunk => new TextEncoder().encode(chunk).length <= 400)).toBe(true);
  });
});

it('greets once after readiness without a task or invented transcript', async () => {
  const f = fixture(); await f.controller.start(context);
  f.event({ type: 'session.started', event_id: 'duplicate-ready' });
  f.event({ type: 'session.started' }); await settled();
  expect(f.sent).toEqual([{ type: 'session.commentary.append', content: voiceLiveGreeting, delegation_id: null, event_id: expect.any(String) }]);
  expect(f.submit).not.toHaveBeenCalled(); expect(f.controller.record!.transcript).toEqual([]);
  f.controller.end(); f.event({ type: 'session.started' });
  expect(f.sent.filter(event => event.type === 'session.commentary.append')).toHaveLength(1);
});
it('keeps background reason independent of closure confirmation and recovery', async () => {
  const f = fixture(); await f.controller.start(context); f.controller.end(false, 'background'); f.lost();
  expect(f.controller.record).toMatchObject({ state: 'unconfirmed', endReason: 'background' });
  const restored = fixture(); await restored.controller.restore(f.controller.record!);
  expect(restored.controller.record).toMatchObject({ state: 'unconfirmed', endReason: 'background' });
  expect(restored.sent).toEqual([]); expect(restored.create).not.toHaveBeenCalled();
});
it('groups display turns without changing raw text or delegation indexes', () => {
  const fragments = ['Can', ' you', ' suggest', ' exercises', '?'].map(text => ({ speaker: 'user' as const, text, start: 0, end: 1 }));
  fragments.push({ speaker: 'user', text: '\nFor Thursday.', start: 1, end: 2 });
  const raw = structuredClone(fragments);
  expect(transcriptTurns(fragments)).toEqual([{ speaker: 'user', text: 'Can you suggest exercises?\nFor Thursday.' }]);
  expect(fragments).toEqual(raw);
});
