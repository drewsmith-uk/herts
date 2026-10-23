import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { assertRuntime } from '../scripts/check-runtime.mjs';

test('accepts patched stable releases and rejects unsupported runtimes', () => {
  for (const version of ['v24.22.1', 'v24.22.2', 'v24.23.0']) assertRuntime(version);
  for (const version of ['v22.23.4', 'v24.22.0', 'v24.21.9', 'v25.6.1', 'v26.12.1',
    'v24.22.1-rc.1', '24.22.1', 'v24.22', 'v024.22.1', 'invalid']) {
    assert.throws(() => assertRuntime(version), /unsupported.*>=24.22.1 <25/);
  }
});

test('rejects inconsistent requirements before starting work', () => {
  const root = mkdtempSync(join(tmpdir(), 'herts-runtime-'));
  try {
    writeFileSync(join(root, '.node-version'), '24.22.1\n');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ engines: { node: '>=24' } }));
    assert.throws(() => assertRuntime('v24.22.1', root), /requirements differ/);
    writeFileSync(join(root, '.node-version'), '24.22.1-rc.1\n');
    assert.throws(() => assertRuntime('v24.22.1', root), /Invalid .node-version/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('CI, npm, and service startup enforce the runtime contract', () => {
  const { jobs } = parse(readFileSync('.github/workflows/quality.yml', 'utf8'));
  for (const job of [jobs.prepare, jobs.browser]) {
    const setup = job.steps.find(step => step.uses?.startsWith('actions/setup-node@'));
    assert.equal(setup.with['node-version-file'], '.node-version');
    assert.equal(setup.with['node-version'], undefined);
  }
  assert.match(readFileSync('.npmrc', 'utf8'), /^engine-strict=true$/m);
  assert.match(readFileSync('deploy/herts.service.in', 'utf8'), /^ExecStartPre=@NODE@ scripts\/check-runtime.mjs$/m);
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(manifest.scripts.prestart, 'npm run check:runtime');
});
