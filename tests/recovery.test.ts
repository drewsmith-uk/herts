import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Store } from '../server/store';
import { Actions } from '../server/actions';
import { Gateway, GatewayError } from '../server/gateway';
import { RecoveryQueue } from '../server/recoveryQueue';

const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach(close => close()); vi.useRealTimers(); });
function fixture() {
  const store = new Store(':memory:');
  store.saveContext({ id: 'context', title: 'Synthetic recovery', link: null, aliases: [] });
  store.saveBinding('context', { runtimeId: 'runtime', storedId: 'stored', epoch: 'epoch', generation: 'generation', seq: 1, known: true, ready: false, monitored: true });
  store.saveAction({ id: 'action', taskId: 'context', kind: 'send', text: 'Saved message', uploadIds: [], createdAt: 1, updatedAt: 1,
    state: 'running', phase: 'working', receipt: 'accepted', sendStage: 'submitted', turnStarted: true });
  const gateway = Object.assign(new EventEmitter(), { profile: 'default', protocol: 'standalone', epoch: 'epoch', online: true,
    rpc: vi.fn(async (method: string): Promise<any> => {
      if (method === 'session.events.since') return { epoch: 'epoch', latest_seq: 2, events: [complete], truncated: false };
      if (method === 'session.activate') return { session_id: 'runtime', session_key: 'stored', info: {}, running: false };
      if (method === 'approval.pending') return { approvals: [] };
      if (method === 'session.control.read') return { control: {} };
      throw new Error(`Unexpected remote operation: ${method}`);
    }) });
  const engine = new Actions(store, gateway as unknown as Gateway, '/tmp');
  cleanup.push(() => { engine.close(); store.close(); });
  const notices = () => (store.db.prepare('SELECT count(*) n FROM notices').get() as any).n;
  return { store, gateway, engine, notices };
}
const complete = { session_id: 'runtime', seq: 2, type: 'message.complete', payload: { status: 'complete' } };

describe('execution recovery', () => {
  it('processes completion before a newer live event and delivers one durable notice', async () => {
    const f = fixture(), rpc = f.gateway.rpc.getMockImplementation()!;
    f.gateway.rpc.mockImplementation(async method => {
      if (method === 'session.events.since') {
        f.gateway.emit('event', { ...complete, seq: 3, type: 'status.update', payload: { text: 'Idle' } });
        return { ...(await rpc(method)), latest_seq: 3 };
      }
      return rpc(method);
    });
    f.store.on('notice', () => {
      expect(f.store.db.inTransaction).toBe(false);
      expect(f.store.action('action')?.state).toBe('finished');
      expect(f.store.binding('context')?.seq).toBe(3);
    });
    await f.engine.reconnect(); await f.engine.reconnect();
    expect(f.store.action('action')?.state).toBe('finished');
    expect(f.notices()).toBe(1);
    expect(f.gateway.rpc.mock.calls.map(call => call[0])).not.toContain('prompt.submit');
  });
  it('retries a failed replay without a browser and retains its checkpoint', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.gateway.rpc.mockRejectedValueOnce(new GatewayError('Synthetic timeout'));
    await f.engine.reconnect();
    expect(f.store.binding('context')).toMatchObject({ seq: 1, recoveryPending: true });
    expect(f.notices()).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.store.action('action')?.state).toBe('finished');
    expect(f.store.binding('context')).toMatchObject({ seq: 2, recoveryPending: false });
    expect(f.notices()).toBe(1);
  });
  it('keeps truncated replay uncertain without inferring completion from idle state', async () => {
    const f = fixture();
    f.gateway.rpc.mockResolvedValueOnce({ epoch: 'epoch', latest_seq: 9, truncated: true, events: [] });
    await f.engine.reconnect();
    expect(f.store.action('action')?.state).toBe('unknown');
    expect(f.store.binding('context')).toMatchObject({ seq: 1, recoveryPending: true });
    expect(f.notices()).toBe(0);
  });
  it('does not apply a delayed replay to a replacement binding', async () => {
    const f = fixture();
    let release!: (value: any) => void;
    f.gateway.rpc.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = f.engine.reconnect();
    await vi.waitFor(() => expect(release).toBeDefined());
    f.store.saveBinding('context', { ...f.store.binding('context')!, generation: 'replacement', seq: 20 });
    release({ epoch: 'epoch', latest_seq: 2, events: [complete], truncated: false });
    await pending;
    expect(f.store.binding('context')).toMatchObject({ generation: 'replacement', seq: 20 });
    expect(f.store.action('action')?.terminal).toBeUndefined();
    expect(f.notices()).toBe(0);
  });
  it('rolls back events and checkpoint changes together when persistence fails', async () => {
    const f = fixture(), save = f.store.saveAction.bind(f.store);
    const failure = vi.spyOn(f.store, 'saveAction').mockImplementation(action => {
      if (action.terminal) throw new Error('Synthetic storage failure');
      save(action);
    });
    await f.engine.reconnect();
    expect(f.store.binding('context')?.seq).toBe(1);
    expect(f.store.action('action')?.terminal).toBeUndefined();
    expect(f.notices()).toBe(0);
    failure.mockRestore();
  });
  it('rolls back recovered completion and checkpoint when notice creation fails', async () => {
    const f = fixture();
    const notice = vi.spyOn(f.store, 'notify').mockImplementationOnce(() => { throw new Error('Synthetic notice failure'); });
    await f.engine.reconnect();
    expect(f.store.binding('context')).toMatchObject({ seq: 1, recoveryPending: true });
    expect(f.store.action('action')).toMatchObject({ state: 'running' });
    expect(f.store.action('action')?.terminal).toBeUndefined();
    expect(f.notices()).toBe(0);
    notice.mockRestore();
  });
  it('retries after buffer overflow without advancing the recovery checkpoint', async () => {
    vi.useFakeTimers();
    const f = fixture(), rpc = f.gateway.rpc.getMockImplementation()!;
    const events = Array.from({ length: 513 }, (_, i) => ({ ...complete, seq: i + 3, type: 'status.update', payload: { text: 'Working' } }));
    let first = true;
    f.gateway.rpc.mockImplementation(async method => {
      if (method !== 'session.events.since') return rpc(method);
      if (first) { first = false; for (const event of events) f.gateway.emit('event', event); }
      return { epoch: 'epoch', latest_seq: 515, truncated: false, events: [complete, ...events] };
    });
    await f.engine.reconnect();
    expect(f.store.binding('context')).toMatchObject({ seq: 1, observedSeq: 515, recoveryPending: true });
    expect(f.notices()).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.store.binding('context')).toMatchObject({ seq: 515, recoveryPending: false });
    expect(f.store.action('action')?.state).toBe('finished');
    expect(f.notices()).toBe(1);
  });
  it('reconstructs pending recovery after an app restart', async () => {
    const f = fixture();
    f.gateway.rpc.mockRejectedValueOnce(new GatewayError('Synthetic timeout'));
    await f.engine.reconnect(); f.engine.close(); f.gateway.removeAllListeners();
    const replacement = new Actions(f.store, f.gateway as unknown as Gateway, '/tmp');
    cleanup.unshift(() => replacement.close());
    await replacement.reconnect();
    expect(f.store.action('action')?.state).toBe('finished');
    expect(f.notices()).toBe(1);
  });
});

describe('recovery scheduling', () => {
  it('limits concurrent recoveries and resumes remaining work', async () => {
    const queue = new RecoveryQueue(); cleanup.push(() => queue.close());
    const releases: (() => void)[] = [];
    const run = vi.fn(() => new Promise<boolean>(resolve => releases.push(() => resolve(true))));
    const pending = Array.from({ length: 7 }, (_, i) => queue.enqueue(String(i), run));
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(4));
    releases.splice(0).forEach(release => release());
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(7));
    releases.splice(0).forEach(release => release());
    await Promise.all(pending);
  });
  it('uses bounded retry delays and pauses while disconnected', async () => {
    vi.useFakeTimers();
    const queue = new RecoveryQueue(); cleanup.push(() => queue.close());
    const run = vi.fn(async () => false);
    await queue.enqueue('session', run);
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      const count = run.mock.calls.length;
      await vi.advanceTimersByTimeAsync(delay - 1); expect(run).toHaveBeenCalledTimes(count);
      await vi.advanceTimersByTimeAsync(1); expect(run).toHaveBeenCalledTimes(count + 1);
    }
    queue.connected(false); const count = run.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60000); expect(run).toHaveBeenCalledTimes(count);
    queue.connected(true); await vi.advanceTimersByTimeAsync(0); expect(run).toHaveBeenCalledTimes(count + 1);
  });
});
