import { AlarmClock } from 'lucide-react';
import { ItemMeta } from '@herts/plugin-api/client';
import { useApp } from './data';
import type { Task } from './model';

const time = (at: number) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(at);
export function TaskMetadata({ task }: { task: Task }) {
    const pending = useApp().pending.some(p => p.op.taskId === task.id);
    if (!pending && !task.completedAt && !task.snoozedUntil) return null;
    return <ItemMeta>{pending && <span>Saved on device</span>}{task.completedAt && <span>{time(task.completedAt)}</span>}{task.snoozedUntil && <span><AlarmClock size={12}/> {time(task.snoozedUntil)}</span>}</ItemMeta>;
}
