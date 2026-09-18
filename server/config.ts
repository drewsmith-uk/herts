import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Store } from './store.js';

/** The old names remain valid so upgrades need no credential or device migration. */
export function configuration(env: NodeJS.ProcessEnv = process.env) {
  const setting = (name: string) => env[`HERTS_${name}`] ?? env[`TASKS_${name}`];
  const dev = setting('DEV') === '1';
  const port = Number(setting('PORT') ?? env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('HERTS_PORT must be a port from 1 to 65535.');
  const origin = setting('ORIGIN') ?? (dev ? `http://127.0.0.1:${port}` : '');
  let url: URL;
  try { url = new URL(origin); } catch { throw new Error('Set HERTS_ORIGIN to the app’s Tailscale HTTPS origin.'); }
  if (url.origin !== origin || url.username || url.password || (!dev && url.protocol !== 'https:') || !['http:', 'https:'].includes(url.protocol)) throw new Error('HERTS_ORIGIN must be an origin without a path, credentials, query or fragment; HTTPS is required in production.');
  const identity = setting('IDENTITY')?.trim() || '';
  if (!dev && !identity) throw new Error('Set HERTS_IDENTITY to your exact Tailscale user login.');
  const hermesBase = backendOrigin(env.HERMES_BASE_URL || '');
  const hermesProfile = env.HERMES_PROFILE || 'default';
  validateProfile(hermesProfile);
  let hermesToken = env.HERMES_TOKEN?.trim() || '';
  if (env.HERMES_TOKEN_FILE) {
    try { hermesToken = readFileSync(env.HERMES_TOKEN_FILE, 'utf8').trim(); }
    catch { throw new Error('HERMES_TOKEN_FILE could not be read. Check its path and permissions.'); }
  }
  if (!!hermesBase !== !!hermesToken) throw new Error('Configure both HERMES_BASE_URL and HERMES_TOKEN_FILE (or HERMES_TOKEN), or leave both unset for tasks-only use.');
  if (/[\r\n]/.test(hermesToken)) throw new Error('The Hermes token must be a single line.');
  return { dataDir: resolve(setting('DATA_DIR') || 'data'), origin, identity, dev, port, hermesBase, hermesToken, hermesProfile, excluded: (env.HERMES_EXCLUDED_CONVERSATIONS || '').split(',').map(v => v.trim()).filter(Boolean) };
}
export function validateProfile(profile: string) {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(profile)) throw new Error('HERMES_PROFILE must be a Hermes profile name (lowercase letters, digits, underscores and hyphens).');
}
export function backendOrigin(base: string) {
  if (!base) return '';
  let url: URL;
  try { url = new URL(base); } catch { throw new Error('HERMES_BASE_URL must be an HTTP(S) origin.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('HERMES_BASE_URL requires HTTPS, except on loopback, and cannot contain a path, credentials, query or fragment.');
  return url.origin;
}
/** Prevent stored IDs being interpreted against an unrelated backend or profile. */
export function bindHermesTarget(store: Store, base: string, profile: string) {
  validateProfile(profile);
  if (!base) return; // A temporary tasks-only start does not forget the previous target.
  const target = { base: backendOrigin(base), profile };
  const previous = store.getMeta<typeof target>('hermesTarget');
  const snapshot = store.snapshot();
  const hasLinks = store.contexts().some(c => c.link) || snapshot.tasks.some(t => t.link) || store.bindings().length > 0 || store.actions().length > 0 || !!snapshot.hiddenConversations?.length;
  if (hasLinks && ((!previous && profile !== 'default') || (previous && (previous.base !== target.base || previous.profile !== profile)))) throw new Error('This data directory is linked to a different Hermes target. Restore the original endpoint/profile, or use a separate HERTS_DATA_DIR.');
  // Legacy installs used only the default profile. Their first upgrade pins the
  // explicitly configured endpoint; operators must retain that endpoint on upgrade.
  store.setMeta('hermesTarget', target);
}
