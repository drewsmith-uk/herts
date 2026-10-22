import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeGateway } from '../server/nativeGateway';
import { Gateway } from '../server/gateway';
import { configuration } from '../server/config';
import { WebSocketServer } from 'ws';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0)) await close(); });

it('requires explicit native configuration and retains standalone defaults', () => {
  expect(configuration({ HERTS_DEV: '1' }).hermesNative).toBeUndefined();
  expect(() => configuration({ HERTS_DEV: '1', HERMES_CONNECTION: 'gateway' })).toThrow('absolute');
  expect(() => configuration({ HERTS_DEV: '1', HERMES_CONNECTION: 'automatic' })).toThrow('standalone or gateway');
  expect(configuration({ HERTS_DEV: '1', HERMES_CONNECTION: 'gateway', HERMES_HOME: '/fixture/home', HERMES_PYTHON: '/usr/bin/python3', HERMES_SOURCE: '/fixture/source' }).hermesNative?.home).toBe('/fixture/home');
});

it('discovers through the helper and rejects foreign identities and non-loopback origins', async () => {
  const root = await mkdtemp(join(tmpdir(), 'herts-native-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home'), source = join(root, 'source');
  await mkdir(home); await mkdir(join(source, 'hermes_cli'), { recursive: true });
  await writeFile(join(source, 'hermes_cli', '__init__.py'), '');
  await writeFile(join(source, 'hermes_cli', 'gateway_runtime.py'), `from dataclasses import dataclass
from types import SimpleNamespace
import json
@dataclass
class Endpoint:
    profile_id: str
    instance_id: str
    authority_epoch: int
    runtime_protocol: int
    api_origin: str
    capabilities: frozenset
    control_home: str | None = None
def discover_gateway_endpoint(home, timeout):
    value = json.loads((home / 'fixture.json').read_text())
    endpoint = Endpoint(value.get('profile_id', str(home)), 'fixture', 1, 1, value['origin'], frozenset(['session-authority-v1']))
    return SimpleNamespace(state='ready', endpoint=endpoint)
`);
  await writeFile(join(source, 'hermes_cli', 'gateway_client.py'), `def _session_ticket(home, endpoint, *, purpose, scope):
    assert (purpose == 'interactive' and scope == 'host') or (purpose == 'native-http' and scope is None)
    return 'synthetic-ticket'
`);
  const native = new NativeGateway({ home, source, python: '/usr/bin/python3' }); cleanup.push(() => native.close());
  const config = (value: any) => writeFile(join(home, 'fixture.json'), JSON.stringify(value));
  await config({ origin: 'http://127.0.0.1:9999' });
  expect((await native.access('default', 'interactive')).ticket).toBe('synthetic-ticket');
  expect((await native.access('default', 'native-http')).ticket).toBe('synthetic-ticket');
  await config({ origin: 'https://foreign.example:9999' });
  await expect(native.access('default')).rejects.toThrow('identity');
  await config({ origin: 'http://127.0.0.1:9999', profile_id: '/foreign' });
  await expect(native.access('default')).rejects.toThrow('Gateway access failed');
  await expect(native.access('../escape')).rejects.toThrow('Gateway access failed');
});

it('uses a fresh profile-scoped native HTTP ticket and never forwards it through redirects', async () => {
  const gateway = new Gateway('https://unused.example', 'standalone-secret', [], () => [], 'default', { home: '/fixture', source: '/fixture', python: '/usr/bin/python3' });
  cleanup.push(() => gateway.close());
  const access = vi.spyOn(gateway.native!, 'access').mockImplementation(async () => ({ endpoint: { profile_id: '/fixture/work', instance_id: 'instance', authority_epoch: 1, runtime_protocol: 1, api_origin: 'http://127.0.0.1:9999', capabilities: ['session-authority-v1'] }, ticket: `native-ticket-${access.mock.calls.length}` }));
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true })));
  await gateway.http('/api/config?profile=work');
  fetch.mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'refused native-ticket-2' }), { status: 400 }));
  await expect(gateway.http('/api/config?profile=work', {})).rejects.toThrow('refused [redacted]');
  expect(access.mock.calls).toEqual([['work', 'native-http'], ['work', 'native-http']]);
  expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: 'error', headers: { 'X-Hermes-Gateway-Ticket': 'native-ticket-1' } });
  expect(fetch.mock.calls[0][1]?.headers).not.toHaveProperty('X-Hermes-Session-Token');
});

it('authenticates the native socket by subprotocol and reconnects without submitting work', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0, handleProtocols: protocols => protocols.has('hermes-gateway-v1') ? 'hermes-gateway-v1' : false });
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number }, requests: string[] = [], handshakes: string[] = [];
  cleanup.push(() => new Promise<void>(resolve => { for (const socket of server.clients) socket.terminate(); server.close(() => resolve()); }));
  const gateway = new Gateway('', '', [], () => [], 'default', { home: '/fixture', source: '/fixture', python: '/usr/bin/python3' });
  cleanup.push(() => gateway.close());
  vi.spyOn(gateway.native!, 'access').mockResolvedValue({ endpoint: { profile_id: '/fixture', instance_id: 'instance', authority_epoch: 1, runtime_protocol: 1, api_origin: `http://127.0.0.1:${address.port}`, capabilities: ['session-authority-v1'] }, ticket: 'synthetic-ticket' });
  server.on('connection', (socket, request) => {
    handshakes.push(request.url!);
    expect(request.headers['sec-websocket-protocol']).toContain('hermes-gateway-ticket.synthetic-ticket');
    socket.send(JSON.stringify({ method: 'event', params: { type: 'gateway.ready', payload: { replay_epoch: 'legacy-epoch', session_authority: true } } }));
    socket.on('message', bytes => {
      const frame = JSON.parse(bytes.toString()); requests.push(frame.method);
      const result = frame.method === 'runtime.describe' ? { profile_id: '/fixture', instance_id: 'instance', authority_epoch: 1, capabilities: ['durable-admission-v1', 'event-replay-v1'] } : { pong: true };
      socket.send(JSON.stringify({ id: frame.id, result }));
    });
  });
  await gateway.connect(); expect(gateway.protocol).toBe('hermes-gateway-v1');
  expect(await gateway.rpc('gateway.ping', {})).toEqual({ pong: true });
  const disconnected = new Promise<void>(resolve => gateway.once('disconnected', resolve));
  for (const socket of server.clients) socket.close(); await disconnected;
  await gateway.connect();
  expect(handshakes).toEqual(['/api/ws', '/api/ws']);
  expect(requests).toEqual(['runtime.describe', 'ping', 'runtime.describe']);
});
