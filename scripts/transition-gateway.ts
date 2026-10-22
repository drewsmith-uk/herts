import { join } from 'node:path';
import { configuration } from '../server/config.js';
import { Gateway } from '../server/gateway.js';
import { Store } from '../server/store.js';
import { transitionToGateway } from '../server/targetTransition.js';

process.umask(0o077);
if (process.argv.slice(2).some(arg => arg !== '--apply')) throw new Error('Use --apply to save a verified transition.');
const config = configuration({ ...process.env, HERMES_CONNECTION: 'gateway' });
if (!config.hermesBase || !config.hermesToken) throw new Error('Keep the standalone endpoint and credentials during verification.');
const store = new Store(join(config.dataDir, 'tasks.sqlite'));
const old = new Gateway(config.hermesBase, config.hermesToken, [], () => [], config.hermesProfile);
try {
  const result = await transitionToGateway(store, old, config.hermesNative!, process.argv.includes('--apply'));
  console.log(`${result.applied ? 'Saved' : 'Verified'} gateway transition: ${result.conversations} conversation identities checked.`);
} finally { old.close(); store.close(); }
