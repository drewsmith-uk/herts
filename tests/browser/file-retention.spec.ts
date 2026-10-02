import { test, expect, type Page } from '@playwright/test';

async function rows(page: Page, table: string) {
  return page.evaluate(async table => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('hermes-tasks'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try { return await new Promise<any[]>((resolve, reject) => { const r = database.transaction(table).objectStore(table).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
    finally { database.close(); }
  }, table);
}
test('removing an attachment and deleting its draft leaves no file bytes behind', async ({ page }) => {
  await page.goto('/#/new'); await page.getByLabel('Message Hermes').fill('Synthetic private draft');
  await page.locator('input[type=file]').setInputFiles({ name: 'private.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic private file') });
  await expect(page.getByRole('button', { name: 'Remove private.txt' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove private.txt' }).click();
  await expect.poll(() => rows(page, 'files')).toEqual([]);
  await page.goto('/#/conversations'); await page.getByRole('button', { name: /^Delete draft:/ }).click();
  await page.getByRole('button', { name: 'Delete draft', exact: true }).click();
  await expect(page.locator('.draft-open')).toHaveCount(0); expect(await rows(page, 'files')).toEqual([]);
});
test('dictation clears transient audio only after the transcript is durably saved', async ({ page, request }) => {
  let transcription: { id: string; uploadId: string } | undefined;
  page.on('request', req => { if (req.url().endsWith('/api/v1/audio/transcribe')) transcription = req.postDataJSON(); });
  await page.goto('/#/new'); await page.getByRole('button', { name: 'Dictate', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop recording and transcribe' })).toBeVisible();
  await page.waitForTimeout(1200); await page.getByRole('button', { name: 'Stop recording and transcribe' }).click();
  await expect(page.getByLabel('Message Hermes')).toHaveValue('Please draft a packing list.');
  await expect.poll(async () => (await rows(page, 'recordings')).length).toBe(0);
  await expect.poll(async () => (await rows(page, 'files')).length).toBe(0);
  await expect.poll(async () => (await request.get(`/api/v1/uploads/${transcription!.uploadId}`)).status()).toBe(404);
  const replay = await request.post('/api/v1/audio/transcribe', { headers: { 'x-herts-request': '1' }, data: transcription });
  expect(replay.status()).toBe(410);
  await page.reload(); await expect(page.getByLabel('Message Hermes')).toHaveValue('Please draft a packing list.');
});
for (const width of [390, 1280]) test(`failed transcription retains recoverable audio with usable deletion at ${width}px`, async ({ page, request }) => {
  await page.setViewportSize({ width, height: 844 });
  let transcription: { id: string; uploadId: string } | undefined;
  await page.route('**/api/v1/audio/transcribe', async route => { transcription = route.request().postDataJSON(); await route.fulfill({ status: 503, json: { error: 'Synthetic transcription unavailable' } }); });
  await page.goto('/#/new'); await page.getByRole('button', { name: 'Dictate', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop recording and transcribe' })).toBeVisible();
  await page.waitForTimeout(1200); await page.getByRole('button', { name: 'Stop recording and transcribe' }).click();
  await expect(page.getByRole('button', { name: 'Transcribe saved recording', exact: true })).toBeVisible();
  expect((await rows(page, 'recordings')).length).toBe(1); expect((await rows(page, 'files')).length).toBe(1);
  await page.getByRole('button', { name: 'Delete saved recording', exact: true }).click();
  await expect.poll(async () => (await rows(page, 'recordings')).length).toBe(0);
  await expect.poll(async () => (await rows(page, 'files')).length).toBe(0);
  await expect.poll(async () => (await request.get(`/api/v1/uploads/${transcription!.uploadId}`)).status()).toBe(404);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a lost transcription reply recovers the same request and defers offline cleanup', async ({ page, request }) => {
  const attempts: { id: string; uploadId: string }[] = [];
  await page.route('**/api/v1/audio/discard', route => route.abort());
  await page.route('**/api/v1/audio/transcribe', async route => {
    attempts.push(route.request().postDataJSON());
    if (attempts.length === 1) { await route.fetch(); await route.abort(); }
    else await route.continue();
  });
  await page.goto('/#/new'); await page.getByRole('button', { name: 'Dictate', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop recording and transcribe' })).toBeVisible();
  await page.waitForTimeout(1200); await page.getByRole('button', { name: 'Stop recording and transcribe' }).click();
  await page.getByRole('button', { name: 'Transcribe saved recording', exact: true }).click();
  await expect(page.getByLabel('Message Hermes')).toHaveValue('Please draft a packing list.');
  expect(attempts).toHaveLength(2); expect(attempts[1]).toEqual(attempts[0]);
  await expect.poll(() => rows(page, 'recordings')).toEqual([]);
  await expect.poll(() => rows(page, 'files')).toEqual([]);
  expect((await request.get(`/api/v1/uploads/${attempts[0].uploadId}`)).status()).toBe(200);
  await page.unroute('**/api/v1/audio/discard'); await page.reload();
  await expect(page.getByLabel('Message Hermes')).toHaveValue('Please draft a packing list.');
  await expect.poll(async () => (await request.get(`/api/v1/uploads/${attempts[0].uploadId}`)).status()).toBe(404);
});

test('removing an attachment preserves other drafts, plugin data and pending journal references', async ({ page }) => {
  await page.goto('/#/new'); await page.getByLabel('Message Hermes').fill('Shared attachment');
  await page.locator('input[type=file]').setInputFiles({ name: 'shared.txt', mimeType: 'text/plain', buffer: Buffer.from('Shared private file') });
  await expect(page.getByRole('button', { name: 'Remove shared.txt' })).toBeVisible();
  const file = (await rows(page, 'files'))[0];
  await page.evaluate(async id => {
    const database = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('hermes-tasks'); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(['drafts', 'pluginLocal'], 'readwrite');
      tx.objectStore('drafts').put({ id: 'another-draft', text: 'Still needed', files: [id] });
      tx.objectStore('pluginLocal').put({ key: 'notes:0:fixture', value: { attachments: { [id]: { name: 'Shared file' } } } });
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    }); database.close();
    localStorage.setItem('herts:draft-head:notes:0:fixture', 'pending');
    localStorage.setItem('herts:draft-write:notes:0:fixture:pending', JSON.stringify({ files: [id] }));
  }, file.id);
  await page.getByRole('button', { name: 'Remove shared.txt' }).click();
  await expect.poll(async () => (await rows(page, 'files'))[0]?.discardRequested).toBe(true);
  await page.reload(); expect((await rows(page, 'files'))[0].id).toBe(file.id);
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('hermes-tasks'); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>((resolve, reject) => { const tx = database.transaction(['drafts', 'pluginLocal'], 'readwrite'); tx.objectStore('drafts').delete('another-draft'); tx.objectStore('pluginLocal').delete('notes:0:fixture'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); database.close();
  });
  await page.reload(); expect((await rows(page, 'files'))[0].id).toBe(file.id);
  await page.evaluate(() => { localStorage.removeItem('herts:draft-head:notes:0:fixture'); localStorage.removeItem('herts:draft-write:notes:0:fixture:pending'); });
  await page.reload(); await expect.poll(() => rows(page, 'files')).toEqual([]);
});

test('old unreferenced files get a recovery day before device cleanup', async ({ page }) => {
  await page.goto('/#/new'); await expect(page.getByLabel('Message Hermes')).toBeEditable();
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('hermes-tasks'); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>((resolve, reject) => { const tx = database.transaction('files', 'readwrite'); tx.objectStore('files').put({ id: 'old-orphan', blob: new Blob(['Legacy audio']), name: 'dictation.webm', hash: 'fixture' }); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); database.close();
  });
  await page.reload();
  await expect.poll(async () => (await rows(page, 'files'))[0]?.unreferencedAt).toBeGreaterThan(0);
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('hermes-tasks'); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>((resolve, reject) => { const tx = database.transaction('files', 'readwrite'), store = tx.objectStore('files'), get = store.get('old-orphan'); get.onsuccess = () => store.put({ ...get.result, unreferencedAt: Date.now() - 25 * 60 * 60 * 1000 }); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); database.close();
  });
  await page.reload(); await expect.poll(() => rows(page, 'files')).toEqual([]);
});
