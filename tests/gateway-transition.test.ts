import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store';
import { Gateway } from '../server/gateway';
import { bindHermesTarget } from '../server/config';
import { transitionToGateway } from '../server/targetTransition';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0)) await close(); });
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'herts-transition-')), store = new Store(':memory:');
  cleanup.push(() => { store.close(); return rm(home, { recursive: true, force: true }); });
  const old = new Gateway('http://127.0.0.1:9998', 'fixture'); cleanup.push(() => old.close());
  bindHermesTarget(store, old.base, 'default');
  const context = store.ensureContext({ key: 'stored', storedId: 'stored', source: 'desktop', title: 'Saved work' });
  store.saveBinding(context.id, { runtimeId: 'legacy-runtime', storedId: 'stored', epoch: 'old-epoch', generation: 'generation', seq: 10, ready: true, monitored: true, known: true });
  store.saveAction({ id: 'uncertain', taskId: context.id, kind: 'send', text: 'Retained message', uploadIds: [], createdAt: 1, updatedAt: 1, state: 'unknown', phase: 'unknown', receipt: 'unknown' });
  store.setMeta('vapid', { publicKey: 'fixture-public', privateKey: 'fixture-private' });
  vi.spyOn(Gateway.prototype, 'connect').mockResolvedValue(undefined);
  const read = vi.spyOn(Gateway.prototype, 'http').mockImplementation(async path => path === '/api/status'
    ? { install_id: 'same-installation' } : { id: 'stored', profile: 'default', source: 'desktop', started_at: 100 });
  return { home, store, old, context, read, options: { home, source: home, python: '/usr/bin/python3' } };
}

it('requires verification, supports a read-only preview, and retains uncertain work during transition', async () => {
  const f = await fixture();
  expect(() => bindHermesTarget(f.store, '', 'default', f.home)).toThrow('different Hermes target');
  expect(await transitionToGateway(f.store, f.old, f.options)).toMatchObject({ applied: false, conversations: 1 });
  expect(f.store.getMeta('hermesTarget').base).toBe(f.old.base);
  await transitionToGateway(f.store, f.old, f.options, true);
  expect(() => bindHermesTarget(f.store, '', 'default', f.home)).not.toThrow();
  expect(f.store.binding(f.context.id)).toMatchObject({ runtimeId: 'legacy-runtime', ready: false, known: false, seq: 10 });
  expect(f.store.action('uncertain')).toMatchObject({ text: 'Retained message', receipt: 'unknown' });
  expect(f.store.getMeta('vapid').privateKey).toBe('fixture-private');
  expect(f.store.getMeta('hermesTargetTransition').previous.base).toBe(f.old.base);
});

it('refuses another installation or a changed conversation without changing the target', async () => {
  const f = await fixture();
  f.read.mockImplementation(async function(this: Gateway, path) {
    return path === '/api/status' ? { install_id: this.native ? 'foreign' : 'original' } : {};
  });
  await expect(transitionToGateway(f.store, f.old, f.options, true)).rejects.toThrow('installation');
  f.read.mockImplementation(async function(this: Gateway, path) {
    return path === '/api/status' ? { install_id: 'same' } : { id: 'stored', profile: 'default', source: 'desktop', started_at: this.native ? 200 : 100 };
  });
  await expect(transitionToGateway(f.store, f.old, f.options, true)).rejects.toThrow('conversation');
  expect(f.store.getMeta('hermesTarget').base).toBe(f.old.base);
});

it('refuses a connection switch while saved work is active', async () => {
  const f = await fixture(), action = f.store.action('uncertain')!;
  f.store.saveAction({ ...action, state: 'running', receipt: 'accepted' });
  await expect(transitionToGateway(f.store, f.old, f.options, true)).rejects.toThrow('Finish active Herts work');
  expect(f.read).not.toHaveBeenCalled();
  expect(f.store.getMeta('hermesTarget').base).toBe(f.old.base);
});

it('retains profile migration records and refuses a database from a newer version', async () => {
  const home = await mkdtemp(join(tmpdir(), 'herts-schema-')), path = join(home, 'tasks.sqlite');
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  const old = new Store(path); old.bindProfiles('default');
  old.db.pragma('user_version = 7'); old.setMeta('gateway-operation:fixture', { submission_id: 'saved' }); old.close();
  const current = new Store(path); current.bindProfiles('default');
  expect(current.db.pragma('user_version', { simple: true })).toBe(10);
  expect(current.getMeta('gateway-operation:fixture')).toEqual({ submission_id: 'saved' });
  current.db.pragma('user_version = 11'); current.close();
  expect(() => new Store(path)).toThrow('newer Herts');
});
