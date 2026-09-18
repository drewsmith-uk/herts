import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { prepareForUpdate } from './updateSafety';

const pageVersion = document.querySelector<HTMLMetaElement>('meta[name="herts-build"]')?.content;
type Update = { worker: ServiceWorker; version?: string };

async function workerVersion(worker: ServiceWorker): Promise<string | undefined> {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const finish = (version?: string) => { clearTimeout(timer); channel.port1.close(); channel.port2.close(); resolve(version); };
    const timer = setTimeout(() => finish(), 1500);
    channel.port1.onmessage = event => finish(typeof event.data?.version === 'string' ? event.data.version : undefined);
    try { worker.postMessage({ type: 'GET_VERSION' }, [channel.port2]); } catch { finish(); }
  });
}

async function activate(worker: ServiceWorker) {
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => { clearTimeout(timer); worker.removeEventListener('statechange', changed); error ? reject(error) : resolve(); };
    const changed = () => {
      if (worker.state === 'activated') finish();
      else if (worker.state === 'redundant') finish(new Error('A newer update replaced this one. Please try again.'));
    };
    const timer = setTimeout(() => finish(new Error('The update could not finish. Please try again.')), 15_000);
    worker.addEventListener('statechange', changed);
    try { worker.postMessage({ type: 'ACTIVATE_UPDATE' }); changed(); } catch { finish(new Error('The update is no longer available. Please try again.')); }
  });
}

export function AppUpdates() {
  const [update, setUpdate] = useState<Update>(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined), dismissed = useRef(new Set<string | ServiceWorker>()), applying = useRef(false);
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    let alive = true, checking = false, registered = false, controllerChanged = false, lastCheck = 0, inspection = 0;
    const workers = new Set<ServiceWorker>();
    async function inspect() {
      const serial = ++inspection, reg = registration.current;
      const worker = reg?.waiting || reg?.active;
      if (!worker) return;
      const version = await workerVersion(worker);
      if (!alive || serial !== inspection) return;
      // An unknown legacy worker only needs activation if it is waiting.
      // First installations and already-current pages need no toast.
      const available = version ? !!pageVersion && version !== pageVersion && (worker === reg?.waiting || controllerChanged) : worker === reg?.waiting;
      setUpdate(available && !dismissed.current.has(version || worker) ? { worker, version } : undefined);
    }
    function watchInstalling() {
      const worker = registration.current?.installing;
      if (worker && !workers.has(worker)) { workers.add(worker); worker.addEventListener('statechange', changed); }
      void inspect();
    }
    function changed(event: Event) { if (event.type === 'controllerchange') controllerChanged = true; void inspect(); }
    function observe(reg: ServiceWorkerRegistration) {
      if (!alive) return;
      if (registration.current !== reg) {
        registration.current?.removeEventListener('updatefound', watchInstalling);
        registration.current = reg;
        reg.addEventListener('updatefound', watchInstalling);
      }
      watchInstalling();
    }
    async function check(force = false) {
      if (!alive || checking || document.hidden || !navigator.onLine || (!force && Date.now() - lastCheck < 60_000)) return;
      checking = true; lastCheck = Date.now();
      try {
        if (!registered) { observe(await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })); registered = true; }
        else await registration.current?.update();
      } catch { /* Offline/Tailscale unavailable: keep the current app and retry later. */ }
      finally { checking = false; if (alive) { watchInstalling(); } }
    }
    const foreground = () => { if (!document.hidden) { void inspect(); void check(); } };
    const online = () => { void check(true); };
    void navigator.serviceWorker.getRegistration().then(reg => { if (reg) observe(reg); }).catch(() => {}).finally(() => { void check(true); });
    navigator.serviceWorker.addEventListener('controllerchange', changed);
    window.addEventListener('focus', foreground);
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', foreground);
    const interval = setInterval(() => { void check(); }, 15 * 60_000);
    return () => {
      alive = false; clearInterval(interval);
      registration.current?.removeEventListener('updatefound', watchInstalling);
      workers.forEach(worker => worker.removeEventListener('statechange', changed));
      navigator.serviceWorker.removeEventListener('controllerchange', changed);
      window.removeEventListener('focus', foreground);
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', foreground);
    };
  }, []);

  async function apply() {
    if (applying.current) return;
    applying.current = true; setBusy(true); setError('');
    const shell = document.querySelector<HTMLElement>('.app-shell');
    try {
      // Avoid new keystrokes while forms and attachments are being saved.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      if (shell) shell.inert = true;
      await prepareForUpdate();
      const reg = registration.current;
      if (reg?.waiting) await activate(reg.waiting);
      else if (!reg?.active || (await workerVersion(reg.active)) === pageVersion) throw new Error('The update is no longer available. Please try again when it appears.');
      // Only this deliberate click reloads. Other tabs and notification repair
      // may activate a worker; their controllerchange must never discard input.
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The update could not finish. Please try again.');
      setBusy(false); applying.current = false;
      if (shell) shell.inert = false;
    }
  }
  if (!update && !busy && !error) return null;
  return <section className="update-toast" aria-label="App update">
    <div className="update-toast-message" role="status"><RefreshCw size={18} className={busy ? 'spin' : ''}/><div><strong>{busy ? 'Updating Herts…' : 'Update available'}</strong><p>{busy ? 'Saving your changes and reloading.' : 'A new version of Herts is ready.'}</p></div></div>
    {error && <p role="alert" className="update-toast-error">{error}</p>}
    <div className="button-row"><button type="button" className="primary-button" disabled={busy} onClick={() => void apply()}>Update now</button><button type="button" disabled={busy} onClick={() => { if (update) dismissed.current.add(update.version || update.worker); setUpdate(undefined); setError(''); }}>Later</button></div>
  </section>;
}
