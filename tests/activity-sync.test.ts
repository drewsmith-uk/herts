import { afterEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store';
import { ActionActivity, ActivityCursorExpired } from '../server/activity';
import type { Action } from '../shared/core';

const stores: Store[] = [], directories: string[] = [];
const open = (path = ':memory:') => { const store = new Store(path); stores.push(store); return store; };
const context = (store: Store, id: string) => store.saveContext({ id, title: id, link: null, aliases: [] });
const action = (id: string, taskId = 'context', patch: Partial<Action> = {}): Action => ({ id, taskId, kind: 'send',
  state: 'finished', phase: 'Complete', receipt: 'accepted', text: 'Private message', liveText: 'Private reply',
  uploadIds: ['private-upload'], createdAt: 1, updatedAt: 1, ...patch });
afterEach(() => { for (const store of stores.splice(0)) if (store.db.open) store.close(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('incremental activity', () => {
  test('summaries exclude content and details return the current actions before recovery records', () => {
    const store = open(); context(store, 'context');
    store.saveAction(action('failed', 'context', { state: 'failed', receipt: 'rejected' }));
    store.saveAction(action('sent'));
    store.saveAction(action('continued', 'context', { kind: 'continue' }));
    const summary = store.activity.summary('context');
    expect(summary.main?.id).toBe('continued'); expect(summary.latestSend?.id).toBe('sent');
    expect(summary.hasSubmission).toBe(true); expect(summary.recoveryCount).toBe(1);
    const page = store.activity.sync();
    expect(JSON.stringify(page)).not.toMatch(/Private|private-upload|liveText|uploadIds|binding/);
    expect(store.activity.details('context').actions.map(a => a.id)).toEqual(['continued', 'sent', 'failed']);
  });
  test('changes during snapshot paging are replayed, including earlier conversation identities', () => {
    const store = open(); context(store, 'b'); context(store, 'c');
    let page = store.activity.sync(undefined, 1);
    expect(page.changes[0].summary.contextId).toBe('b');
    context(store, 'a'); store.saveAction(action('late', 'b'));
    const summaries = new Map(page.changes.map(change => [change.summary.contextId, change.summary]));
    while (page.hasMore) {
      page = store.activity.sync(page.cursor, 1);
      for (const { summary } of page.changes) if ((summaries.get(summary.contextId)?.version || 0) <= summary.version) summaries.set(summary.contextId, summary);
    }
    expect([...summaries.keys()].sort()).toEqual(['a', 'b', 'c']);
    expect(summaries.get('b')?.main?.id).toBe('late');
    expect(store.activity.sync(page.cursor).changes).toEqual([]);
  });
  test('cursor expiry follows both retention limits and startup changes the generation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'herts-activity-')); directories.push(dir);
    const path = join(dir, 'db'); const store = open(path); context(store, 'context');
    const cursor = store.activity.sync().cursor;
    store.db.transaction(() => {
      const insert = store.db.prepare('INSERT INTO activity_changes VALUES (?, ?, ?, ?)');
      for (let i = 2; i <= 10001; i++) insert.run(i, 'context', Date.now(), JSON.stringify({ summary: store.activity.summary('context'), retired: [] }));
      store.setMeta('activity-sequence', 10001);
      store.activity.changed('context');
    })();
    expect(() => store.activity.sync(cursor)).toThrow(ActivityCursorExpired);
    expect((store.db.prepare('SELECT count(*) AS n FROM activity_changes').get() as any).n).toBe(10000);
    const current = store.activity.sync().cursor;
    store.activity.changed('context');
    store.db.prepare('UPDATE activity_changes SET at=?').run(Date.now() - 8 * 86400000);
    expect(() => store.activity.sync(current)).toThrow(ActivityCursorExpired);
    const before = store.activity.sync().cursor; store.close();
    const restored = open(path);
    expect(() => restored.activity.sync(before)).toThrow(ActivityCursorExpired);
  });
  test('action writes, binding writes, summaries, and changes roll back together', () => {
    const store = open(); context(store, 'context'); const before = store.activity.head();
    expect(() => store.atomic(() => {
      store.saveAction(action('rollback'));
      store.saveBinding('context', { runtimeId: 'r', storedId: 's', generation: 'g', epoch: 'e', seq: 0,
        ready: false, monitored: true, known: true, recoveryPending: true });
      throw new Error('disk');
    })).toThrow('disk');
    expect(store.activity.head()).toBe(before); expect(store.action('rollback')).toBeUndefined();
    expect(store.activity.summary('context').hasSubmission).toBe(false); expect(store.binding('context')).toBeUndefined();
  });
  test('settled superseded records produce retirement markers and unresolved messages remain available', () => {
    const store = open(); context(store, 'context'); store.saveAction(action('old'));
    const cursor = store.activity.sync().cursor;
    store.saveAction(action('new'));
    expect(store.activity.sync(cursor).changes.at(-1)?.retired).toEqual(['old']);
    store.saveAction(action('unknown', 'context', { receipt: 'unknown', state: 'unknown' }));
    store.saveAction(action('latest'));
    expect(store.activity.details('context').actions.map(a => a.id)).toEqual(['latest', 'unknown']);
  });
  test('detail pages reject obsolete versions and preserve all recovery records', () => {
    const store = open(); context(store, 'context');
    for (let i = 0; i < 205; i++) store.saveAction(action(`failure-${i}`, 'context', { state: 'failed', receipt: 'rejected' }));
    const first = store.activity.details('context'); expect(first.actions).toHaveLength(101);
    const second = store.activity.details('context', first.cursor!); expect(second.actions).toHaveLength(100);
    const third = store.activity.details('context', second.cursor!); expect(third.actions).toHaveLength(4); expect(third.cursor).toBeNull();
    expect(new Set([...first.actions, ...second.actions, ...third.actions].map(a => a.id)).size).toBe(205);
    store.saveAction(action('new'));
    expect(() => store.activity.details('context', first.cursor!)).toThrow(ActivityCursorExpired);
  });
  test('routine payloads do not grow with 100000 historical actions', () => {
    const store = open(); context(store, 'context');
    const lengths: number[] = [];
    store.db.transaction(() => {
      const insert = store.db.prepare('INSERT INTO actions VALUES (?, ?, ?)');
      for (let i = 0; i < 100000; i++) {
        const value = action(String(i).padStart(6, '0'));
        insert.run(value.id, value.taskId, JSON.stringify(value));
        if (i === 999 || i === 99999) {
          store.setMeta('activity-index-ready', false);
          const activity = new ActionActivity(store);
          const details = activity.details('context');
          expect(details.actions).toHaveLength(1);
          lengths.push(JSON.stringify({ summary: activity.summary('context'), actions: details.actions }).length);
        }
      }
    })();
    expect(Math.abs(lengths[1] - lengths[0])).toBeLessThan(20);
  }, 60000);
});
