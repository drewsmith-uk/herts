import { originalSpaceId, spacePath } from '../shared/model';
import { useEffect, useRef, useState } from 'react';

type Route = { path: string; recordRequest?: string };
export function currentPath() {
  if (location.hash.slice(1)) return location.hash.slice(1);
  const notice = new URLSearchParams(location.search).get('notice');
  return notice ? `/notice/${encodeURIComponent(notice)}` : location.pathname === '/share' ? '/reading/add' : '/tasks';
}

export function useRoute(loaded: boolean, defaultSpaceId: string = originalSpaceId) {
  const targetSpace = useRef(defaultSpaceId); targetSpace.current = defaultSpaceId;
  const [route, setRoute] = useState<Route>(() => ({ path: currentPath() }));
  useEffect(() => {
    const update = () => {
      if (!loaded) return;
      if (currentPath() === '/tasks/inbox/record') {
        // Consume the explicit shortcut before asking for the microphone. Reload,
        // history navigation and app restoration must not repeat the request.
        const url = new URL(location.href);
        url.hash = spacePath(targetSpace.current);
        history.replaceState(history.state, '', url);
        setRoute({ path: spacePath(targetSpace.current), recordRequest: crypto.randomUUID() });
        window.scrollTo({ top: 0, behavior: 'instant' });
      } else setRoute({ path: currentPath() });
    };
    const hidden = () => {
      if (document.hidden) setRoute(current => current.recordRequest ? { path: current.path } : current);
    };
    addEventListener('hashchange', update);
    document.addEventListener('visibilitychange', hidden);
    update();
    return () => { removeEventListener('hashchange', update); document.removeEventListener('visibilitychange', hidden); };
  }, [loaded]);
  return { parts: route.path.split('/').filter(Boolean), recordRequest: route.recordRequest };
}
