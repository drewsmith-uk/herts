import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { deviceNotificationRoute } from '../shared/deviceNotifications';

async function fixture() {
  const listeners = new Map<string, Function[]>(), records = new Map<string, any>(), visible = new Map<string, any>();
  const catalogue = { entries: [{ manifest: { id: 'sample' }, enabled: true, available: true, generation: 0, hash: 'fixture' }] };
  const self = {
    location: { origin: 'https://fixture.example' },
    addEventListener(type: string, listener: Function) { listeners.set(type, [...listeners.get(type) || [], listener]); },
    clients: { matchAll: vi.fn(async () => []), openWindow: vi.fn(async () => ({})) },
    registration: {
      getNotifications: vi.fn(async ({ tag }: { tag?: string } = {}) => [...visible.values()].filter(n => !tag || n.tag === tag)),
      showNotification: vi.fn(async (title: string, options: any) => {
        const notification = { title, ...options, close: vi.fn(() => { visible.delete(options.tag); }) };
        visible.set(options.tag, notification);
      }),
    },
  };
  const context = createContext({ self, URL, AbortController, setTimeout, clearTimeout, crypto: { randomUUID }, Notification: { permission: 'granted' } });
  runInContext(await readFile('public/sw.js', 'utf8'), context);
  context.pluginNotificationStorage = async (_mode: string, work: Function) => work({
    catalogue: async () => catalogue,
    get: async (key: string) => records.get(key),
    all: async () => [...records].map(([key, value]) => ({ key, value })),
    put: async (key: string, value: any) => { records.set(key, value); },
    remove: async (key: string) => { records.delete(key); },
  });
  const fire = async (type: string, event: any) => {
    const work: Promise<unknown>[] = [];
    for (const listener of listeners.get(type) || []) listener({ ...event, waitUntil: (promise: Promise<unknown>) => work.push(promise) });
    await Promise.all(work);
  };
  const command = async (command: string, input: any = {}) => {
    let response: any;
    await fire('message', { source: { url: 'https://fixture.example/#/plugins/sample' }, data: { type: 'PLUGIN_NOTIFICATIONS', version: 1, pluginId: 'sample', generation: 0, hash: 'fixture', command, ...input }, ports: [{ postMessage: (value: unknown) => { response = value; } }] });
    return response;
  };
  const input = { key: 'conversation', title: 'Review synthetic notes', route: '/conversation/synthetic', body: 'Saved reminder', restoreOnDismiss: true, metadata: { reference: 'synthetic' } };
  const pin = () => command('set', { input, expectedRevision: null });
  const dismiss = async () => { const notification = [...visible.values()][0]; visible.delete(notification.tag); await fire('notificationclose', { notification }); };
  return { self, command, pin, dismiss, fire, input, catalogue, records, visible, context };
}

describe('durable plugin notifications', () => {
  it('cancels a blocked lock request without leaving a notification write queued', async () => {
    vi.useFakeTimers();
    try {
      const f = await fixture();
      const request = vi.fn((_name: string, { signal }: { signal: AbortSignal }, _work: Function) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason));
      }));
      (f.self as any).navigator = { locks: { request } };
      const pending = f.pin(); await vi.advanceTimersByTimeAsync(4000);
      expect((await pending).error).toContain('Close other Herts windows');
      expect(f.records.size).toBe(0);
      expect((await f.command('check')).error).toBeUndefined();
      expect(request).toHaveBeenCalledOnce();
      delete (f.self as any).navigator;
      expect((await f.pin()).error).toBeUndefined();
      expect(f.records.size).toBe(1);
    } finally { vi.useRealTimers(); }
  });
  it('checks readiness while display is blocked without publishing a storage change', async () => {
    const f = await fixture();
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const original = f.self.registration.showNotification.getMockImplementation()!;
    f.self.registration.showNotification.mockImplementationOnce(async (...args) => {
      entered(); await new Promise<void>(resolve => { release = resolve; }); await original(...args);
    });
    const pending = f.pin(); await started;
    try {
      expect(await f.command('check')).toEqual({ version: 1, result: undefined });
      expect(f.self.clients.matchAll).not.toHaveBeenCalled();
      expect(f.records.size).toBe(1);
    } finally { release(); await pending; }
  });
  it('releases the queue after a stalled browser read and preserves the saved pin', async () => {
    vi.useFakeTimers();
    try {
      const f = await fixture(); const saved = (await f.pin()).result;
      f.self.registration.getNotifications.mockImplementationOnce(() => new Promise(() => {}));
      const pending = f.command('reconcile');
      await vi.advanceTimersByTimeAsync(4000);
      expect((await pending).error).toContain('browser did not respond');
      expect([...f.records.values()]).toEqual([saved]);
      expect((await f.command('remove', { key: f.input.key })).error).toBeUndefined();
      expect(f.records.size).toBe(0); expect(f.visible.size).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('bounds a stalled display and closes its late result after unpinning', async () => {
    vi.useFakeTimers();
    try {
      const f = await fixture();
      let release!: () => void;
      const original = f.self.registration.showNotification.getMockImplementation()!;
      f.self.registration.showNotification.mockImplementationOnce(async (...args) => {
        await new Promise<void>(resolve => { release = resolve; }); await original(...args);
      });
      const pending = f.pin();
      await vi.advanceTimersByTimeAsync(4000);
      expect((await pending).result.displayError).toContain('Select Retry');
      expect(f.records.size).toBe(1);
      await f.command('remove', { key: f.input.key });
      release(); await vi.advanceTimersByTimeAsync(0);
      expect(f.visible.size).toBe(0); expect(f.records.size).toBe(0);
      expect(f.self.registration.showNotification).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it('does not close a successful retry when an earlier display completes late', async () => {
    vi.useFakeTimers();
    try {
      const f = await fixture();
      let release!: () => void;
      const original = f.self.registration.showNotification.getMockImplementation()!;
      f.self.registration.showNotification.mockImplementationOnce(async (...args) => {
        await new Promise<void>(resolve => { release = resolve; }); await original(...args);
      });
      const pending = f.pin(); await vi.advanceTimersByTimeAsync(4000); await pending;
      await f.command('retry', { key: f.input.key });
      const restored = [...f.visible.values()][0];
      release(); await vi.advanceTimersByTimeAsync(0);
      expect([...f.visible.values()]).toEqual([restored]);
      expect([...f.records.values()][0].displayError).toBeUndefined();
      expect(f.self.registration.showNotification).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
  it('keeps notification operations available while a clicked window cannot open', async () => {
    const f = await fixture(); await f.pin();
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    f.self.clients.openWindow.mockImplementationOnce(async () => {
      entered(); await new Promise<void>(resolve => { release = resolve; }); return {};
    });
    const pending = f.fire('notificationclick', { notification: [...f.visible.values()][0] });
    await started;
    try {
      expect((await f.command('remove', { key: f.input.key })).error).toBeUndefined();
      expect(f.records.size).toBe(0); expect(f.visible.size).toBe(0);
    } finally { release(); await pending; }
  });
  it('restores repeated dismissals silently from saved state without duplicating notifications', async () => {
    const f = await fixture(); expect((await f.pin()).error).toBeUndefined();
    await f.dismiss(); await f.dismiss();
    expect(f.visible.size).toBe(1); expect(f.records.size).toBe(1);
    expect(f.self.registration.showNotification).toHaveBeenCalledTimes(3);
    expect([...f.visible.values()][0]).toMatchObject({ title: f.input.title, silent: true, renotify: false, requireInteraction: true });
  });
  it('survives browser cleanup after the close event completes', async () => {
    const f = await fixture(); await f.pin();
    for (let i = 0; i < 3; i++) {
      const dismissed = [...f.visible.values()][0];
      await f.dismiss();
      f.visible.delete(dismissed.tag);
      expect(f.visible.size).toBe(1);
      expect(f.records.size).toBe(1);
    }
    await f.command('remove', { key: f.input.key });
    expect(f.visible.size).toBe(0);
  });
  it('ignores a repeated close event after restoring the same pin', async () => {
    const f = await fixture(); await f.pin();
    const dismissed = [...f.visible.values()][0];
    await f.dismiss();
    const restored = [...f.visible.values()][0];
    await f.fire('notificationclose', { notification: dismissed });
    expect([...f.visible.values()]).toEqual([restored]);
    expect(f.self.registration.showNotification).toHaveBeenCalledTimes(2);
    await f.command('reconcile');
    expect([...f.visible.values()]).toEqual([restored]);
  });
  it('retains and removes pins displayed by older workers', async () => {
    const f = await fixture(); await f.pin();
    const notification = [...f.visible.values()][0];
    f.visible.clear();
    notification.tag = 'herts-plugin:sample:0:conversation';
    notification.close = vi.fn(() => { f.visible.delete(notification.tag); });
    f.visible.set(notification.tag, notification);
    await f.command('reconcile');
    expect([...f.visible.values()]).toEqual([notification]);
    await f.command('remove', { key: f.input.key });
    expect(f.visible.size).toBe(0);
  });
  it('explicit retry replaces a stale browser notification without changing the saved pin', async () => {
    const f = await fixture(); const pin = (await f.pin()).result;
    const previous = [...f.visible.values()][0];
    await f.command('retry', { key: f.input.key });
    expect(f.visible.size).toBe(1);
    expect([...f.visible.values()][0].tag).not.toBe(previous.tag);
    expect([...f.records.values()][0]).toEqual(pin);
    expect(previous.close).toHaveBeenCalledOnce();
  });
  it('foreground reconciliation replaces stale display state without changing saved pins', async () => {
    const f = await fixture(); const pin = (await f.pin()).result;
    const previous = [...f.visible.values()][0];
    await f.command('reconcile', { redisplay: true });
    expect(f.visible.size).toBe(1);
    expect([...f.visible.values()][0].tag).not.toBe(previous.tag);
    expect([...f.records.values()][0]).toEqual(pin);
    expect(previous.close).toHaveBeenCalledOnce();
  });
  it('saves a record after display failure and permits explicit recovery', async () => {
    const f = await fixture(); f.self.registration.showNotification.mockRejectedValueOnce(new Error('Unavailable'));
    const first = await f.pin(); expect(first.result.displayError).toContain('could not be shown'); expect(f.records.size).toBe(1);
    await f.command('retry', { key: f.input.key });
    expect([...f.records.values()][0].displayError).toBeUndefined(); expect(f.visible.size).toBe(1);
  });
  it('recovers when the browser acknowledges a replacement without retaining its display', async () => {
    const f = await fixture(); const saved = (await f.pin()).result;
    f.self.registration.showNotification.mockResolvedValueOnce(undefined);
    await f.command('reconcile', { redisplay: true });
    expect(f.visible.size).toBe(1);
    expect([...f.records.values()][0]).toEqual(saved);
    expect(f.self.registration.showNotification).toHaveBeenCalledTimes(3);
  });
  it('limits display recovery and retains the pin for an explicit retry', async () => {
    const f = await fixture(); const saved = (await f.pin()).result;
    f.self.registration.showNotification.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
    await f.command('reconcile', { redisplay: true });
    expect(f.visible.size).toBe(0);
    expect([...f.records.values()][0]).toMatchObject({ ...saved, displayError: expect.stringContaining('Select Retry') });
    expect(f.self.registration.showNotification).toHaveBeenCalledTimes(4);
    await f.command('retry', { key: f.input.key });
    expect(f.visible.size).toBe(1);
    expect([...f.records.values()][0]).toEqual(saved);
  });
  it('removes a notification after a delayed dismissal restore and rejects a stale title update', async () => {
    const f = await fixture(), saved = (await f.pin()).result;
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const original = f.self.registration.showNotification.getMockImplementation()!;
    f.self.registration.showNotification.mockImplementationOnce(async (...args) => { entered(); await new Promise<void>(resolve => { release = resolve; }); await original(...args); });
    const closing = f.dismiss(); await started;
    const removal = f.command('remove', { key: f.input.key });
    release(); await closing; await removal;
    expect(f.visible.size).toBe(0); expect(f.records.size).toBe(0);
    expect((await f.command('set', { input: { ...f.input, title: 'Late rename' }, expectedRevision: saved.revision })).error).toContain('changed');
    expect(f.visible.size).toBe(0);
  });
  it('closes disabled notifications, retains their records, and restores after re-enable', async () => {
    const f = await fixture(); await f.pin();
    const old = [...f.visible.values()][0];
    f.catalogue.entries[0].enabled = false;
    await f.command('reconcile'); await f.fire('notificationclose', { notification: old });
    expect(f.visible.size).toBe(0); expect(f.records.size).toBe(1);
    f.catalogue.entries[0].enabled = true; await f.command('reconcile'); expect(f.visible.size).toBe(1);
    f.catalogue.entries[0].generation = 1; await f.command('reconcile');
    await f.fire('notificationclose', { notification: old }); expect(f.visible.size).toBe(0);
    expect((await f.pin()).error).toContain('plugin changed');
  });
  it('checks lifecycle changes that commit during notification display', async () => {
    const f = await fixture(), original = f.self.registration.showNotification.getMockImplementation()!;
    f.self.registration.showNotification.mockImplementationOnce(async (...args) => { await original(...args); f.catalogue.entries[0].enabled = false; });
    await f.pin(); expect(f.visible.size).toBe(0); expect(f.records.size).toBe(1);
  });
  it('keeps a pin after navigation and leaves unrelated notifications untouched', async () => {
    const f = await fixture(); await f.pin();
    const notification = [...f.visible.values()][0];
    await f.fire('notificationclick', { notification });
    expect(f.self.clients.openWindow).toHaveBeenCalledWith('/#/conversation/synthetic');
    f.visible.delete(notification.tag);
    expect(f.visible.size).toBe(1); expect(f.records.size).toBe(1);
    const close = vi.fn(); f.visible.set('other', { tag: 'other', data: { kind: 'reminder' }, close });
    await f.command('remove', { key: f.input.key }); expect(close).not.toHaveBeenCalled();
    await f.fire('notificationclose', { notification }); expect(f.visible.size).toBe(1);
  });
  it('preserves records across package updates and blocks previous package handles', async () => {
    const f = await fixture(); await f.pin(); f.catalogue.entries[0].hash = 'next';
    expect((await f.command('remove', { key: f.input.key })).error).toContain('plugin changed');
    await f.dismiss(); expect(f.visible.size).toBe(1);
  });
  it.each(['https://other.example', '//other.example/path', '/conversation/a#fragment', '/conversation/a?query=1', '/conversation/a\\b', '/conversation/a\n'])('rejects an unsafe destination: %j', async route => {
    expect(deviceNotificationRoute(route)).toBe(false);
    const f = await fixture(); expect((await f.command('set', { input: { ...f.input, route }, expectedRevision: null })).error).toContain('Invalid');
    expect(f.records.size).toBe(0);
  });
});
