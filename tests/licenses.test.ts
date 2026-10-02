import { expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { thirdPartyNotices } from '../scripts/licenses.mjs';

it('keeps complete licence texts for bundled packages, including virtual module IDs', async () => {
  const notices = await thirdPartyNotices(['\0node_modules/react/index.js?commonjs-proxy', 'node_modules/react/cjs/react.production.js', 'src/main.tsx']);
  expect(notices.match(/react@/g)).toHaveLength(1);
  expect(notices).toContain(await readFile('node_modules/react/LICENSE', 'utf8'));
  expect(notices).not.toContain(process.cwd());
});

it('ships licence notices alongside minified application and prepared plugin bundles', async () => {
  const notices = await readFile('dist/THIRD_PARTY_NOTICES.txt', 'utf8');
  for (const dependency of ['react', 'react-dom', 'dexie', 'lucide-react']) expect(notices).toContain(`${dependency}@`);
  const chunks = (await readdir('dist/assets')).filter(name => /^(index|markdown|storage)-.*\.js$/.test(name));
  expect(chunks.length).toBeGreaterThanOrEqual(3);
  for (const file of chunks) expect(await readFile(`dist/assets/${file}`, 'utf8')).toContain('Third-party notices: /THIRD_PARTY_NOTICES.txt');
  expect(await readFile('dist/sw.js', 'utf8')).toContain('/THIRD_PARTY_NOTICES.txt');
  for (const plugin of ['plugins/tasks', 'plugins/reading', 'examples/notes']) {
    const pluginNotices = await readFile(`${plugin}/THIRD_PARTY_NOTICES.txt`, 'utf8');
    expect(pluginNotices).toContain('Third-party notices for this Herts build');
    expect(pluginNotices).not.toContain(process.cwd());
  }
});
