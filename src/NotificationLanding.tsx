import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { api, acceptNotificationDestination } from './data';
import { replaceRoute } from './notificationNavigation';
import { currentPath } from './useRoute';
import { foregroundRead } from './foregroundReads';

export function NotificationLanding({ id, online }: { id: string; online: boolean }) {
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const [available, setAvailable] = useState(navigator.onLine);
  useEffect(() => {
    const changed = () => setAvailable(navigator.onLine);
    window.addEventListener('online', changed); window.addEventListener('offline', changed);
    return () => { window.removeEventListener('online', changed); window.removeEventListener('offline', changed); };
  }, []);
  useEffect(() => { if (online && error) setAttempt(value => value + 1); }, [online]);
  useEffect(() => {
    if (!available) return;
    let active = true;
    const controller = new AbortController();
    setError('');
    void foregroundRead(async () => {
      const result = await api(`/notifications/${id}`, undefined, 'GET', 15_000, controller.signal);
      if (active && currentPath() === `/notice/${id}` && result.destination) await acceptNotificationDestination(result.destination);
      return result;
    }).then(result => {
      // Another tap or manual navigation takes precedence over a slow response.
      if (active && currentPath() === `/notice/${id}`) replaceRoute(result.route || `/task/${result.taskId}`);
    }).catch(() => { if (active) setError('This notification could not be opened. You can try again.'); });
    return () => { active = false; controller.abort(); };
  }, [id, available, attempt]);
  return <div className="empty" role="status">
    {!error && available && <LoaderCircle className="spin"/>}
    <p>{!available ? 'Waiting for a connection to open this notification…' : error || 'Opening notification…'}</p>
    {error && available && <button onClick={() => setAttempt(n => n + 1)}>Try again</button>}
    <a className="text-link" href="#/conversations">Back to conversations</a>
  </div>;
}
