import { expect, it, vi } from 'vitest';
import { applyTaskOp, emptySnapshot, type TaskOp } from '../plugins/tasks/src/model';
vi.mock('@herts/plugin-api/types', () => import('../sdk/types'));

it('restores a completed snooze atomically and rejects a changed task', () => {
  let state = emptySnapshot();
  const apply = (op: TaskOp) => { state = applyTaskOp(state, op); };
  apply({ id: 'create', taskId: 'task', kind: 'create', title: 'Reminder', at: 1 });
  apply({ id: 'snooze', taskId: 'task', kind: 'snooze', baseStatus: 'inbox', baseSnoozeId: null, snoozedUntil: 10000, at: 2 });
  apply({ id: 'complete', taskId: 'task', kind: 'move', status: 'done', baseStatus: 'snoozed', baseSnoozeId: 'snooze', at: 3 });
  const undo: TaskOp = { id: 'undo', taskId: 'task', kind: 'snooze', baseStatus: 'done', baseSnoozeId: null, snoozedUntil: 10000, at: 4 };
  const restored = applyTaskOp(state, undo);
  expect(restored.tasks[0]).toMatchObject({ status: 'snoozed', snoozedUntil: 10000, completedAt: null });
  apply({ id: 'move', taskId: 'task', kind: 'move', status: 'next', baseStatus: 'done', baseSnoozeId: null, at: 4 });
  expect(() => applyTaskOp(state, undo)).toThrow('The task moved');
});

it('restores the original completion time and Done order after reopening', () => {
  let state = emptySnapshot();
  const apply = (op: TaskOp) => { state = applyTaskOp(state, op); };
  for (const [index, taskId] of ['older', 'newer'].entries()) {
    apply({ id: `create-${taskId}`, taskId, kind: 'create', title: taskId, at: 1 });
    apply({ id: `done-${taskId}`, taskId, kind: 'move', status: 'done', baseStatus: 'inbox', at: 10 + index });
  }
  apply({ id: 'reopen', taskId: 'older', kind: 'move', status: 'inbox', baseStatus: 'done', at: 20 });
  apply({ id: 'undo', taskId: 'older', kind: 'move', status: 'done', baseStatus: 'inbox', restoreCompletedAt: 10, at: 30 });
  expect(state.tasks.find(task => task.id === 'older')?.completedAt).toBe(10);
  expect(state.lists.done.ids).toEqual(['newer', 'older']);
});
