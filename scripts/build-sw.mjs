import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const dist = process.argv[2] || 'dist';
const assets = (await readdir(`${dist}/assets`)).map(f => `/assets/${f}`);
const urls = ['/index.html', '/icon.svg', '/manifest.webmanifest', '/voice-shortcut-192.png', ...assets];
for (const size of [192,512]) { try { await readFile(`${dist}/icon-${size}.png`); urls.push(`/icon-${size}.png`); } catch {} }
const version = createHash('sha256').update(await readFile(`${dist}/index.html`)).digest('hex').slice(0,12);
const source = await readFile('public/sw.js','utf8');
await writeFile(`${dist}/sw.js`, source.replace("'tasks-shell-dev'", JSON.stringify(`tasks-shell-${version}`)).replace("['/index.html','/icon.svg','/manifest.webmanifest']", JSON.stringify(urls)));
