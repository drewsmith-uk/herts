import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createApp } from '../server/app';
import { hasSavedMessage, type Action } from '../shared/core';

const close: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of close.splice(0)) await fn(); });
async function fixture() {
  const dataDir = await mkdtemp('/tmp/herts-saved-messages-');
  const result = await createApp({ dataDir, origin: 'https://tasks.example', identity: 'owner@example.com', dev: false, hermesBase: '', hermesToken: '' });
  close.push(async () => { await result.app.close(); await rm(dataDir, { recursive: true, force: true }); });
  return result;
}
const headers = { host: 'tasks.example', 'tailscale-user-login': 'owner@example.com', origin: 'https://tasks.example', 'x-herts-request': '1', 'x-herts-plugin-api': '1' };
const saved = (taskId: string, patch: Partial<Action> = {}): Action => ({ id: randomUUID(), taskId, kind: 'send', state: 'failed', phase: 'failed', text: 'Keep this message', uploadIds: [], receipt: 'rejected', sendStage: 'preparing', createdAt: 1, updatedAt: 1, ...patch });

it('deletes only the saved copy, retains deduplication and prevents late updates from restoring it', async () => {
  const { app, store, gateway } = await fixture(), taskId = randomUUID();
  store.saveContext({ id: taskId, title: 'A conversation', link: null, aliases: [] });
  const action = saved(taskId), input = { id: action.id, contextId: taskId, kind: 'send', text: action.text };
  store.saveAction(action); store.saveReceipt(action.id, input, { id: action.id });
  const stale = structuredClone(action), rpc = vi.spyOn(gateway, 'rpc');
  const url = `/api/v1/actions/${action.id}/discard-saved-message`;
  const first = await app.inject({ method: 'POST', url, headers, payload: {} });
  expect(first.statusCode).toBe(200); expect(hasSavedMessage(first.json().action)).toBe(false);
  expect(first.json().action).toMatchObject({ ...stale, updatedAt: expect.any(Number), savedMessageDeletedAt: expect.any(Number) });
  const repeated = await app.inject({ method: 'POST', url, headers, payload: {} });
  expect(repeated.json()).toEqual(first.json());
  store.saveAction({ ...stale, error: 'A late status update' });
  expect(store.action(action.id)?.savedMessageDeletedAt).toBe(first.json().action.savedMessageDeletedAt);
  const replay = await app.inject({ method: 'POST', url: '/api/v1/actions', headers, payload: input });
  expect(replay.statusCode).toBe(202); expect(replay.json().action.id).toBe(action.id);
  expect(store.actions()).toHaveLength(1); expect(rpc).not.toHaveBeenCalled();
  const state = (await app.inject({ url: '/api/v1/state', headers })).json();
  expect(state.actions[0].savedMessageDeletedAt).toBe(first.json().action.savedMessageDeletedAt);
  expect(state.snapshot.contexts).toHaveLength(1);
});

it('requires private write access and rejects active, successful and control operations', async () => {
  const { app, store, gateway } = await fixture(), taskId = randomUUID(), rpc = vi.spyOn(gateway, 'rpc');
  const action = saved(taskId); store.saveAction(action);
  const discard = (id: string, h = headers) => app.inject({ method: 'POST', url: `/api/v1/actions/${id}/discard-saved-message`, headers: h, payload: {} });
  expect((await discard(action.id, {} as typeof headers)).statusCode).toBe(403);
  expect((await discard(action.id, { ...headers, origin: 'https://elsewhere.example' })).statusCode).toBe(403);
  expect(store.action(action.id)?.savedMessageDeletedAt).toBeUndefined();
  for (const patch of [{ state: 'running', receipt: 'accepted' }, { state: 'finished', receipt: 'accepted' }, { kind: 'stop' }]) {
    const other = saved(taskId, patch as Partial<Action>); store.saveAction(other);
    expect((await discard(other.id)).statusCode).toBe(409);
    expect(store.action(other.id)?.savedMessageDeletedAt).toBeUndefined();
  }
  const uncertain = saved(taskId, { state: 'unknown', receipt: 'unknown', sendStage: 'submitted' }); store.saveAction(uncertain);
  expect((await discard(uncertain.id)).statusCode).toBe(200);
  expect(store.action(uncertain.id)).toMatchObject({ state: 'unknown', receipt: 'unknown', sendStage: 'submitted' });
  expect((await discard(randomUUID())).statusCode).toBe(404); expect(rpc).not.toHaveBeenCalled();
});

it('returns original attachment metadata only for complete uploads under private access', async () => {
  const { app, store } = await fixture(), id = randomUUID();
  const upload = { id, name: 'notes.txt', type: 'text/plain', size: 5, hash: createHash('sha256').update('notes').digest('hex'), complete: false };
  store.saveUpload(upload);
  const url = `/api/v1/uploads/${id}/info`;
  expect((await app.inject({ url, headers })).statusCode).toBe(404);
  store.saveUpload({ ...upload, complete: true });
  expect((await app.inject(url)).statusCode).toBe(403);
  expect((await app.inject({ url, headers })).json().upload).toEqual({ ...upload, complete: true });
});
