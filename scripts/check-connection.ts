import { configuration } from '../server/config.js';
import { Gateway } from '../server/gateway.js';

// Only status, session metadata and a gateway ping. Never create, resume or send.
let gateway: Gateway | undefined;
try {
  const config = configuration();
  const response = await fetch(`${config.origin}/api/v1/state`, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Herts access check failed (${response.status}). Check Tailscale, the configured origin and identity.`);
  const state = await response.json().catch(() => { throw new Error('Herts returned an invalid status response.'); });
  if (!state.snapshot || !state.gateway) throw new Error('The app returned an incompatible status response.');
  console.log('Herts authenticated access: OK.');
  if (config.hermesBase) {
    gateway = new Gateway(config.hermesBase, config.hermesToken, [], () => [], config.hermesProfile);
    const result = await gateway.http(`/api/sessions?profile=${encodeURIComponent(config.hermesProfile)}&limit=1&order=recent&archived=include`);
    if (!Array.isArray(result.sessions) || result.sessions.some((row: any) => row.profile !== config.hermesProfile)) throw new Error('Hermes session listing/profile identity could not be verified. Check backend compatibility and HERMES_PROFILE.');
    await gateway.rpc('gateway.ping', {}, 15_000);
    console.log('Hermes session listing and gateway connection: OK. No agent work was started.');
  } else console.log('Tasks-only configuration: Hermes checks skipped.');
} catch (error) {
  // Gateway errors are redacted; fetch errors and server bodies may contain private URLs.
  console.error(error instanceof Error && error.message !== 'fetch failed' ? error.message : 'Connection failed. Check that the app is reachable through Tailscale.');
  process.exitCode = 1;
} finally { gateway?.close(); }
