import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../server/store';
import { Actions, type ActionInput } from '../server/actions';
import { Gateway } from '../server/gateway';
import { PluginStorage } from '../server/plugins/storage';
import { discardedUploads } from '../server/discardedUploads';
import type { Action } from '../shared/core';

const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).reverse().forEach(close => close()); vi.useRealTimers(); });
function fixture(path = ':memory:') {
  const store = new Store(path); cleanup.push(() => { if (store.db.open) store.close(); });
  store.saveContext({ id: 'context', title: 'Synthetic archive', link: null, aliases: [] });
  return store;
}
function save(store: Store, id: string, patch: Partial<Action> = {}, age = 31 * 86400000) {
  const action: Action = { id, taskId: 'context', kind: 'send', state: 'finished', receipt: 'accepted', phase: 'complete',
    text: 'Synthetic retained message', liveText: 'Synthetic retained reply', uploadIds: [], createdAt: 1, updatedAt: 1, ...patch };
  store.saveAction(action);
  action.updatedAt = Date.now() - age;
  store.db.prepare('UPDATE actions SET data=? WHERE id=?').run(JSON.stringify(action), id);
  store.activity.recordAction(action);
  return action;
}
const archived = (store: Store) => store.db.prepare('SELECT id FROM archived_actions ORDER BY id').all();

it('moves complete records outside routine reads and preserves receipts, notices, and original order', () => {
  const store = fixture(), input: ActionInput = { id: 'old', contextId: 'context', kind: 'send', text: 'Synthetic retained message' };
  const old = save(store, 'old', { createdSession: { runtimeId: 'runtime', storedId: 'stored', epoch: 'epoch' } });
  store.saveReceipt('old', input, { id: 'old' });
  save(store, 'latest'); save(store, 'continued', { kind: 'continue' });
  store.notify('old:complete', 'context', 'completion');
  store.db.prepare('INSERT INTO deliveries VALUES (?,?,?,?)').run('old:complete', 'subscription', 1, 2);
  const receipts = store.db.prepare('SELECT * FROM receipts').all(), notices = store.db.prepare('SELECT * FROM notices').all();
  expect(store.archive.batch().moved).toBe(1);
  expect(store.actions().map(action => action.id)).toEqual(['continued', 'latest']);
  expect(store.action('old')).toEqual(old);
  expect(store.activity.details('context').actions.map(action => action.id)).toEqual(['continued', 'latest']);
  expect(store.db.prepare('SELECT * FROM receipts').all()).toEqual(receipts);
  expect(store.db.prepare('SELECT * FROM notices').all()).toEqual(notices);
  expect(store.db.prepare('SELECT * FROM deliveries').get()).toMatchObject({ delivered: 1, attempts: 2 });
  const gateway = new Gateway('', ''), engine = new Actions(store, gateway, '/tmp');
  cleanup.push(() => { engine.close(); gateway.close(); });
  const dispatch = vi.spyOn(engine, 'dispatch');
  expect(engine.start(input)).toEqual(old);
  expect(engine.cancelUndispatched(input)).toMatchObject({ cancelled: false, action: old });
  expect(() => engine.start({ ...input, text: 'Changed content' })).toThrow('cannot be reused');
  expect(dispatch).not.toHaveBeenCalled();
  store.saveAction({ ...old, phase: 'late result' });
  expect(archived(store)).toHaveLength(0);
  expect(store.actions().map(action => action.id)).toEqual(['continued', 'latest', 'old']);
  expect(store.activity.summary('context').main?.id).toBe('continued');
  expect(store.archive.batch().moved).toBe(0);
});

it('retains recent, uncertain, saved, settings, and control-dependent records', () => {
  const store = fixture();
  save(store, 'recent', {}, 29 * 86400000);
  save(store, 'saved', { state: 'failed', receipt: 'rejected' });
  save(store, 'unknown', { state: 'unknown', receipt: 'unknown' });
  save(store, 'settings', { settings: { revision: 1, values: {}, applied: [], inFlight: 'model' } });
  save(store, 'target');
  save(store, 'stop', { kind: 'stop', targetId: 'target', state: 'stopping' });
  save(store, 'eligible'); save(store, 'current');
  expect(store.archive.batch().moved).toBe(1);
  expect(archived(store)).toEqual([{ id: 'eligible' }]);
  expect(store.action('saved')?.text).toBe('Synthetic retained message');
  expect(store.archive.stats.retained).toMatchObject({ current: 1, settings: 1, 'dependent-control': 1 });
});

it('rechecks recovery and dispatch dependencies inside each transaction', () => {
  const store = fixture(); save(store, 'old'); save(store, 'current');
  const binding = { runtimeId: 'runtime', storedId: 'stored', epoch: 'epoch', generation: 'generation', seq: 1, known: true, ready: false, monitored: true };
  store.saveBinding('context', { ...binding, recoveryPending: true });
  expect(store.archive.batch().moved).toBe(0);
  store.saveBinding('context', binding);
  expect(store.archive.batch(Date.now(), () => { expect(store.db.inTransaction).toBe(true); return true; }).moved).toBe(0);
  expect(store.archive.batch().moved).toBe(1);
});

it('rolls back interrupted moves and restores late updates without restoring deleted content', () => {
  const store = fixture(); save(store, 'deleted', { savedMessageDeletedAt: 10 }); save(store, 'current');
  const sequence = store.activity.head(), changed = vi.spyOn(store.activity, 'changed').mockImplementation(() => { throw new Error('Synthetic interruption'); });
  expect(() => store.archive.batch()).toThrow('Synthetic interruption');
  expect(archived(store)).toHaveLength(0); expect(store.actions()).toHaveLength(2);
  expect(store.activity.head()).toBe(sequence);
  changed.mockRestore(); expect(store.archive.batch().moved).toBe(1);
  store.saveAction({ ...store.action('deleted')!, savedMessageDeletedAt: undefined, text: 'Stale private content', uploadIds: ['stale'] });
  expect(store.action('deleted')).toMatchObject({ text: '', uploadIds: [], savedMessageDeletedAt: 10 });
  expect(store.hasActionUpload('stale')).toBe(false);
});

it('retains archived attachment ownership during deletion cleanup and plugin reset', async () => {
  const directory = mkdtempSync('/tmp/herts-archive-uploads-'); cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const store = fixture(), id = randomUUID(); writeFileSync(join(directory, id), 'Synthetic attachment');
  save(store, 'old', { uploadIds: [id] }); save(store, 'current');
  store.saveUpload({ id, name: 'fixture.txt', size: 20, type: 'text/plain', hash: 'fixture', complete: true, owner: 'fixture:resource' });
  expect(store.archive.batch().moved).toBe(1);
  store.db.prepare('INSERT INTO discarded_uploads VALUES (?)').run(id);
  await discardedUploads(store, directory, new Set())();
  expect(existsSync(join(directory, id))).toBe(true);
  const plugins = new PluginStorage(store); plugins.reset('fixture');
  expect(store.upload(id)).toMatchObject({ id, complete: true }); expect(store.upload(id)?.owner).toBeUndefined();
  expect(store.hasActionUpload(id)).toBe(true);
});

it('retains first-send evidence after archiving and reopening without starting the worker', async () => {
  const directory = mkdtempSync('/tmp/herts-archive-reopen-'); cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'db'), store = fixture(path);
  const old = save(store, 'accepted', { createdSession: { runtimeId: 'runtime', storedId: 'stored', epoch: 'epoch' } });
  save(store, 'current', { state: 'failed', receipt: 'rejected', sendStage: 'preparing' });
  store.saveContext({ id: 'context', title: 'Synthetic archive', link: { key: 'stored', storedId: 'stored', source: 'gui', title: 'Fixture' }, aliases: [] });
  store.saveBinding('context', { runtimeId: 'runtime', storedId: 'stored', epoch: 'epoch', generation: 'generation', seq: 1, known: false, ready: false, monitored: true });
  expect(store.archive.batch().moved).toBe(1); store.close();
  const reopened = new Store(path); cleanup.push(() => reopened.close());
  expect(reopened.db.pragma('user_version', { simple: true })).toBe(10);
  expect(reopened.action('accepted')).toEqual(old);
  expect(reopened.activity.summary('context').main?.id).toBe('current');
  const gateway = new Gateway('', ''); gateway.epoch = 'epoch'; vi.spyOn(gateway, 'connect').mockResolvedValue(undefined);
  const engine = new Actions(reopened, gateway, '/tmp'); cleanup.push(() => { engine.close(); gateway.close(); });
  await expect(engine.reconnectUnsentConversation('context', 'stored')).rejects.toThrow('changed');
  expect(reopened.archive.stats.batches).toBe(0);
});

it('moves at most 100 records per batch and yields before continuing', async () => {
  vi.useFakeTimers();
  const store = fixture(); for (let i = 0; i < 205; i++) save(store, `old-${i}`); save(store, 'current', {}, 0);
  const batch = vi.spyOn(store.archive, 'batch'); store.archive.start(() => false);
  await vi.advanceTimersByTimeAsync(60000);
  expect(archived(store)).toHaveLength(100); expect(batch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(99); expect(batch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(archived(store)).toHaveLength(200);
  await vi.advanceTimersByTimeAsync(100); expect(archived(store)).toHaveLength(205);
  store.archive.close(); await vi.advanceTimersByTimeAsync(3600000); expect(batch).toHaveBeenCalledTimes(3);
});
