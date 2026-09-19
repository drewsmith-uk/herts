import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { api } from './data';
import { replaceRoute } from './notificationNavigation';
import { currentPath } from './useRoute';

export function NotificationLanding({ id, online }: { id: string; online: boolean }) {
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!online) return;
    let active = true;
    setError('');
    void api(`/notifications/${id}`, undefined, 'GET', 15_000).then(result => {
      // Another tap or manual navigation takes precedence over a slow response.
      if (active && currentPath() === `/notice/${id}`) replaceRoute(result.route || `/task/${result.taskId}`);
    }).catch(() => { if (active) setError('This notification could not be opened. You can try again.'); });
    return () => { active = false; };
  }, [id, online, attempt]);
  return <div className="empty" role="status">
    {!error && online && <LoaderCircle className="spin"/>}
    <p>{!online ? 'Waiting for a connection to open this notification…' : error || 'Opening notification…'}</p>
    {error && online && <button onClick={() => setAttempt(n => n + 1)}>Try again</button>}
    <a className="text-link" href="#/conversations">Back to conversations</a>
  </div>;
}
