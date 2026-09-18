import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { Store } from '../server/store';
import { applyTaskOp, emptySnapshot, conversationHidden, type TaskOp } from '../shared/model';

const stores: Store[] = []; const fresh = () => { const s = new Store(':memory:'); stores.push(s); return s; };
const capture = (title = 'A task', at = Date.now()): TaskOp => ({ id: randomUUID(), taskId: randomUUID(), kind: 'create', title, at });
afterEach(() => stores.splice(0).forEach(s => s.close()));
describe('task persistence and conflict handling', () => {
  it('persists hidden conversations across reopen and task edits, and does not replay an old hide over an unhide', async () => {
    const directory = await mkdtemp('/tmp/tasks-visibility-test-'); let store = new Store(`${directory}/tasks.sqlite`);
    try {
      const hide = { id: randomUUID(), key: 'old-root', aliases: ['old-tip'], hidden: true, at: Date.now() };
      store.setConversationVisibility(hide);
      const task = capture(); store.mutate(task);
      store.createLinked(capture('Linked'), { key: 'other', storedId: 'other', title: 'Other', source: 'desktop' });
      store.linkNew(task.taskId, { key: 'third', storedId: 'third', title: 'Third', source: 'desktop' });
      store.close(); store = new Store(`${directory}/tasks.sqlite`);
      expect(store.snapshot().hiddenConversations).toEqual(['old-root']);
      const rotated = { id: 'new-tip', key: 'new-root', aliases: ['old-root', 'old-tip'], title: '', preview: '', source: 'desktop', updatedAt: 0 };
      expect(conversationHidden(rotated, store.snapshot().hiddenConversations!)).toBe(true);
      store.setConversationVisibility({ id: randomUUID(), key: rotated.key, aliases: rotated.aliases, hidden: false, at: Date.now() });
      const revision = store.snapshot().revision;
      store.setConversationVisibility(hide);
      expect(store.snapshot().hiddenConversations).toEqual([]); expect(store.snapshot().revision).toBe(revision);
      expect(() => store.setConversationVisibility({ ...hide, hidden: false })).toThrow('operation ID');
      expect(store.snapshot().tasks).toHaveLength(2); expect(store.actions()).toEqual([]);
    } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
  });
  it('adds captures and moved tasks to the top and sorts Done by completion time', () => {
    const s = fresh(), a = capture('A', 100), b = capture('B', 200); s.mutate(a); s.mutate(b);
    expect(s.snapshot().lists.inbox.ids).toEqual([b.taskId, a.taskId]);
    for (const op of [a,b]) s.mutate({ id: randomUUID(), taskId: op.taskId, kind: 'move', status: 'next', baseStatus: 'inbox', at: 300 });
    expect(s.snapshot().lists.next.ids).toEqual([b.taskId, a.taskId]);
    s.mutate({ id: randomUUID(), taskId: a.taskId, kind: 'move', status: 'done', baseStatus: 'next', at: 500 });
    s.mutate({ id: randomUUID(), taskId: b.taskId, kind: 'move', status: 'done', baseStatus: 'next', at: 400 });
    expect(s.snapshot().lists.done.ids).toEqual([a.taskId, b.taskId]);
    expect(s.task(a.taskId)?.previousStatus).toBe('next');
    s.mutate({ id: randomUUID(), taskId: a.taskId, kind: 'move', status: 'next', baseStatus: 'done', at: 600 });
    expect(s.task(a.taskId)?.completedAt).toBeNull(); expect(s.snapshot().lists.next.ids[0]).toBe(a.taskId);
  });
  it('deduplicates requests with lost acknowledgements and rejects operation ID reuse', () => {
    const s = fresh(), op = capture(); s.mutate(op); s.mutate(op);
    expect(s.snapshot().tasks).toHaveLength(1); expect(s.snapshot().revision).toBe(1);
    expect(() => s.mutate({ ...op, title: 'Changed contents' })).toThrow('operation ID');
  });
  it('merges independent title and status edits while preserving overlapping title edits as conflicts', () => {
    const s = fresh(), op = capture('Original'); s.mutate(op);
    s.mutate({ id: randomUUID(), taskId: op.taskId, kind: 'move', baseStatus: 'inbox', status: 'waiting', at: 10 });
    s.mutate({ id: randomUUID(), taskId: op.taskId, kind: 'title', baseTitle: 'Original', title: 'Android title', at: 11 });
    expect(s.task(op.taskId)).toMatchObject({ status: 'waiting', title: 'Android title' });
    expect(() => s.mutate({ id: randomUUID(), taskId: op.taskId, kind: 'title', baseTitle: 'Original', title: 'Mac title', at: 12 })).toThrow('another device');
    expect(s.task(op.taskId)?.title).toBe('Android title');
  });
  it('rejects stale reordering and does not allow manual reordering in Done', () => {
    const s = fresh(), a = capture(), b = capture(); s.mutate(a); const stale = s.snapshot().lists.inbox.version; s.mutate(b);
    expect(() => s.mutate({ id: randomUUID(), taskId: a.taskId, kind: 'move', baseStatus: 'inbox', status: 'inbox', listVersion: stale, beforeId: null, at: 20 })).toThrow('reordered');
    s.mutate({ id: randomUUID(), taskId: a.taskId, kind: 'move', baseStatus: 'inbox', status: 'done', at: 21 });
    expect(() => s.mutate({ id: randomUUID(), taskId: a.taskId, kind: 'move', baseStatus: 'done', status: 'done', at: 22 })).toThrow('completion time');
  });
  it('enforces unique conversation links without replacing the existing task', () => {
    const s = fresh(), a = capture(), b = capture(), link = { key: 'root', storedId: 'tip', title: 'Chat', source: 'desktop' };
    s.createLinked(a, link); expect(() => s.createLinked(b, link)).toThrow('already belongs');
    expect(s.snapshot().tasks).toHaveLength(1); expect(s.task(a.taskId)?.link?.key).toBe('root');
    expect(s.createLinked(a, { ...link, storedId: 'compacted-tip' })).toEqual({ taskId: a.taskId });
  });
  it('does not change conversation links when completing or renaming', () => {
    const s = fresh(), a = capture(); s.createLinked(a, { key: 'root', storedId: 'root', title: 'Remote title', source: 'telegram' });
    s.mutate({ id: randomUUID(), taskId: a.taskId, kind: 'title', title: 'Local title', baseTitle: a.title, at: 20 });
    s.mutate({ id: randomUUID(), taskId: a.taskId, kind: 'move', status: 'done', baseStatus: 'inbox', at: 21 });
    expect(s.task(a.taskId)?.link?.title).toBe('Remote title');
  });
});
