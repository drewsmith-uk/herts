import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const origin = 'https://tasks.example';
const windowClient = (overrides: Record<string, unknown> = {}) => {
  const client = {
    url: `${origin}/#/tasks`, frameType: 'top-level', focused: false, visibilityState: 'hidden',
    focus: vi.fn(), navigate: vi.fn(async () => ({})),
    postMessage: vi.fn((_data: unknown, ports: MessagePort[]) => ports[0].postMessage({ accepted: true })), ...overrides
  };
  client.focus.mockResolvedValue(client);
  return client;
};
class TestMessageChannel {
  port1 = { onmessage: null as ((event: { data: unknown }) => void) | null, close: vi.fn() };
  port2 = { postMessage: (data: unknown) => queueMicrotask(() => this.port1.onmessage?.({ data })), close: vi.fn() };
}
async function fixture(windows: ReturnType<typeof windowClient>[] = []) {
  const listeners: Record<string, Function> = {};
  const clients = { matchAll: vi.fn(async () => windows), openWindow: vi.fn(async (_url: string): Promise<any> => null) };
  const self = { location: { origin }, clients, addEventListener: (type: string, listener: Function) => { listeners[type] = listener; } };
  runInNewContext(await readFile('public/sw.js', 'utf8'), { self, URL, MessageChannel: TestMessageChannel, setTimeout, clearTimeout });
  const click = async (data: unknown = { id: 'snooze:task:operation' }) => {
    let work: Promise<void> | undefined;
    const close = vi.fn();
    listeners.notificationclick({ notification: { data, close }, waitUntil: (promise: Promise<void>) => { work = promise; } });
    expect(close).toHaveBeenCalledOnce(); await work;
  };
  return { clients, click };
}
const target = '/?notice=snooze%3Atask%3Aoperation';
afterEach(() => vi.useRealTimers());

describe('foregrounding Herts from a notification', () => {
  it('prepares a background app before focusing it, without reloading or relaunching', async () => {
    const hidden = windowClient(), focused = windowClient(); hidden.focus.mockResolvedValue(focused);
    const { clients, click } = await fixture([hidden]); await click();
    expect(hidden.focus).toHaveBeenCalledOnce();
    expect(hidden.postMessage).toHaveBeenCalledWith({ type: 'OPEN_NOTIFICATION', id: 'snooze:task:operation' }, expect.arrayContaining([expect.objectContaining({ postMessage: expect.any(Function) })]));
    expect(hidden.postMessage.mock.invocationCallOrder[0]).toBeLessThan(hidden.focus.mock.invocationCallOrder[0]);
    expect(clients.openWindow).not.toHaveBeenCalled(); expect(focused.navigate).not.toHaveBeenCalled(); expect(hidden.navigate).not.toHaveBeenCalled(); expect(focused.focus).not.toHaveBeenCalled();
  });
  it('focuses a suspended page after at most 100ms and lets the queued message finish without reloading', async () => {
    vi.useFakeTimers();
    const current = windowClient(); let acknowledge!: () => void;
    current.postMessage.mockImplementation((_data, ports) => { acknowledge = () => ports[0].postMessage({ accepted: true }); });
    current.focus.mockImplementation(async () => { acknowledge(); return current; });
    const { clients, click } = await fixture([current]), work = click();
    await vi.advanceTimersByTimeAsync(99); expect(current.focus).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); await work;
    expect(current.focus).toHaveBeenCalledOnce(); expect(current.navigate).not.toHaveBeenCalled(); expect(clients.openWindow).not.toHaveBeenCalled();
  });
  it.each([null, { kind: 'test' }, { id: 'snooze:task:operation' }])('opens the appropriate URL when no app window is running (%j)', async data => {
    const { clients, click } = await fixture(); await click(data);
    expect(clients.openWindow).toHaveBeenCalledExactlyOnceWith(!data ? '/' : 'kind' in data ? '/#/settings' : target);
  });
  it('prefers an already focused app over another background window', async () => {
    const hidden = windowClient(), current = windowClient({ focused: true, visibilityState: 'visible' });
    const { clients, click } = await fixture([hidden, current]); await click({ kind: 'test', id: 'test-id' });
    expect(current.postMessage).toHaveBeenCalledWith({ type: 'OPEN_NOTIFICATION', kind: 'test' }, expect.arrayContaining([expect.objectContaining({ postMessage: expect.any(Function) })]));
    expect(hidden.focus).not.toHaveBeenCalled(); expect(current.navigate).not.toHaveBeenCalled(); expect(clients.openWindow).not.toHaveBeenCalled();
  });
  it('focuses before the one-time reload of an older page that cannot acknowledge messages', async () => {
    vi.useFakeTimers();
    const current = windowClient(); current.postMessage.mockImplementation(() => {});
    const { clients, click } = await fixture([current]), work = click();
    await vi.advanceTimersByTimeAsync(1499);
    expect(current.focus).toHaveBeenCalledOnce(); expect(current.navigate).not.toHaveBeenCalled(); expect(clients.openWindow).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); await work;
    expect(current.navigate).toHaveBeenCalledExactlyOnceWith(target); expect(current.focus).toHaveBeenCalledOnce(); expect(clients.openWindow).not.toHaveBeenCalled();
  });
  it('falls back to a focused navigation if posting to the page fails', async () => {
    const current = windowClient(); current.postMessage.mockImplementation(() => { throw new Error('Page went away'); });
    const { clients, click } = await fixture([current]); await click();
    expect(current.navigate).toHaveBeenCalledExactlyOnceWith(target); expect(clients.openWindow).not.toHaveBeenCalled();
  });
  it('still launches if client enumeration fails', async () => {
    const { clients, click } = await fixture(); clients.matchAll.mockRejectedValue(new Error('Window list unavailable'));
    await click(); expect(clients.openWindow).toHaveBeenCalledExactlyOnceWith(target);
  });
  it('skips closed, nested and cross-origin windows and focuses a surviving app', async () => {
    const nested = windowClient({ frameType: 'nested' }), other = windowClient({ url: 'https://other.example/' }), closed = windowClient(), current = windowClient();
    closed.focus.mockRejectedValue(new Error('Window closed'));
    const { clients, click } = await fixture([nested, other, closed, current]); await click();
    expect(nested.focus).not.toHaveBeenCalled(); expect(other.focus).not.toHaveBeenCalled();
    expect(closed.focus).toHaveBeenCalledOnce(); expect(current.focus).toHaveBeenCalledOnce();
    expect(current.navigate).not.toHaveBeenCalled(); expect(clients.openWindow).not.toHaveBeenCalled();
  });
  it('does not refocus a successfully launched app if the previous window disappeared', async () => {
    const closed = windowClient(), opened = windowClient(); closed.focus.mockRejectedValue(new Error('Window closed'));
    const { clients, click } = await fixture([closed]); clients.openWindow.mockResolvedValue(opened);
    await click(); expect(clients.openWindow).toHaveBeenCalledOnce(); expect(opened.focus).not.toHaveBeenCalled(); expect(opened.navigate).not.toHaveBeenCalled();
  });
  it('retains a launch error if no window can be opened or focused', async () => {
    const hidden = windowClient(); hidden.focus.mockRejectedValue(new Error('Window closed'));
    const { clients, click } = await fixture([hidden]); clients.openWindow.mockRejectedValue(new Error('Launch rejected'));
    await expect(click()).rejects.toThrow('Launch rejected'); expect(hidden.navigate).not.toHaveBeenCalled();
  });
});
