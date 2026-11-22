import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { Store } from '../server/store';
import { Gateway, GatewayError } from '../server/gateway';
import { voiceLiveGreetingInstructions } from '../shared/voice';
import { VoiceLive } from '../server/voiceLive';
import { RemoteActions } from '../server/plugins/remoteActions';

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach(fn => fn()));
function fixture() {
  const store = new Store(':memory:'); cleanup.push(() => store.close());
  const context = store.saveContext({ id: randomUUID(), title: 'Synthetic call', profile: 'research', aliases: ['stored'], link: { storedId: 'stored', key: 'stored', title: 'Synthetic call', source: 'cli' } });
  const http = vi.fn(async (path: string, body?: unknown): Promise<any> => body
    ? { ok: true, session: { id: 'live_fixture', secret: 'must-not-escape' }, transport: { type: 'webrtc', sdp: 'answer\r\n' }, api_key: 'must-not-escape' }
    : { ok: true, available: true, mode: 'gpt-live', model: 'gpt-live-1', voice: 'marin', reason: 'must-not-escape' });
  const history = vi.fn(async () => ({ messages: [{ role: 'tool', content: 'private tool output' }, { role: 'user', content: 'A synthetic question' }, { role: 'assistant', content: 'A synthetic answer' }] }));
  const gateway = { profile: 'default', http, history, withProfile: (_profile: string, run: () => any) => run() } as unknown as Gateway;
  const voice = new VoiceLive(store, gateway), remote = new RemoteActions(store);
  cleanup.push(() => remote.close());
  const start = (id: string = randomUUID(), sdp = 'v=0\r\nfixture\r\n') => remote.start('calls', { id, generation: 0, command: 'start', input: { contextId: context.id, sdp } }, () => {}, effects => voice.create({ contextId: context.id, sdp }, effects));
  return { store, context, http, voice, remote, start };
}

it('creates through the linked profile with exact SDP and an allowlisted result', async () => {
  const f = fixture(), action = f.start();
  await expect.poll(() => f.remote.get('calls', action.id)?.state).toBe('finished');
  expect(f.http).toHaveBeenLastCalledWith('/api/audio/voice-live/session?profile=research', {
    sdp: 'v=0\r\nfixture\r\n', history: [
      { type: 'message', role: 'developer', content: [{ type: 'input_text', text: voiceLiveGreetingInstructions }] },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'A synthetic question' }] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'A synthetic answer' }] },
    ],
  });
  expect(JSON.stringify(f.remote.get('calls', action.id))).not.toContain('must-not-escape');
  expect(JSON.stringify(await f.voice.status(f.context.id))).not.toContain('must-not-escape');
  f.start(action.id); expect(f.http).toHaveBeenCalledTimes(3);
});
it('does not retry unknown session creation and sanitises provider errors', async () => {
  const f = fixture(); f.http.mockImplementation(async (_path, body) => {
    if (body) throw new GatewayError('vendor secret sk-private', true);
    return { available: true, mode: 'gpt-live', model: 'gpt-live-1', voice: 'marin' };
  });
  const action = f.start(); await expect.poll(() => f.remote.get('calls', action.id)?.state).toBe('unknown');
  f.start(action.id);
  expect(f.http).toHaveBeenCalledTimes(2); expect(JSON.stringify(f.remote.get('calls', action.id))).not.toContain('sk-private');
});
it('refuses missing credentials and unlinked conversations before creation', async () => {
  const f = fixture(); f.http.mockResolvedValue({ available: false, mode: 'chained', model: 'gpt-live-1', voice: 'marin' });
  const action = f.start(); await expect.poll(() => f.remote.get('calls', action.id)?.state).toBe('failed');
  expect(f.http).toHaveBeenCalledTimes(1);
  await expect(f.voice.status(randomUUID())).rejects.toThrow('linked conversation');
});
it('marks malformed creation responses as unknown without caching vendor data', async () => {
  const f = fixture(); f.http.mockImplementation(async (_path, body) => body ? { secret: 'private' }
    : { available: true, mode: 'gpt-live', model: 'gpt-live-1', voice: 'marin' });
  const action = f.start(); await expect.poll(() => f.remote.get('calls', action.id)?.state).toBe('unknown');
  expect(f.remote.get('calls', action.id)?.result).toBeUndefined();
});

it('reads the default profile without requiring a conversation', async () => {
  const f = fixture(); await f.voice.status();
  expect(f.http).toHaveBeenLastCalledWith('/api/audio/voice-live/status?profile=default');
  await f.voice.status(f.context.id);
  expect(f.http).toHaveBeenLastCalledWith('/api/audio/voice-live/status?profile=research');
});
