import { useEffect, useState } from 'react';
import { observeConversation, readConversationActivity } from './data';

export function useConversationActivity(contextId: string, enabled: boolean) {
  const [checked, setChecked] = useState(''), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    setChecked(''); setError('');
    const stopObserving = observeConversation(contextId);
    let controller: AbortController | undefined, closed = false;
    const refresh = async (priority = false) => {
      if (closed || controller || document.hidden || !navigator.onLine) return;
      const request = new AbortController(); controller = request;
      try {
        await readConversationActivity(contextId, request.signal, priority);
        if (!closed && !request.signal.aborted) { setChecked(contextId); setError(''); }
      } catch {
        if (!closed && !request.signal.aborted) { setChecked(''); setError('Conversation status is unavailable. Reconnect or select Retry.'); }
      } finally { if (controller === request) controller = undefined; }
    };
    const changed = () => { void refresh(); };
    const recover = () => { controller?.abort(); controller = undefined; setChecked(''); void refresh(true); };
    const offline = () => { controller?.abort(); controller = undefined; setChecked(''); };
    void refresh(true);
    const timer = setInterval(() => void refresh(), 4000);
    window.addEventListener('herts-activity', changed); window.addEventListener('online', recover);
    window.addEventListener('pageshow', recover); window.addEventListener('offline', offline);
    window.addEventListener('focus', recover);
    document.addEventListener('visibilitychange', recover);
    return () => {
      closed = true; controller?.abort(); clearInterval(timer); stopObserving();
      window.removeEventListener('herts-activity', changed); window.removeEventListener('online', recover);
      window.removeEventListener('pageshow', recover); window.removeEventListener('offline', offline);
      window.removeEventListener('focus', recover);
      document.removeEventListener('visibilitychange', recover);
    };
  }, [contextId, enabled, attempt]);
  return { ready: !enabled || checked === contextId, error: enabled ? error : '', retry: () => setAttempt(value => value + 1) };
}
