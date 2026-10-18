import { DragPreview, useHoldSensors, useDragClickGuard } from '@herts/plugin-api/client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { DndContext, DragOverlay, useDroppable, closestCenter, type CollisionDetection, type DragEndEvent } from '@dnd-kit/core';
import { labels, taskSpaceId, spaceLists, spacePath, type Status, type Task } from './model';
import { moveTask, useApp } from './data';
import { TaskMetadata } from './TaskMetadata';
import { SnoozeDialog } from './SnoozeDialog';
export { useHoldSensors, useDragClickGuard, holdListeners } from '@herts/plugin-api/client';
const Interactions = createContext<{
    snooze: (task: Task) => void;
    activeTask?: Task;
}>({ snooze: () => { } });
export const useTaskInteractions = () => useContext(Interactions);
const collision: CollisionDetection = args => {
    if (args.pointerCoordinates) {
        const p = args.pointerCoordinates;
        // Sticky tabs do not move with the document. Read their actual viewport
        // bounds instead of using rectangles adjusted by the page scroll delta.
        const list = args.droppableContainers.find(c => {
            if (c.data.current?.kind !== 'task-list')
                return false;
            const r = c.node.current?.getBoundingClientRect();
            const clip = c.node.current?.closest('[data-task-drop-scroll]')?.getBoundingClientRect();
            if (clip && (p.x < clip.left || p.x > clip.right || p.y < clip.top || p.y > clip.bottom))
                return false;
            return r && r.width > 0 && r.height > 0 && p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
        });
        if (list)
            return [{ id: list.id }];
        // Keep the scroll container active over gaps between space tabs. Otherwise
        // dnd-kit falls back to the task row and edge scrolling stops in each gap.
        // This surface is only for scrolling; releasing here does not move a task.
        const surface = args.droppableContainers.find(c => {
            if (c.data.current?.kind !== 'scroll-surface')
                return false;
            const r = c.node.current?.closest('[data-task-drop-scroll]')?.getBoundingClientRect();
            return r && p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
        });
        if (surface)
            return [{ id: surface.id }];
        const bounds = document.querySelector('.task-list')?.getBoundingClientRect();
        if (!bounds || p.x < bounds.left || p.x > bounds.right || p.y < bounds.top || p.y > bounds.bottom)
            return [];
    }
    return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter(c => !['task-list', 'scroll-surface'].includes(c.data.current?.kind)) });
};
export function TaskDragging({ children }: {
    children: ReactNode;
}) {
    const { snapshot } = useApp(), sensors = useHoldSensors(), clickGuard = useDragClickGuard();
    const [activeId, setActiveId] = useState<string>(), [snoozing, setSnoozing] = useState<Task>();
    const activeTask = snapshot.tasks.find(t => t.id === activeId);
    useEffect(() => { const close = () => setSnoozing(undefined); window.addEventListener('hashchange', close); return () => window.removeEventListener('hashchange', close); }, []);
    function end({ active, over }: DragEndEvent) {
        clickGuard.end();
        setActiveId(undefined);
        const task = snapshot.tasks.find(t => t.id === active.id);
        if (!task || !over || active.id === over.id)
            return;
        const target = over.data.current;
        if (target?.kind === 'task-list') {
            if (target.status === task.status && target.spaceId === taskSpaceId(task))
                return;
            if (target.status === 'snoozed') {
                if (task.status === 'inbox')
                    setSnoozing(task);
                return;
            }
            void moveTask(task.id, target.status, undefined, target.spaceId);
            return;
        }
        if (['done', 'snoozed'].includes(task.status))
            return;
        const ids = spaceLists(snapshot, taskSpaceId(task))[task.status].ids, from = ids.indexOf(task.id), to = ids.indexOf(String(over.id));
        if (from < 0 || to < 0)
            return;
        void moveTask(task.id, task.status, from < to ? ids[to + 1] || null : String(over.id));
    }
    return <Interactions.Provider value={{ snooze: setSnoozing, activeTask }}><DndContext sensors={sensors} collisionDetection={collision} onDragStart={({ active }) => { clickGuard.start(); setActiveId(String(active.id)); }} onDragCancel={() => { clickGuard.end(); setActiveId(undefined); }} onDragEnd={end} accessibility={{ screenReaderInstructions: { draggable: 'Hold still to drag. With the keyboard, press Space to pick up a task, use the arrow keys to reorder, and press Space to drop or Escape to cancel.' } }}>
    {children}<DragOverlay dropAnimation={null}>{activeTask && <DragPreview complete={activeTask.status === 'done'} metadata={<TaskMetadata task={activeTask}/>}>{activeTask.title}</DragPreview>}</DragOverlay>
  </DndContext>{snoozing && <SnoozeDialog task={snoozing} close={() => setSnoozing(undefined)}/>}</Interactions.Provider>;
}
export function TaskDropLink({ status, spaceId, surface, className = '', current, destinationLabel, title, children }: {
    status: Status;
    spaceId: string;
    surface: string;
    className?: string;
    current?: boolean;
    destinationLabel?: string;
    title?: string;
    children: ReactNode;
}) {
    const { activeTask } = useTaskInteractions();
    const enabled = !!activeTask && (status !== 'snoozed' || activeTask.status === 'inbox');
    const { setNodeRef, isOver } = useDroppable({ id: `task-list:${surface}:${spaceId}:${status}`, data: { kind: 'task-list', status, spaceId }, disabled: !enabled });
    return <a ref={setNodeRef} href={`#${spacePath(spaceId, status)}`} data-drop-list={status} data-drop-space={spaceId} aria-current={current ? 'page' : undefined} className={`${className} ${activeTask && enabled ? 'task-drop-ready' : ''} ${isOver ? 'task-drop-over' : ''}`} title={activeTask && enabled ? `Move to ${destinationLabel || labels[status]}` : title} onClick={e => { if (activeTask)
        e.preventDefault(); }}>{children}</a>;
}
