import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { prepareForUpdate } from './updateSafety';

const pageVersion = document.querySelector<HTMLMetaElement>('meta[name="herts-build"]')?.content;
type Update = { worker: ServiceWorker; version?: string };
type UpdateControls = { available: boolean; busy: boolean; checking: boolean; message: string; checkError: string; check: () => Promise<void>; apply: () => Promise<void> };
const UpdateContext = createContext<UpdateControls | undefined>(undefined);
const supported = () => import.meta.env.PROD && 'serviceWorker' in navigator;

async function installation(worker: ServiceWorker | null) {
  if (!worker) return;
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => { clearTimeout(timer); worker.removeEventListener('statechange', changed); error ? reject(error) : resolve(); };
    const changed = () => {
      if (['installed', 'activating', 'activated'].includes(worker.state)) finish();
      else if (worker.state === 'redundant') finish(new Error('The update could not be downloaded. Please try again.'));
    };
    const timer = setTimeout(() => finish(new Error('The update is still downloading. Please check again in a moment.')), 15_000);
    worker.addEventListener('statechange', changed); changed();
  });
}

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

export function AppUpdates({ children }: { children: ReactNode }) {
  const [update, setUpdate] = useState<Update>(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [toastDismissed, setToastDismissed] = useState(false), [manualChecking, setManualChecking] = useState(false), [message, setMessage] = useState(''), [checkError, setCheckError] = useState('');
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined), dismissed = useRef(new Set<string | ServiceWorker>()), applying = useRef(false);
  const checkNow = useRef<() => Promise<boolean>>(async () => { throw new Error('Update checks are not ready yet. Please try again.'); });
  const manualInFlight = useRef(false);
  useEffect(() => {
    if (!supported()) return;
    let alive = true, checking: Promise<void> | undefined, registered = false, controllerChanged = false, lastCheck = 0, inspection = 0;
    const workers = new Set<ServiceWorker>();
    async function inspect(manual = false): Promise<{ available: boolean; version?: string } | undefined> {
      const serial = ++inspection, reg = registration.current;
      const worker = reg?.waiting || reg?.active;
      if (!worker) return;
      const version = await workerVersion(worker);
      if (!alive) return;
      if (worker !== (reg?.waiting || reg?.active)) return manual ? inspect(true) : undefined;
      if (serial !== inspection && !manual) return;
      // An unknown legacy worker only needs activation if it is waiting.
      // First installations and already-current pages need no toast.
      const available = version ? !!pageVersion && ((version !== pageVersion && (worker === reg?.waiting || controllerChanged || manual)) || (manual && worker === reg?.waiting)) : worker === reg?.waiting;
      setUpdate(available ? { worker, version } : undefined);
      setToastDismissed(dismissed.current.has(version || worker));
      return { available, version };
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
    function check(force = false, manual = false): Promise<void> {
      if (checking) return checking;
      if (!alive || (document.hidden && !manual) || !navigator.onLine || (!force && Date.now() - lastCheck < 60_000)) return Promise.resolve();
      lastCheck = Date.now();
      checking = (async () => {
        try {
          if (!registered) { observe(await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })); registered = true; }
          else await registration.current?.update();
          await installation(registration.current?.installing || null);
        } finally { checking = undefined; if (alive) watchInstalling(); }
      })();
      return checking;
    }
    // Automatic failures stay quiet. Explicit checks must report an uncertain
    // result instead of claiming the installed version is current.
    const automatic = (force = false) => { void check(force).catch(() => {}); };
    checkNow.current = async () => {
      if (!navigator.onLine) throw new Error('You are offline. Connect to check for updates.');
      await check(true, true);
      dismissed.current.clear();
      const result = await inspect(true);
      if (!result || (!result.available && result.version !== pageVersion)) throw new Error('The latest version could not be verified. Please try again.');
      return result.available;
    };
    const foreground = () => { if (!document.hidden) { void inspect(); automatic(); } };
    const online = () => { automatic(true); };
    void navigator.serviceWorker.getRegistration().then(reg => { if (reg) observe(reg); }).catch(() => {}).finally(() => automatic(true));
    navigator.serviceWorker.addEventListener('controllerchange', changed);
    window.addEventListener('focus', foreground);
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', foreground);
    const interval = setInterval(() => automatic(), 15 * 60_000);
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

  async function manualCheck() {
    if (manualInFlight.current || applying.current) return;
    manualInFlight.current = true; setManualChecking(true); setMessage(''); setCheckError('');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const available = await Promise.race([checkNow.current(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Could not reach the update server. Check your connection and try again.')), 20_000); })]);
      setMessage(available ? 'An update is ready to install.' : 'Herts is up to date.');
    } catch (e) {
      setCheckError(e instanceof Error && /^(You are offline|The update|The latest version|Update checks|Could not reach)/.test(e.message) ? e.message : 'Could not check for updates. Check your connection, including Tailscale, and try again.');
    } finally { clearTimeout(timer); manualInFlight.current = false; setManualChecking(false); }
  }

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
  const showToast = (update && !toastDismissed) || busy || error;
  return <UpdateContext.Provider value={{ available: !!update, busy, checking: manualChecking, message, checkError, check: manualCheck, apply }}>
    {children}
    {showToast && <section className="update-toast" aria-label="App update">
    <div className="update-toast-message" role="status"><RefreshCw size={18} className={busy ? 'spin' : ''}/><div><strong>{busy ? 'Updating Herts…' : 'Update available'}</strong><p>{busy ? 'Saving your changes and reloading.' : 'A new version of Herts is ready.'}</p></div></div>
    {error && <p role="alert" className="update-toast-error">{error}</p>}
    <div className="button-row"><button type="button" className="primary-button" disabled={busy} onClick={() => void apply()}>Update now</button><button type="button" disabled={busy} onClick={() => { if (update) dismissed.current.add(update.version || update.worker); setToastDismissed(true); setError(''); }}>Later</button></div>
  </section>}
  </UpdateContext.Provider>;
}

export function AppUpdateSettings() {
  const controls = useContext(UpdateContext);
  if (!controls) return null;
  return <section className="settings-card app-update-settings" aria-labelledby="app-updates-heading"><div className="settings-icon"><RefreshCw size={22}/></div><div>
    <h2 id="app-updates-heading">App updates</h2>
    {pageVersion && <p className="subtle-note">App version: {pageVersion.replace(/^tasks-shell-/, '')}</p>}
    <p role="status">{controls.checking ? 'Checking for updates…' : controls.available ? 'An update is ready to install.' : controls.message || 'Herts checks automatically when you open or return to the app.'}</p>
    {controls.checkError && <p role="alert">{controls.checkError}</p>}
    <div className="button-row"><button disabled={!supported() || controls.checking || controls.busy} onClick={() => void controls.check()}>Check for updates</button>{controls.available && <button className="primary-button" disabled={controls.checking || controls.busy} onClick={() => void controls.apply()}>Update now</button>}</div>
    <p className="subtle-note">Android’s launcher name, icon and shortcuts update separately through Chrome.</p>
    {!supported() && <p>Update checks are available in the installed or hosted app on a supported browser.</p>}
  </div></section>;
}
