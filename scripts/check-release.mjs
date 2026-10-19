import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync, mkdirSync, writeFileSync, statSync, rmSync } from 'node:fs';

const pluginRoots = ['plugins/tasks', 'plugins/reading', 'plugins/bots', 'plugins/pinned', 'examples/notes'];
const dist = '.runtime/release-dist';
const uiFirst = ['ui-consistency.spec.ts', 'bots-ui.spec.ts', 'bots.spec.ts'];
const alphabetical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const releaseOrder = (a, b) => {
  const priority = name => uiFirst.includes(name) ? uiFirst.indexOf(name) : uiFirst.length;
  return priority(a) - priority(b) || alphabetical(a, b);
};

export function parseOptions(args) {
  const options = { phase: 'all', shard: null, list: false };
  const seen = new Set();
  for (const arg of args) {
    const key = arg.split('=')[0];
    if (seen.has(key)) throw new Error(`Repeated option: ${key}`);
    seen.add(key);
    if (/^--phase=(all|prepare|browser)$/.test(arg)) options.phase = arg.slice(8);
    else if (/^--shard=[1-9]\d*\/[1-9]\d*$/.test(arg)) {
      const [index, count] = arg.slice(8).split('/').map(Number);
      if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || index > count || count > 256) {
        throw new Error(`Invalid shard: ${arg}`);
      }
      options.shard = { index, count };
    } else if (arg === '--list') options.list = true;
    else throw new Error(`Invalid option: ${arg}`);
  }
  if ((options.shard || options.list) && options.phase !== 'browser') {
    throw new Error('Use --phase=browser with --shard or --list.');
  }
  return options;
}

export function selectSpecs(specs, seconds, shard) {
  const ordered = [...specs].sort(releaseOrder);
  if (!shard) return ordered;
  const durations = Object.values(seconds).filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!durations.length) throw new Error('Browser timings contain no valid durations.');
  const middle = Math.floor(durations.length / 2);
  const median = durations.length % 2 ? durations[middle] : (durations[middle - 1] + durations[middle]) / 2;
  const duration = name => Number.isFinite(seconds[name]) && seconds[name] > 0 ? seconds[name] : median;
  const groups = Array.from({ length: shard.count }, () => ({ seconds: 0, specs: new Set() }));
  for (const name of [...specs].sort((a, b) => duration(b) - duration(a) || alphabetical(a, b))) {
    const group = groups.reduce((best, next) => next.seconds < best.seconds ? next : best);
    group.specs.add(name);
    group.seconds += duration(name);
  }
  return ordered.filter(name => groups[shard.index - 1].specs.has(name));
}

export function buildOutputs(root = '.') {
  const outputs = [`${dist}/index.html`, `${dist}/sw.js`, `${dist}/THIRD_PARTY_NOTICES.txt`];
  for (const plugin of pluginRoots) {
    const manifest = JSON.parse(readFileSync(resolve(root, plugin, 'plugin.json'), 'utf8'));
    for (const name of [manifest.client, manifest.server, 'THIRD_PARTY_NOTICES.txt'].filter(Boolean)) outputs.push(`${plugin}/${name}`);
  }
  return outputs;
}

export function requireBuild(root = '.') {
  for (const name of buildOutputs(root)) {
    if (!statSync(resolve(root, name), { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Missing build output: ${name}. Run --phase=prepare or download the build artifact.`);
    }
  }
}

function run(command, args, env) {
  const result = spawnSync(command, args, { stdio: 'inherit', env });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(`Command failed (${result.signal || result.status}): ${command} ${args.join(' ')}`);
    error.exitCode = result.status || 1;
    throw error;
  }
}

export function runBrowserSpecs(specs, options, execute = run) {
  const group = options.shard ? `${options.shard.index}-of-${options.shard.count}` : 'all';
  const reportDir = `test-results/release-timings-${group}`;
  rmSync(reportDir, { recursive: true, force: true });
  mkdirSync(reportDir, { recursive: true });
  const report = { group, selectedSpecs: specs, startedAt: new Date().toISOString(), results: [] };
  const save = () => writeFileSync(`${reportDir}/timings.json`, `${JSON.stringify(report, null, 2)}\n`);
  save();
  for (const [i, spec] of specs.entries()) {
    console.log(`Browser spec ${i + 1}/${specs.length}: ${spec}`);
    const started = performance.now();
    const result = { spec, group, status: 'failed', seconds: 0 };
    try {
      execute(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', `tests/browser/${spec}`, '--reporter=line,json', '--output', `test-results/release-${spec.replace('.spec.ts', '')}`], {
        ...process.env,
        HERTS_TEST_DIST_DIR: resolve(dist),
        PLAYWRIGHT_JSON_OUTPUT_FILE: resolve(reportDir, `${spec}.json`),
      });
      result.status = 'passed';
    } finally {
      result.seconds = (performance.now() - started) / 1000;
      report.results.push(result);
      report.finishedAt = new Date().toISOString();
      save();
    }
  }
}

export function main(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  const env = { ...process.env, HERTS_TEST_DIST_DIR: resolve(dist) };
  if (options.phase !== 'browser') {
    run(process.execPath, ['scripts/design.mjs'], env);
    run(process.execPath, ['scripts/check-docs.mjs'], env);
    run(process.execPath, ['--test', 'tests/docs-style.test.mjs', 'tests/release-runner.test.mjs'], env);
    run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], env);
    run(process.execPath, ['scripts/build-plugins.mjs', ...pluginRoots], env);
    run(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', resolve(dist)], env);
    run(process.execPath, ['scripts/build-sw.mjs', resolve(dist)], env);
    run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--maxWorkers=2', '--testTimeout=15000'], env);
    run('python3', ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_installer.py'], env);
  }
  if (options.phase !== 'prepare') {
    const timings = JSON.parse(readFileSync(new URL('./browser-timings.json', import.meta.url), 'utf8'));
    const specs = selectSpecs(readdirSync('tests/browser').filter(name => name.endsWith('.spec.ts')), timings.seconds, options.shard);
    if (options.list) {
      console.log(JSON.stringify(specs, null, 2));
      return;
    }
    requireBuild();
    // Start a fresh server with isolated synthetic data for each spec.
    runBrowserSpecs(specs, options);
  }
  console.log(options.phase === 'all' ? 'Release checks passed. Tested browser assets are in .runtime/release-dist.' : `Release phase passed: ${options.phase}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = error.exitCode || 1; }
}
