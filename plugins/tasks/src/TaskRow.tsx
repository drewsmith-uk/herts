import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { AlarmClock, ArrowDown, ArrowUp, Check, Circle } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Task } from './model';
import { moveTask, renameTask, useApp } from './data';
import { holdListeners, useTaskInteractions } from './TaskDragging';
import { useUpdatePreparation, useUpdateWork, ItemRow, ItemMeta, IconButton } from '@herts/plugin-api/client';
const time = (at: number) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(at);
export function TaskRow({ task, edit, index, tasks }: {
    task: Task;
    edit: boolean;
    index: number;
    tasks: Task[];
}) {
    const ordered = !['done', 'snoozed'].includes(task.status);
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, disabled: { droppable: !ordered } });
    const { activeTask, snooze } = useTaskInteractions();
    const [text, setText] = useState(task.title), [offset, setOffset] = useState(0);
    const state = useApp();
    const savingTitle = useUpdateWork();
    useUpdatePreparation({ blocked: () => edit && text.trim() !== task.title ? 'The task title is still being saved. Please try updating again after it is saved.' : undefined });
    const action = state.actions.find(a => !a.cancelled && a.taskId === (task.contextId || task.id) && ['send', 'continue'].includes(a.kind));
    const gesture = useRef<{
        id: number;
        x: number;
        y: number;
        dx: number;
        horizontal: boolean;
        threshold: number;
    } | undefined>(undefined);
    const suppressClickUntil = useRef(0);
    useEffect(() => setText(task.title), [task.title]);
    useEffect(() => { if (activeTask) {
        gesture.current = undefined;
        setOffset(0);
        suppressClickUntil.current = Date.now() + 800;
    } }, [activeTask?.id]);
    function down(e: PointerEvent<HTMLDivElement>) {
        // Suppress only the click produced by the previous drag/swipe, never a
        // separate tap that starts a new pointer gesture.
        if (!activeTask)
            suppressClickUntil.current = 0;
        if (task.status !== 'inbox' || edit || activeTask || !e.isPrimary || e.button !== 0 || (e.target as Element).closest('button,input,textarea,select'))
            return;
        gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, horizontal: false, threshold: Math.min(90, e.currentTarget.clientWidth * .25) };
    }
    function move(e: PointerEvent<HTMLDivElement>) {
        const g = gesture.current;
        if (!g || g.id !== e.pointerId || activeTask)
            return;
        const dx = e.clientX - g.x, dy = e.clientY - g.y;
        if (!g.horizontal) {
            if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) {
                gesture.current = undefined;
                return;
            }
            if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.4)
                return;
            g.horizontal = true;
            e.currentTarget.setPointerCapture(e.pointerId);
        }
        if (e.cancelable)
            e.preventDefault();
        g.dx = dx;
        setOffset(Math.max(-130, Math.min(130, dx)));
    }
    function finish(e: PointerEvent<HTMLDivElement>, cancelled = false) {
        if (activeTask)
            suppressClickUntil.current = Date.now() + 700;
        const g = gesture.current;
        if (!g || g.id !== e.pointerId)
            return;
        gesture.current = undefined;
        setOffset(0);
        if (g.horizontal)
            suppressClickUntil.current = Date.now() + 700;
        if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        if (!cancelled && g.horizontal && Math.abs(g.dx) >= g.threshold && !activeTask)
            snooze(task);
    }
    const pending = state.pending.some(p => p.op.taskId === task.id);
    return <div ref={setNodeRef} className={`task-item ${isDragging ? 'dragging' : ''}`} data-task-id={task.id} style={{ transform: CSS.Transform.toString(transform), transition }} {...attributes} {...holdListeners(listeners)} role="group" aria-label={task.title} aria-roledescription="sortable task" onPointerDown={down} onPointerMove={move} onPointerUp={e => finish(e)} onPointerCancel={e => finish(e, true)} onLostPointerCapture={e => { if (e.target === e.currentTarget)
        finish(e, true); }} onContextMenu={e => { if (!(e.target as Element).closest('input,textarea'))
        e.preventDefault(); }} onDragStart={e => e.preventDefault()} onClickCapture={e => { if (e.detail !== 0 && (activeTask || Date.now() < suppressClickUntil.current)) {
        e.preventDefault();
        e.stopPropagation();
    } }}>
    <div className={`task-swipe-action ${offset < 0 ? 'swipe-left' : ''}`} aria-hidden="true"><AlarmClock size={20}/>Snooze</div>
    <ItemRow className={`task-row ${task.status === 'done' ? 'completed' : ''} ${offset ? 'swiping' : ''}`} style={{ transform: `translateX(${offset}px)` }}
      leading={<IconButton className="completion-button" aria-label={task.status === 'done' ? `Reopen ${task.title}` : `Complete ${task.title}`} onClick={() => void moveTask(task.id, task.status === 'done' ? ['done', 'snoozed'].includes(task.previousStatus) ? 'inbox' : task.previousStatus : 'done')}>{task.status === 'done' ? <Check size={18}/> : <Circle size={21}/>}</IconButton>}
      trailing={<>{action && !['finished', 'failed', 'ready', 'unknown'].includes(action.state) && <span className={`activity-chip ${action.state === 'awaiting_input' ? 'attention' : ''}`}>{action.state === 'awaiting_input' ? 'Needs you' : 'Working'}</span>}
      {edit && ordered && <div className="reorder-controls"><IconButton aria-label={`Move ${task.title} up`} disabled={!index} onClick={() => void moveTask(task.id, task.status, tasks[index - 1].id)}><ArrowUp size={16}/></IconButton><IconButton aria-label={`Move ${task.title} down`} disabled={index === tasks.length - 1} onClick={() => void moveTask(task.id, task.status, tasks[index + 2]?.id || null)}><ArrowDown size={16}/></IconButton></div>}</>}>
      {edit ? <input className="inline-title" aria-label="Edit task title" value={text} onChange={e => setText(e.target.value)} onBlur={() => { if (text.trim() && text.trim() !== task.title)
        void savingTitle(renameTask(task.id, text));
    else
        setText(task.title); }} onKeyDown={e => { if (e.key === 'Enter')
        e.currentTarget.blur(); }}/> : <a href={`#/task/${task.id}`} className="task-title" draggable={false}>{task.title}</a>}
        {(pending || task.completedAt || task.snoozedUntil) && <ItemMeta>{pending && <span>Saved on device</span>}{task.completedAt && <span>{time(task.completedAt)}</span>}{task.snoozedUntil && <span><AlarmClock size={12}/> {time(task.snoozedUntil)}</span>}</ItemMeta>}
    </ItemRow>
  </div>;
}
