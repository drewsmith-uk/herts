import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const dist = process.argv[2] || 'dist';
const assets = (await readdir(`${dist}/assets`)).map(f => `/assets/${f}`);
const urls = ['/index.html', '/icon.svg', '/manifest.webmanifest', '/voice-shortcut-192.png', '/THIRD_PARTY_NOTICES.txt', ...assets];
for (const size of [192,512]) { try { await readFile(`${dist}/icon-${size}.png`); urls.push(`/icon-${size}.png`); } catch {} }
const source = await readFile('public/sw.js','utf8');
const html = (await readFile(`${dist}/index.html`, 'utf8')).replace(/<meta name="herts-build" content="[^"]*">\s*/g, '');
const version = createHash('sha256').update(html).update(source).update(await readFile(`${dist}/manifest.webmanifest`)).update(await readFile(`${dist}/THIRD_PARTY_NOTICES.txt`)).digest('hex').slice(0,12);
await writeFile(`${dist}/index.html`, html.replace('</head>', `<meta name="herts-build" content="tasks-shell-${version}"></head>`));
await writeFile(`${dist}/sw.js`, source.replace("'tasks-shell-dev'", JSON.stringify(`tasks-shell-${version}`)).replace("['/index.html','/icon.svg','/manifest.webmanifest']", JSON.stringify(urls)));
