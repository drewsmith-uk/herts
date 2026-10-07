/** Opt-in contract smoke check. All writes go to a fresh Hermes home; no model prompts. */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import { Gateway } from '../server/gateway.js';
import { Store } from '../server/store.js';
import { Actions } from '../server/actions.js';
import { Bots } from '../server/bots.js';
import { randomUUID } from 'node:crypto';
import type { ActionEffects } from '../shared/bots.js';

const source = process.argv[2];
if (!source) throw new Error('Usage: node --import tsx scripts/check-bots-source.ts /path/to/hermes-agent');
const root = await mkdtemp(join(tmpdir(), 'herts-bots-contract-'));
const home = join(root, 'hermes'); await mkdir(home);
await writeFile(join(home, 'config.yaml'), 'timezone: Europe/London\nmodel:\n  provider: openrouter\n  default: fixture-unconfigured-model\n', { mode: 0o600 });
const port = await new Promise<number>((resolvePort, reject) => { const server = createServer(); server.on('error', reject); server.listen(0, '127.0.0.1', () => { const address = server.address() as { port: number }; server.close(() => resolvePort(address.port)); }); });
const env: NodeJS.ProcessEnv = {};
for (const key of ['PATH', 'HOME', 'LANG', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE']) if (process.env[key]) env[key] = process.env[key];
Object.assign(env, { HERMES_HOME: home, HERMES_DASHBOARD_SESSION_TOKEN: 'herts-isolated-bots-fixture', PYTHONPATH: resolve(source), PYTHONDONTWRITEBYTECODE: '1', HERMES_DISABLE_LAZY_INSTALLS: '1' });
// Exercise the installed API with its existing dependencies, without allowing
// Hermes's import bootstrap to update the user's source installation.
const child = spawn(join(resolve(source), '.venv/bin/python'), ['-c', 'import sys; from hermes_cli.web_server import start_server; start_server(host="127.0.0.1", port=int(sys.argv[1]), open_browser=False, headless=True, isolated=True)', String(port)], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { log = (log + data.toString()).slice(-10000); });
const store = new Store(':memory:'); store.bindProfiles('default');
const gateway = new Gateway(`http://127.0.0.1:${port}`, 'herts-isolated-bots-fixture', [], () => store.contexts().flatMap(c => c.aliases));
gateway.botChats = (profile, id) => store.contexts().some(c => c.botChat && c.profile === profile && c.aliases.includes(id));
const actions = new Actions(store, gateway, root), bots = new Bots(store, gateway, actions);
const effects = (): ActionEffects => ({ id: randomUUID(), check() {}, effect: (_, run) => run() });
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error(`Isolated Hermes exited: ${log}`);
    try { const result = await fetch(`http://127.0.0.1:${port}/api/profiles`, { headers: { 'X-Hermes-Session-Token': 'herts-isolated-bots-fixture' }, signal: AbortSignal.timeout(1000) }); if (result.ok) { ready = true; break; } } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 1000));
  }
  assert.ok(ready, `Hermes did not become ready: ${log}`);
  await gateway.connect();
  const created = await gateway.rpc('profiles.create', { name: 'herts_fixture', description: 'Synthetic integration profile', mirror_credentials: false, no_alias: true });
  assert.equal(created.ok, true);
  const detail = await bots.describeBot('herts_fixture');
  await bots.configureBot({ name: detail.name, title: 'Fixture Bot', description: 'Synthetic', soul: 'Synthetic persona.', revision: detail.revision }, effects());
  const first = await bots.openBot('herts_fixture', effects());
  const again = await bots.openBot('herts_fixture', effects());
  assert.equal(first.id, again.id); assert.equal(first.profile, 'herts_fixture');
  const history = await gateway.history(first.link!.storedId, 0); assert.equal(history.profile, 'herts_fixture'); assert.equal(history.messages.length, 0);
  assert.equal((await bots.routines('default')).timezone, 'Europe/London');
  const jobs = await bots.routines('herts_fixture'); assert.equal(jobs.jobs.length, 0);
  // Create far in the future and remove it immediately; never trigger agent work.
  await bots.changeRoutine('create', { profile: 'herts_fixture', name: 'Synthetic future routine', prompt: 'Synthetic fixture', schedule: '2099-01-01T09:00:00', deliver: 'local' }, effects());
  const job = (await bots.routines('herts_fixture')).jobs.find(row => row.name === 'Synthetic future routine'); assert.ok(job);
  await bots.changeRoutine('pause', { profile: 'herts_fixture', id: job.id }, effects());
  assert.equal((await bots.routines('herts_fixture')).jobs.find(row => row.id === job.id)?.enabled, false);
  await bots.changeRoutine('update', { profile: 'herts_fixture', id: job.id, name: job.name, prompt: 'Updated synthetic fixture', schedule: '2099-01-02T09:00:00', deliver: 'local' }, effects());
  assert.equal((await bots.routines('herts_fixture')).jobs.find(row => row.id === job.id)?.prompt, 'Updated synthetic fixture');
  await bots.changeRoutine('remove', { profile: 'herts_fixture', id: job.id }, effects());
  assert.equal((await bots.routines('herts_fixture')).jobs.length, 0);
  console.log('PASS: isolated Hermes profiles, metadata, canonical chat, history, timezone and routine CRUD; no prompts submitted.');
} finally {
  actions.close(); gateway.close();
  child.kill('SIGTERM');
  await Promise.race([new Promise<void>(r => child.once('exit', () => r())), new Promise<void>(r => setTimeout(r, 5000))]);
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await new Promise<void>(r => child.once('exit', () => r())); }
  store.close(); await rm(root, { recursive: true, force: true });
}
