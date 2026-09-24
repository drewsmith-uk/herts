import { SettingsSection } from './ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { api, useApp } from './data';
import type { PushStatus, PushTest } from '../shared/notifications';

const request = (path: string, body?: unknown) => api(`/notifications${path}`, body, undefined, 15_000);
const supported = () => 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
const decodeKey = (key: string) => Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
function keyMatches(sub: PushSubscription, key: string) {
  if (!sub.options.applicationServerKey) return true;
  const current = new Uint8Array(sub.options.applicationServerKey), wanted = decodeKey(key);
  return current.length === wanted.length && current.every((value, index) => value === wanted[index]);
}
async function readyWorker() {
  await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
  const registration = await navigator.serviceWorker.ready;
  // The test needs the current worker's test notification and acknowledgement
  // handler, even if another app window still has the previous release open.
  await registration.update();
  const worker = registration.installing || registration.waiting;
  if (worker) await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { worker.removeEventListener('statechange', changed); reject(new Error('The notification update is still installing. Try again in a moment.')); }, 10_000);
    function changed() {
      if (worker!.state === 'installed') worker!.postMessage({ type: 'ACTIVATE_UPDATE' });
      if (worker!.state === 'activated' || worker!.state === 'redundant') { clearTimeout(timer); worker!.removeEventListener('statechange', changed); resolve(); }
    }
    worker.addEventListener('statechange', changed); changed();
  });
  return registration;
}
type View = { kind: 'checking' | 'unsupported' | 'blocked' | 'off' | 'repair' | 'enabled' | 'unknown'; subscribed?: boolean; error?: string };
const testKey = 'tasks:last-notification-test';
function savedTest(): { id: string; at: number } | undefined {
  try { const test = JSON.parse(localStorage.getItem(testKey) || 'null'); return test && typeof test.id === 'string' && typeof test.at === 'number' ? test : undefined; } catch { return undefined; }
}

export function NotificationSettings() {
  const { online, pushKey } = useApp(), [view, setView] = useState<View>({ kind: 'checking' }), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [lastTest, setLastTest] = useState(savedTest), [test, setTest] = useState<PushTest>(), [waiting, setWaiting] = useState(false);
  const checking = useRef(false), operating = useRef(false), checkVersion = useRef(0);
  const check = useCallback(async () => {
    if (checking.current || operating.current) return;
    checking.current = true; const version = ++checkVersion.current;
    const update = (next: View) => { if (version === checkVersion.current && !operating.current) setView(next); };
    try {
      if (!supported()) { update({ kind: 'unsupported' }); return; }
      const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
      if (Notification.permission === 'denied') { update({ kind: 'blocked', subscribed: !!sub }); return; }
      if (!sub) { update({ kind: 'off' }); return; }
      if (!online || !pushKey) { update({ kind: 'unknown', subscribed: true }); return; }
      if (Notification.permission !== 'granted' || !keyMatches(sub, pushKey) || (sub.expirationTime && sub.expirationTime <= Date.now())) { update({ kind: 'repair', subscribed: true }); return; }
      const health: PushStatus = await request('/status', { endpoint: sub.endpoint });
      update({ kind: health.registered && !health.needsRepair ? 'enabled' : 'repair', subscribed: true, error: health.error });
    } catch { update({ kind: 'unknown', error: 'Could not verify this device’s notification registration. Try again when connected.' }); }
    finally { if (version === checkVersion.current) checking.current = false; }
  }, [online, pushKey]);
  useEffect(() => {
    void check();
    const visible = () => { if (document.visibilityState === 'visible') void check(); };
    window.addEventListener('focus', visible); document.addEventListener('visibilitychange', visible);
    const timer = setInterval(visible, 15_000);
    return () => { clearInterval(timer); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible); };
  }, [check]);
  useEffect(() => {
    if (!lastTest || !online) return;
    let cancelled = false, polling = false;
    const poll = async () => {
      if (polling) return; polling = true;
      try { const result: PushTest = await request(`/tests/${encodeURIComponent(lastTest.id)}`); if (!cancelled) { setTest(result); setWaiting(!result.shownAt && result.state !== 'failed' && Date.now() - lastTest.at < 20_000); } }
      catch { if (!cancelled) setWaiting(false); } finally { polling = false; }
    };
    void poll(); const timer = setInterval(() => { if (Date.now() - lastTest.at < 120_000) void poll(); }, 1500);
    return () => { cancelled = true; clearInterval(timer); };
  }, [lastTest, online]);
  async function run(action: () => Promise<void>) {
    if (operating.current) return;
    operating.current = true; checkVersion.current++; checking.current = false; setBusy(true); setMessage('');
    try { await action(); } catch (e) { setMessage((e as Error).message); }
    finally { operating.current = false; setBusy(false); void check(); }
  }
  async function enable() {
    if (Notification.permission !== 'granted' && await Notification.requestPermission() !== 'granted') throw new Error('Notifications are blocked. Allow them in your browser’s site settings, then try again.');
    const registration = await readyWorker(), old = await registration.pushManager.getSubscription();
    if (old) {
      await request('/unsubscribe', { endpoint: old.endpoint });
      await old.unsubscribe();
      if (await registration.pushManager.getSubscription()) throw new Error('The browser could not replace this notification registration. Close and reopen the app, then try Repair notifications again.');
    }
    const sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(pushKey) });
    await request('/subscribe', sub.toJSON());
    setLastTest(undefined); setTest(undefined); try { localStorage.removeItem(testKey); } catch { /* Optional diagnostic history. */ }
    setMessage('Notifications are registered. Send a test to check delivery on this device.');
  }
  async function disable() {
    const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
    if (sub) {
      await request('/unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe();
      if (await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription()) throw new Error('Notifications are off on the server, but the browser could not clear its registration. Try turning them off again.');
    }
    setTest(undefined); setLastTest(undefined); try { localStorage.removeItem(testKey); } catch { /* Optional diagnostic history. */ }
    setMessage('Notifications are off on this device.');
  }
  async function sendTest() {
    const registration = await readyWorker(), sub = await registration.pushManager.getSubscription();
    if (!sub) throw new Error('Enable notifications on this device first.');
    const saved = { id: crypto.randomUUID(), at: Date.now() };
    try { localStorage.setItem(testKey, JSON.stringify(saved)); } catch { /* A test can still run without diagnostic history. */ }
    setTest(undefined); setLastTest(saved); setWaiting(true);
    const result: PushTest = await request('/test', { endpoint: sub.endpoint, id: saved.id });
    setTest(result); setWaiting(!result.shownAt && result.state !== 'failed');
  }
  const descriptions: Record<View['kind'], string> = {
    checking: 'Checking this device’s notification registration…',
    unsupported: 'This browser does not support web push. Use the installed app in a supported browser.',
    blocked: 'Notifications are blocked in this browser. Allow them in the browser’s site settings to enable reminders.',
    off: 'Notifications are off on this device.',
    repair: 'Notifications need repair. The browser’s saved registration is not connected to the server.',
    enabled: view.error ? 'Notifications are registered, but the last delivery failed.' : 'Notifications are registered on this device.',
    unknown: 'Notification registration could not be verified. Connect to the app to check it.'
  };
  const disabled = !online || !pushKey || busy || view.kind === 'checking';
  const currentStatus = [descriptions[view.kind], view.error].filter(Boolean).join(' ');
  return <SettingsSection title="Notifications on this device" icon={<Bell size={22}/>} description="Approval requests, completed work and failures for conversations you send messages to in Herts, plus reminders from enabled plugins.">
    <p className="subtle-note">Alerts include the conversation or item title. Open the app to view the details.</p>
    <p role="status">{currentStatus}</p>
    <div className="notification-actions">
      {['off', 'repair'].includes(view.kind) && <button disabled={disabled} onClick={() => void run(enable)}>{view.kind === 'repair' ? 'Repair notifications' : 'Enable notifications'}</button>}
      {view.kind === 'enabled' && <button disabled={disabled} onClick={() => void run(sendTest)}>Send test notification</button>}
      {view.subscribed && <button disabled={disabled} onClick={() => void run(disable)}>Turn off notifications</button>}
      {view.kind === 'unknown' && <button disabled={!online || busy} onClick={() => void check()}>Check again</button>}
    </div>
    {message && message !== currentStatus && <p role="status">{message}</p>}
    {lastTest && <p role="status">{test?.shownAt ? 'This device confirmed showing the test notification.' : test?.state === 'failed' ? test.error : waiting ? test?.state === 'accepted' ? 'Test accepted by the push service. Waiting for this device to confirm showing it…' : 'Waiting for the test result…' : test?.state === 'accepted' ? 'The push service accepted the test, but this device has not confirmed showing it. Check Android’s app/browser notification settings and Do Not Disturb.' : 'Test delivery is unconfirmed. It will not be sent again automatically.'}</p>}
  </SettingsSection>;
}
