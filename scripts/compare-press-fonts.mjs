import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

// Use only the isolated browser fixture. Never connect this script to a live installation.
const origin = 'http://127.0.0.1:8790';
let occupied = false;
try { await fetch(origin); occupied = true; } catch {}
if (occupied) throw new Error('Stop the existing test fixture before this comparison.');
const output = resolve('.runtime/font-comparison');
await mkdir(output, { recursive: true });
const candidates = [
  { name: 'Current', family: '', file: '', folder: '' },
  { name: 'Archivo Black', family: 'Archivo Comparison', file: 'ArchivoBlack-Regular.ttf', folder: 'archivoblack' },
  { name: 'Barlow Black', family: 'Barlow Comparison', file: 'Barlow-Black.ttf', folder: 'barlow' },
];
const manifest = [];
for (const candidate of candidates.slice(1)) {
  for (const [source, target] of [[candidate.file, candidate.file], ['OFL.txt', `${candidate.name.replaceAll(' ', '')}-OFL.txt`]]) {
    const url = `https://raw.githubusercontent.com/google/fonts/main/ofl/${candidate.folder}/${source}`;
    let bytes;
    try { bytes = await readFile(resolve(output, target)); }
    catch { const response = await fetch(url); if (!response.ok) throw new Error(`Download failed: ${url}`); bytes = Buffer.from(await response.arrayBuffer()); await writeFile(resolve(output, target), bytes); }
    manifest.push({ file: target, source: url, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  candidate.data = (await readFile(resolve(output, candidate.file))).toString('base64');
}
const server = spawn(process.execPath, ['--import', 'tsx', 'tests/browser-server.ts'], { env: { ...process.env, HERTS_TEST_DIST_DIR: resolve(process.env.HERTS_TEST_DIST_DIR || '.runtime/release-dist') }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; server.stdout.on('data', value => { log += value; }); server.stderr.on('data', value => { log += value; });
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(log);
    try { ready = (await fetch(`${origin}/api/v1/state`)).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('The fixture did not start.');
  const post = async (path, data) => { const response = await fetch(origin + path, { method: 'POST', headers: {'content-type':'application/json','x-herts-request':'1'}, body:JSON.stringify(data) }); if (!response.ok) throw new Error(await response.text()); };
  const taskId=randomUUID(), itemId=randomUUID();
  const title='Prepare the quarterly project review and discuss the research findings';
  await post('/api/v1/sync',{id:randomUUID(),taskId,kind:'create',title,at:Date.now()});
  await post('/api/v1/reading/sync',{id:randomUUID(),itemId,contextId:randomUUID(),kind:'create',title,url:'https://example.com/font-comparison',at:Date.now()});
  browser=await chromium.launch({channel:'chromium'});
  const shots=[];
  for(const candidate of candidates) {
    const context=await browser.newContext();
    if(candidate.file) await context.route('**/__comparison/fonts/*',route=>route.fulfill({contentType:'font/ttf',body:Buffer.from(candidate.data,'base64')}));
    const page=await context.newPage();
    for(const width of [390,1280]) for(const [screen,path] of [['Tasks','/tasks/inbox'],['Reading',`/reader/${itemId}`],['Discussion',`/reading-item/${itemId}`],['Settings','/settings']]) {
      await page.setViewportSize({width,height:844});
      await page.goto(origin+'/#'+path);
      await page.reload();
      await page.locator('h1:visible').first().waitFor();
      if(screen==='Reading') await page.locator('.reader-article').waitFor();
      if(screen==='Tasks') await page.getByLabel('Add a task',{exact:true}).waitFor();
      if(candidate.family) {
        await page.addStyleTag({content:`@font-face{font-family:'${candidate.family}';src:url(/__comparison/fonts/${candidate.file});font-weight:400 900;font-display:swap;} :root{--font-heading:'${candidate.family}'!important;}`});
        await page.evaluate(family=>document.fonts.load(`900 32px "${family}"`),candidate.family);
      }
      await page.evaluate(()=>document.fonts.ready);
      const file=`${candidate.name.replaceAll(' ','-')}-${screen}-${width}.png`;
      await page.screenshot({path:resolve(output,file)});shots.push({candidate:candidate.name,screen,width,file});
      if(screen==='Reading' && width===390) {
        await context.setOffline(true);
        await page.screenshot({path:resolve(output,`${candidate.name.replaceAll(' ','-')}-offline.png`)});
        await context.setOffline(false);
        await page.addStyleTag({content:'html{font-size:200%!important}'});
        await page.screenshot({path:resolve(output,`${candidate.name.replaceAll(' ','-')}-enlarged.png`)});
      }
    }
    await context.close();
  }
  await writeFile(resolve(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  await writeFile(resolve(output,'index.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Press heading comparison</title><style>body{font:16px system-ui;margin:24px;background:#f7f5f0;color:#151515}section{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}img{max-width:100%;border:1px solid}figure{margin:0}h2{grid-column:1/-1}@media(max-width:700px){section{grid-template-columns:1fr}}</style><h1>Press heading comparison</h1><p>Production typography is unchanged. These screenshots use isolated synthetic data.</p><p>Archivo Black and Barlow Black use the SIL Open Font License 1.1. License files accompany this comparison.</p><p>Loaded comparison fonts remain available after disconnecting. Native device rendering remains unverified.</p><p><a href="manifest.json">Sources, sizes, and checksums</a></p><section>${['Tasks','Reading','Discussion','Settings'].flatMap(screen=>[390,1280].map(width=>`<h2>${screen}: ${width} pixels</h2>${shots.filter(shot=>shot.screen===screen&&shot.width===width).map(shot=>`<figure><figcaption>${shot.candidate}</figcaption><a href="${shot.file}"><img src="${shot.file}" alt="${shot.candidate}: ${screen} at ${width} pixels"></a></figure>`).join('')}`)).join('')}</section><h2>Additional checks</h2><ul>${candidates.map(candidate=>`<li>${candidate.name}: <a href="${candidate.name.replaceAll(' ','-')}-offline.png">Offline</a>, <a href="${candidate.name.replaceAll(' ','-')}-enlarged.png">Enlarged text</a></li>`).join('')}</ul></html>`);
  console.log(resolve(output,'index.html'));
} finally { await browser?.close(); server.kill('SIGTERM'); }
