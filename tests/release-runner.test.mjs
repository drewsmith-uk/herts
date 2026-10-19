import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { parseOptions, selectSpecs, buildOutputs, requireBuild, runBrowserSpecs } from '../scripts/check-release.mjs';

const root = resolve('.');

test('rejects invalid selectors before running commands', () => {
  assert.deepEqual(parseOptions([]), { phase: 'all', shard: null, list: false });
  assert.deepEqual(parseOptions(['--phase=browser', '--shard=2/2']).shard, { index: 2, count: 2 });
  for (const args of [['--phase=other'], ['--shard=1/2'], ['--phase=prepare', '--list'], ['--phase=all', '--phase=browser'],
    ...['0/2', '3/2', '1/0', '1/257', '1.5/2', '1/2/3'].map(shard => ['--phase=browser', `--shard=${shard}`])]) {
    assert.throws(() => parseOptions(args));
  }
  const result = spawnSync(process.execPath, ['scripts/check-release.mjs', '--phase=other'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid option/);
  assert.equal(result.stdout, '');
});

test('groups cover every current and new spec exactly once, regardless of discovery order', () => {
  const seconds = JSON.parse(readFileSync('scripts/browser-timings.json', 'utf8')).seconds;
  const specs = [...readdirSync('tests/browser').filter(name => name.endsWith('.spec.ts')), 'new-test.spec.ts'];
  const groups = [1, 2].map(index => selectSpecs(specs, seconds, { index, count: 2 }));
  assert.deepEqual(groups.flat().sort(), [...specs].sort());
  assert.equal(new Set(groups.flat()).size, specs.length);
  for (const index of [1, 2]) {
    assert.deepEqual(selectSpecs([...specs].reverse(), seconds, { index, count: 2 }), groups[index - 1]);
    const serial = selectSpecs(specs, seconds, null);
    assert.deepEqual(serial.filter(spec => groups[index - 1].includes(spec)), groups[index - 1]);
  }
});

test('balances long specs and uses the median duration for new specs', () => {
  const specs = ['a', 'b', 'c', 'new'];
  const seconds = { a: 10, b: 6, c: 2 };
  assert.deepEqual(selectSpecs(specs, seconds, { index: 1, count: 2 }), ['a', 'c']);
  assert.deepEqual(selectSpecs(specs, seconds, { index: 2, count: 2 }), ['b', 'new']);
  assert.deepEqual(selectSpecs(['b', 'a'], { a: 1, b: 1 }, { index: 1, count: 2 }), ['a']);
  assert.throws(() => selectSpecs(specs, {}, { index: 1, count: 2 }), /no valid durations/);
});

test('the CLI preserves a failed command exit code and stops preparation', () => {
  const fixture = mkdtempSync(resolve(tmpdir(), 'herts-release-exit-'));
  try {
    mkdirSync(resolve(fixture, 'scripts'));
    writeFileSync(resolve(fixture, 'scripts/design.mjs'), 'process.exit(7);');
    const result = spawnSync(process.execPath, [resolve(root, 'scripts/check-release.mjs'), '--phase=prepare'], {
      cwd: fixture, encoding: 'utf8',
    });
    assert.equal(result.status, 7);
    assert.match(result.stderr, /Command failed \(7\)/);
    assert.equal(result.stdout, '');
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

test('requires browser, plugin, and licence outputs, including Notes', () => {
  const fixture = mkdtempSync(resolve(tmpdir(), 'herts-release-build-'));
  try {
    for (const plugin of ['tasks', 'reading', 'bots', 'pinned', 'notes']) {
      const path = plugin === 'notes' ? 'examples/notes' : `plugins/${plugin}`;
      mkdirSync(resolve(fixture, path), { recursive: true });
      writeFileSync(resolve(fixture, path, 'plugin.json'), JSON.stringify({ client: 'client.js', ...(plugin === 'pinned' ? {} : { server: 'server.mjs' }) }));
    }
    assert.throws(() => requireBuild(fixture), /Missing build output/);
    for (const output of buildOutputs(fixture)) {
      mkdirSync(dirname(resolve(fixture, output)), { recursive: true });
      writeFileSync(resolve(fixture, output), 'fixture');
    }
    requireBuild(fixture);
    rmSync(resolve(fixture, 'examples/notes/server.mjs'));
    assert.throws(() => requireBuild(fixture), /examples\/notes\/server.mjs/);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

test('preserves failure timings and stops before another spec', () => {
  const fixture = mkdtempSync(resolve(tmpdir(), 'herts-release-report-'));
  process.chdir(fixture);
  try {
    const calls = [];
    assert.throws(() => runBrowserSpecs(['pass.spec.ts', 'fail.spec.ts', 'unrun.spec.ts'], { shard: { index: 2, count: 2 } }, (command, args, env) => {
      calls.push({ command, args, env });
      if (calls.length === 2) throw new Error('synthetic failure');
    }), /synthetic failure/);
    const report = JSON.parse(readFileSync('test-results/release-timings-2-of-2/timings.json', 'utf8'));
    assert.equal(calls.length, 2);
    assert.deepEqual(report.results.map(row => row.status), ['passed', 'failed']);
    assert.equal(report.selectedSpecs.length, 3);
    assert.ok(report.results.every(row => row.seconds >= 0 && row.group === '2-of-2'));
    assert.match(calls[0].env.PLAYWRIGHT_JSON_OUTPUT_FILE, /pass.spec.ts.json$/);
    assert.match(calls[0].env.HERTS_TEST_DIST_DIR, /release-dist$/);
    assert.ok(calls[0].args.includes('--reporter=line,json'));
  } finally { process.chdir(root); rmSync(fixture, { recursive: true, force: true }); }
});

test('required statuses depend on preparation and both independent browser groups', () => {
  const { jobs } = parse(readFileSync('.github/workflows/quality.yml', 'utf8'));
  assert.deepEqual(jobs.browser.strategy.matrix.shard, [1, 2]);
  assert.equal(jobs.browser.strategy['fail-fast'], false);
  assert.deepEqual(jobs.verify.needs, ['prepare', 'browser']);
  assert.equal(jobs.verify.if, '${{ always() }}');
  assert.match(jobs.verify.steps[0].run, /PREPARE_RESULT.*success.*BROWSER_RESULT.*success/);
  assert.equal(jobs.check.needs, 'verify');
  assert.match(jobs.check.steps[0].run, /VERIFY_RESULT.*success/);
  assert.equal(jobs.check.if, '${{ always() }}');
  for (const prepare of ['success', 'failure', 'cancelled', 'skipped']) {
    for (const browser of ['success', 'failure', 'cancelled', 'skipped']) {
      const result = spawnSync('bash', ['-c', jobs.verify.steps[0].run], {
        env: { ...process.env, PREPARE_RESULT: prepare, BROWSER_RESULT: browser },
      });
      assert.equal(result.status === 0, prepare === 'success' && browser === 'success');
    }
  }
});

test('workflow artifacts support repeated job attempts without name conflicts', () => {
  const { jobs } = parse(readFileSync('.github/workflows/quality.yml', 'utf8'));
  const build = jobs.prepare.steps.find(step => step.with?.name === 'release-build');
  assert.equal(build.with.overwrite, true);
  const download = jobs.browser.steps.find(step => step.uses?.startsWith('actions/download-artifact@'));
  assert.equal(download.with.name, build.with.name);
  const uploads = jobs.browser.steps.filter(step => step.uses?.startsWith('actions/upload-artifact@'));
  const names = uploads.flatMap(step => [1, 2].flatMap(shard => [1, 2].map(attempt =>
    step.with.name.replace('${{ matrix.shard }}', shard).replace('${{ github.run_attempt }}', attempt))));
  assert.equal(new Set(names).size, 8);
  assert.ok(names.every(name => !name.includes('${{')));
});
