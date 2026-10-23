import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function assertRuntime(version = process.version, root = project) {
  const minimum = readFileSync(resolve(root, '.node-version'), 'utf8').trim();
  const floor = stable.exec(minimum)?.slice(1).map(Number);
  if (!floor) throw new Error('Invalid .node-version. Restore the release files.');
  const range = `>=${minimum} <${floor[0] + 1}`;
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  if (manifest.engines?.node !== range) throw new Error('Node.js requirements differ. Restore the release files.');
  const current = /^v/.test(version) ? stable.exec(version.slice(1))?.slice(1).map(Number) : null;
  if (!current || current[0] !== floor[0] || current[1] < floor[1] ||
      (current[1] === floor[1] && current[2] < floor[2])) {
    throw new Error(`Node.js ${version} is unsupported. Install Node.js ${range}.`);
  }
  return range;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(`Node.js ${process.version}: supported (${assertRuntime()}).`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
