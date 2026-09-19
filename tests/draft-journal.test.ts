import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { acknowledgeDraft, discardResetDrafts, draftIsCurrent, pendingDraft, stageDraft } from '../src/draftJournal';

let window: JSDOM['window'];
beforeEach(() => {
  window = new JSDOM('', { url: 'https://herts.example' }).window;
  vi.stubGlobal('localStorage', window.localStorage);
});
afterEach(() => { window.close(); vi.unstubAllGlobals(); });

test('acknowledging an older window write cannot erase a newer pending edit or deletion', () => {
  const key = 'tasks:0:draft:capture:personal';
  const old = stageDraft(key, { text: 'Old draft' });
  const latest = stageDraft(key, { text: 'New draft' });
  acknowledgeDraft(key, old);
  expect(draftIsCurrent(key, old)).toBe(false);
  expect(pendingDraft(key)).toEqual(latest);
  const deletion = stageDraft(key, null);
  acknowledgeDraft(key, latest);
  expect(pendingDraft(key)).toEqual(deletion);
  acknowledgeDraft(key, deletion);
  expect(pendingDraft(key)).toBeUndefined();
  expect(Object.keys(localStorage).filter(key => key.startsWith('herts:draft-write:'))).toEqual([]);
});

test('reset removes old recovery content while retaining new-generation and other-plugin drafts', () => {
  stageDraft('tasks:0:draft:capture:personal', { text: 'Reset this draft' });
  const task = stageDraft('tasks:1:draft:capture:personal', { text: 'New generation' });
  const article = stageDraft('reading:0:draft:reading-capture', { text: 'Retain this article' });
  discardResetDrafts('tasks', 1);
  expect(pendingDraft('tasks:0:draft:capture:personal')).toBeUndefined();
  expect(Object.values(localStorage).join(' ')).not.toContain('Reset this draft');
  expect(pendingDraft('tasks:1:draft:capture:personal')).toEqual(task);
  expect(pendingDraft('reading:0:draft:reading-capture')).toEqual(article);
});

test('failure to record a replacement leaves the previous recoverable draft intact', () => {
  const key = 'tasks:0:draft:capture:personal';
  const original = stageDraft(key, { text: 'Already saved draft' });
  const set = vi.spyOn(window.Storage.prototype, 'setItem');
  set.mockImplementationOnce(() => { throw new DOMException('Storage is full', 'QuotaExceededError'); });
  expect(() => stageDraft(key, { text: 'Replacement' })).toThrow('Storage is full');
  expect(pendingDraft(key)).toEqual(original);
  set.mockRestore();
});
