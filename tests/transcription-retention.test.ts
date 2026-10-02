import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createApp } from '../server/app';
import { Transcriptions, transcriptionRetentionMs } from '../server/transcriptions';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
const headers = { host: 'herts.example', origin: 'https://herts.example', 'tailscale-user-login': 'owner@example.com', 'x-herts-request': '1' };
async function fixture() {
  const dataDir = await mkdtemp('/tmp/herts-transcriptions-');
  const f = await createApp({ dataDir, origin: 'https://herts.example', identity: 'owner@example.com', hermesBase: '', hermesToken: '' });
  cleanups.push(async () => { await f.app.close(); await rm(dataDir, { recursive: true, force: true }); });
  const request = { id: randomUUID(), uploadId: randomUUID() }, bytes = Buffer.from('Synthetic private audio');
  expect((await f.app.inject({ method: 'POST', url: '/api/v1/uploads', headers, payload: { id: request.uploadId, name: 'dictation.webm', type: 'audio/webm', size: bytes.length, hash: createHash('sha256').update(bytes).digest('hex') } })).statusCode).toBe(200);
  expect((await f.app.inject({ method: 'PUT', url: `/api/v1/uploads/${request.uploadId}?offset=0`, headers: { ...headers, 'content-type': 'application/octet-stream' }, payload: bytes })).statusCode).toBe(200);
  return { ...f, request, post: (path: string, payload = request, access = headers) => f.app.inject({ method: 'POST', url: `/api/v1/audio/${path}`, headers: access, payload }) };
}
it('replays a lost result without reprocessing, then erases acknowledged audio and text', async () => {
  const f = await fixture(), work = vi.spyOn(f.gateway, 'http').mockResolvedValue({ transcript: 'Synthetic private transcript' });
  expect((await f.post('transcribe')).json()).toEqual({ transcript: 'Synthetic private transcript' });
  expect((await f.post('transcribe')).json()).toEqual({ transcript: 'Synthetic private transcript' });
  expect(work).toHaveBeenCalledTimes(1);
  expect((await f.post('discard', f.request, {} as typeof headers)).statusCode).toBe(403);
  expect((await f.post('discard')).statusCode).toBe(200);
  expect((await f.post('discard')).statusCode).toBe(200);
  expect((await f.app.inject({ url: `/api/v1/uploads/${f.request.uploadId}`, headers })).statusCode).toBe(404);
  expect(f.store.receipt(f.request.id, f.request)).toEqual({ discarded: true });
  expect((await f.post('transcribe')).statusCode).toBe(410);
  expect((await f.post('transcribe', { ...f.request, uploadId: randomUUID() })).statusCode).toBe(409);
  expect(work).toHaveBeenCalledTimes(1);
});
it('does not restore a transcript after it was discarded during processing', async () => {
  const f = await fixture(); let release!: (value: unknown) => void, ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  vi.spyOn(f.gateway, 'http').mockImplementation(async () => { ready(); return new Promise(resolve => { release = resolve; }); });
  const pending = f.post('transcribe').then(result => result); await started;
  expect((await f.post('discard')).statusCode).toBe(200);
  release({ transcript: 'Late private result' });
  expect((await pending).statusCode).toBe(410);
  expect(f.store.receipt(f.request.id, f.request)).toEqual({ discarded: true });
  expect((await f.app.inject({ url: `/api/v1/uploads/${f.request.uploadId}`, headers })).statusCode).toBe(404);
});
it('expires unacknowledged results but preserves an audio attachment used by a message', async () => {
  const f = await fixture(); vi.spyOn(f.gateway, 'http').mockResolvedValue({ transcript: 'Recovery result' }); await f.post('transcribe');
  f.store.saveAction({ id: randomUUID(), taskId: randomUUID(), kind: 'send', state: 'failed', phase: 'failed', receipt: 'rejected', text: 'Audio is also attached deliberately', uploadIds: [f.request.uploadId], createdAt: 1, updatedAt: 1 });
  new Transcriptions(f.store).sweep(Date.now() + transcriptionRetentionMs + 1);
  await f.post('discard');
  expect(f.store.receipt(f.request.id, f.request)).toEqual({ discarded: true });
  expect((await f.app.inject({ url: `/api/v1/uploads/${f.request.uploadId}`, headers })).statusCode).toBe(200);
});
it('matches legacy upload ownership by receipt fingerprint and clears old transcript results', async () => {
  const f = await fixture();
  f.store.setMeta(`audio:${f.request.id}`, true); f.store.saveReceipt(f.request.id, f.request, { transcript: 'Legacy transcript' });
  const retention = new Transcriptions(f.store); await retention.migrateLegacy();
  expect(f.store.db.prepare('SELECT upload_id FROM transcriptions WHERE id=?').get(f.request.id)).toEqual({ upload_id: f.request.uploadId });
  retention.sweep(Date.now() + transcriptionRetentionMs + 1); await f.post('discard');
  expect(f.store.receipt(f.request.id, f.request)).toEqual({ discarded: true });
  expect((await f.app.inject({ url: `/api/v1/uploads/${f.request.uploadId}`, headers })).statusCode).toBe(404);
});
