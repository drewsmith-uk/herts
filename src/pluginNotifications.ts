import { liveQuery } from 'dexie';
import { db, getState } from './data';
import type { DeviceNotification, DeviceNotificationInput } from '../shared/deviceNotifications';
export type { DeviceNotification, DeviceNotificationInput } from '../shared/deviceNotifications';

const updateMessage = 'Update Herts through Settings → App updates to use device notifications.';
async function request<T>(command: string, input: Record<string, unknown> = {}): Promise<T> {
  if (!('serviceWorker' in navigator)) throw new Error('This browser does not support device notifications.');
  await db.open();
  const registration = await navigator.serviceWorker.getRegistration('/');
  const worker = registration?.active;
  if (!worker || worker.scriptURL !== new URL('/sw.js', location.origin).href) throw new Error(updateMessage);
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const finish = () => { clearTimeout(timer); channel.port1.close(); channel.port2.close(); };
    const timer = setTimeout(() => { finish(); reject(new Error('The notification operation was not confirmed. Reload to check its saved state. Update Herts if this continues.')); }, 8000);
    channel.port1.onmessage = event => {
      finish();
      if (event.data?.version !== 1) reject(new Error(updateMessage));
      else if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.result);
    };
    try { worker.postMessage({ type: 'PLUGIN_NOTIFICATIONS', version: 1, command, ...input }, [channel.port2]); }
    catch (error) { finish(); reject(error); }
  });
}

export function pluginNotifications<T = unknown>(pluginId: string) {
  const entry = getState().plugins.entries.find(e => e.manifest.id === pluginId);
  const generation = entry?.generation ?? 0, hash = entry?.hash;
  const prefix = `${pluginId}:${generation}:notification:`;
  function guard() {
    const current = getState().plugins.entries.find(e => e.manifest.id === pluginId);
    if (!current?.enabled || current.generation !== generation || current.hash !== hash) throw new Error('This plugin changed. Reload before changing notifications.');
  }
  async function list(): Promise<DeviceNotification<T>[]> {
    guard();
    const rows = await db.pluginLocal.where('key').startsWith(prefix).toArray();
    guard();
    return rows.map(row => row.value);
  }
  async function run<R>(command: string, input: Record<string, unknown> = {}) {
    guard();
    return request<R>(command, { pluginId, generation, hash, ...input });
  }
  return {
    list,
    async ready() { await run('check'); },
    async requestPermission() {
      if (!('Notification' in window)) return 'unsupported' as const;
      return Notification.permission === 'default' ? Notification.requestPermission() : Notification.permission;
    },
    set(input: DeviceNotificationInput<T>, expectedRevision: string | null) {
      return run<DeviceNotification<T>>('set', { input, expectedRevision });
    },
    remove(key: string) { return run<void>('remove', { key }); },
    retry(key: string) { return run<void>('retry', { key }); },
    watch(next: (rows: DeviceNotification<T>[]) => void, error: (error: unknown) => void) {
      let closed = false, version = 0;
      const refresh = () => { const current = ++version; void list().then(rows => { if (!closed && current === version) next(rows); }, reason => { if (!closed && current === version) error(reason); }); };
      const subscription = liveQuery(() => db.pluginLocal.where('key').startsWith(prefix).toArray()).subscribe({ next: refresh, error });
      const changed = (event: MessageEvent) => { if (workerMessage(event) && event.data?.type === 'PLUGIN_NOTIFICATIONS_CHANGED') refresh(); };
      navigator.serviceWorker?.addEventListener('message', changed);
      window.addEventListener('focus', refresh);
      return () => { closed = true; version++; subscription.unsubscribe(); navigator.serviceWorker?.removeEventListener('message', changed); window.removeEventListener('focus', refresh); };
    },
  };
}

function workerMessage(event: MessageEvent) {
  return event.origin === location.origin && event.source && 'scriptURL' in event.source
    && event.source.scriptURL === new URL('/sw.js', location.origin).href;
}

export function startDeviceNotifications() {
  if (!('serviceWorker' in navigator)) return;
  let running = false, again = false, redisplay = false, started = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined, retryDelay = 1000;
  const refresh = async (force = false) => {
    redisplay ||= force || !started;
    if (document.visibilityState !== 'visible' || !getState().loaded) return;
    if (running) { again = true; return; }
    running = true;
    do {
      again = false;
      const replace = redisplay; redisplay = false;
      try {
        await request('reconcile', { redisplay: replace });
        started = true; retryDelay = 1000; clearTimeout(retryTimer);
      } catch {
        redisplay ||= replace;
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => { void refresh(); }, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30_000);
        break;
      }
    } while (again);
    running = false;
  };
  const catalogue = () => { void refresh(); };
  const foreground = () => { void refresh(true); };
  window.addEventListener('herts-plugin-catalogue', catalogue);
  window.addEventListener('focus', foreground);
  document.addEventListener('visibilitychange', foreground);
  navigator.serviceWorker.addEventListener('controllerchange', foreground);
  void navigator.serviceWorker.ready.then(catalogue).catch(() => {});
  catalogue();
}
