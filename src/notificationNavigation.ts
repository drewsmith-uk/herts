import { flushSync } from 'react-dom';

// A notification can change the route without reloading the installed app.
export function replaceRoute(path: string) {
  history.replaceState(history.state, '', `/#${path}`);
  dispatchEvent(new Event('hashchange'));
}

export function installNotificationNavigation() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.origin !== location.origin || !event.source || !('scriptURL' in event.source)
      || event.source.scriptURL !== new URL('/sw.js', location.origin).href
      || event.data?.type !== 'OPEN_NOTIFICATION') return;
    const data = event.data;
    const path = data.kind === 'test' ? '/settings'
      : typeof data.id === 'string' && data.id ? `/notice/${encodeURIComponent(data.id)}` : '/tasks';
    // Commit the notification view before acknowledging readiness to foreground
    // the app. Do not wait for a paint: hidden pages may not receive animation
    // frames. The URL also preserves the intent during slow/offline lookups.
    flushSync(() => replaceRoute(path));
    event.ports[0]?.postMessage({ accepted: true });
  });
}
