import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readdirSync } from 'node:fs';

// Test a complete release without replacing the browser bundle served to users.
const dist = resolve('.runtime/release-dist');
const env = { ...process.env, HERTS_TEST_DIST_DIR: dist };
const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit', env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
};
run(process.execPath, ['scripts/check-docs.mjs']);
run(process.execPath, ['--test', 'tests/docs-style.test.mjs']);
run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit']);
run(process.execPath, ['scripts/build-plugins.mjs', 'plugins/tasks', 'plugins/reading', 'plugins/bots', 'examples/notes']);
run(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', dist]);
run(process.execPath, ['scripts/build-sw.mjs', dist]);
run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--maxWorkers=2', '--testTimeout=15000']);
run('python3', ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_installer.py']);
// Spec files must not inherit another file's linked conversations, pending
// actions or background downloads. Every spec gets a fresh synthetic server.
const uiFirst = ['ui-consistency.spec.ts', 'bots-ui.spec.ts', 'bots.spec.ts'];
const specs = readdirSync('tests/browser').filter(name => name.endsWith('.spec.ts')).sort((a, b) => {
  const priority = name => uiFirst.includes(name) ? uiFirst.indexOf(name) : uiFirst.length;
  return priority(a) - priority(b) || a.localeCompare(b);
});
for (const [i, spec] of specs.entries()) {
  console.log(`Browser spec ${i + 1}/${specs.length}: ${spec}`);
  run(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', `tests/browser/${spec}`, '--output', `test-results/release-${spec.replace('.spec.ts', '')}`]);
}
console.log('Release checks passed. Tested browser assets are in .runtime/release-dist.');
