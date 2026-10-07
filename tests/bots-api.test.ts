import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app';
import { Bots } from '../server/bots';
import { BotBackend } from './bots-fixture';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn(); });
it('keeps bot media, speech, transcription, directories and attached sends in their owning profiles', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'herts-bots-api-'));
  const f = await createApp({ dataDir, origin: 'http://localhost', identity: 'owner', dev: true, hermesBase: '', hermesToken: '' });
  cleanup.push(async () => { await f.app.close(); await rm(dataDir, { recursive: true, force: true }); });
  const backend = new BotBackend();
  f.gateway.online = true; f.gateway.epoch = 'fixture-epoch'; f.gateway.connect = async () => {};
  (f.gateway as any).request = backend.rpc.bind(backend); f.gateway.http = backend.http.bind(backend);
  const bots = new Bots(f.store, f.gateway, f.actions), headers = { 'x-herts-request': '1' };
  for (const profile of ['research', 'default', 'research']) {
    const context = await bots.openBot(profile, { id: randomUUID(), check() {}, effect: (_, fn) => fn() });
    const text = `File from ${profile} @file:/tmp/result.pdf`;
    backend.chats.get(profile).messages = [{ id: 1, role: 'assistant', content: text }];
    const start = backend.calls.length;
    const message = { conversationId: context.link!.storedId, order: 'oldest', offset: 0, index: 0 };
    for (const [url, payload] of [
      ['/api/v1/media', { ...message, path: '/tmp/result.pdf' }],
      ['/api/v1/audio/speak', { ...message, text }],
    ] as const) {
      const response = await f.app.inject({ method: 'POST', url, headers, payload });
      expect(response.statusCode, response.body).toBe(200);
    }
    const uploadId = randomUUID();
    f.store.saveUpload({ id: uploadId, name: 'voice.webm', type: 'audio/webm', size: 4, hash: 'fixture', complete: true });
    await writeFile(join(dataDir, 'uploads', uploadId), 'test');
    const voice = await f.app.inject({ method: 'POST', url: '/api/v1/audio/transcribe', headers, payload: { id: randomUUID(), uploadId, contextId: context.id } });
    expect(voice.statusCode, voice.body).toBe(200); expect(voice.body).toContain(`Dictated for ${profile}`);
    const directories = await f.app.inject(`/api/v1/session-directories?contextId=${context.id}&path=/projects`);
    expect(directories.statusCode, directories.body).toBe(200);
    const calls = backend.calls.slice(start).filter(c => /audio\/|fs\/|\/files$/.test(c.method));
    expect(calls).toHaveLength(4); expect(calls.every(c => c.params.profile === profile)).toBe(true);
    if (profile === 'research' && !f.store.actions(context.id).length) {
      f.actions.start({ id: randomUUID(), contextId: context.id, kind: 'send', text: '/new', uploadIds: [uploadId] });
      for (let i = 0; i < 100 && f.actions.dispatching.size; i++) await new Promise(r => setTimeout(r, 5));
      expect(backend.calls.find(c => c.method === 'file.attach')?.params.session_id).toBe('bot-runtime:research');
      expect(backend.calls.find(c => c.method === 'prompt.submit')?.params).toMatchObject({ session_id: 'bot-runtime:research', text: '/new\n@file:/tmp/synthetic.txt' });
    }
  }
});
