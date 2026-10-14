import { expect, it, vi } from 'vitest';
import { applyReadingOp, emptyReading, retainsArticle, type ReadingOp } from '../plugins/reading/src/model';
vi.mock('@herts/plugin-api/types', () => import('../sdk/types'));

it('keeps the article version through read and undo, then releases only the matching hold', () => {
  let state = emptyReading();
  const apply = (op: ReadingOp) => { state = applyReadingOp(state, op); };
  apply({ id: 'create', itemId: 'item', contextId: 'context', kind: 'create', url: 'https://example.com', at: 1 });
  apply({ id: 'read', itemId: 'item', kind: 'read', read: true, baseReadAt: null, articleHold: 'first', at: 2 });
  expect(retainsArticle(state.items[0], state)).toBe(true);
  expect(state.items[0].downloadVersion).toBe(1);
  apply({ id: 'undo', itemId: 'item', kind: 'read', read: false, baseReadAt: 2, at: 3 });
  expect(state.items[0]).toMatchObject({ readAt: null, downloadVersion: 1 });
  apply({ id: 'read-again', itemId: 'item', kind: 'read', read: true, baseReadAt: null, articleHold: 'second', at: 4 });
  apply({ id: 'old-expiry', itemId: 'item', kind: 'release', articleHold: 'first', at: 5 });
  expect(retainsArticle(state.items[0], state)).toBe(true);
  apply({ id: 'expire', itemId: 'item', kind: 'release', articleHold: 'second', at: 6 });
  expect(retainsArticle(state.items[0], state)).toBe(false);
  expect(state.items[0].downloadVersion).toBe(2);
});

it('restores the original read time after marking unread', () => {
  let state = emptyReading();
  const apply = (op: ReadingOp) => { state = applyReadingOp(state, op); };
  apply({ id: 'create', itemId: 'item', contextId: 'context', kind: 'create', url: 'https://example.com', at: 1 });
  apply({ id: 'read', itemId: 'item', kind: 'read', read: true, baseReadAt: null, at: 10 });
  apply({ id: 'unread', itemId: 'item', kind: 'read', read: false, baseReadAt: 10, at: 20 });
  apply({ id: 'undo', itemId: 'item', kind: 'read', read: true, baseReadAt: null, restoreReadAt: 10, at: 30 });
  expect(state.items[0].readAt).toBe(10);
});
