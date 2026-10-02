import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { builtinThemes, themeStorageKey } from '../../shared/themeValues';

const headers = { 'x-herts-request': '1' };
const calls = async (request: APIRequestContext) => ((await (await request.get('http://127.0.0.1:8791/calls')).json()) as string[]).filter(m => ['session.create', 'session.resume', 'prompt.submit', 'file.attach', 'session.interrupt'].includes(m));
async function seed(request: APIRequestContext, text: string, options: { attachment?: boolean; submitted?: boolean } = {}) {
  const stored = `saved-${randomUUID()}`;
  await request.post('/__test/conversation-message', { headers, data: { id: stored, title: 'Saved message recovery', text: 'Existing conversation history stays here.' } });
  const { context } = await (await request.post(`/api/v1/conversations/${stored}/context`, { headers, data: {} })).json();
  const uploadIds: string[] = [];
  if (options.attachment) {
    const id = randomUUID(), buffer = Buffer.from('Original attachment contents');
    await request.post('/api/v1/uploads', { headers, data: { id, name: 'original.txt', type: 'text/plain', size: buffer.length, hash: createHash('sha256').update(buffer).digest('hex') } });
    expect((await request.put(`/api/v1/uploads/${id}?offset=0`, { data: buffer, headers: { ...headers, 'content-type': 'application/octet-stream' } })).ok()).toBe(true);
    uploadIds.push(id);
  }
  const { action } = await (await request.post('/__test/saved-message', { headers, data: { contextId: context.id, text, uploadIds, submitted: options.submitted } })).json();
  return { url: `/#/conversation/${stored}`, action, contextId: context.id };
}
async function expand(page: Page, id: string) {
  const card = page.locator(`[data-saved-message="${id}"]`);
  await card.locator('summary').click(); return card;
}

for (const width of [390, 1280]) test(`saved messages copy into existing input with attachments and delete across devices at ${width}px`, async ({ page, request, browser }) => {
  await page.setViewportSize({ width, height: 844 });
  if (width === 390) await page.addInitScript(({ key, theme }) => localStorage.setItem(key, JSON.stringify({ id: theme.id, theme })), { key: themeStorageKey, theme: builtinThemes.find(t => t.id === 'press')! });
  const text = 'Ok what is the current status?', fixture = await seed(request, text, { attachment: true }), before = await calls(request);
  await page.goto(fixture.url);
  await page.getByLabel('Message Hermes').fill('Keep my new notes.');
  await page.locator('input[type=file]').setInputFiles({ name: 'current.txt', mimeType: 'text/plain', buffer: Buffer.from('New attachment') });
  let card = await expand(page, fixture.action.id);
  await expect(card.getByRole('button', { name: 'Use this message' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await card.getByRole('button', { name: 'Use this message' }).scrollIntoViewIfNeeded();
  await card.screenshot({ path: `output/saved-messages/actions-${width}.png` });
  await card.getByRole('button', { name: 'Use this message' }).click();
  await expect(page.getByLabel('Message Hermes')).toHaveValue(`Keep my new notes.\n\n${text}`);
  await expect(page.getByLabel('Message Hermes')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Remove original.txt' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove current.txt' })).toBeVisible();
  await expect(page.getByText('Added to your draft.')).toBeVisible();
  expect(await calls(request)).toEqual(before);
  await page.reload();
  await expect(page.getByLabel('Message Hermes')).toHaveValue(`Keep my new notes.\n\n${text}`);
  card = await expand(page, fixture.action.id);
  await card.getByRole('button', { name: 'Delete', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete saved message?' });
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(card).toBeVisible();
  const other = await browser.newContext(), second = await other.newPage();
  try {
    await second.goto(`http://127.0.0.1:8790${fixture.url}`);
    await expect(second.locator(`[data-saved-message="${fixture.action.id}"]`)).toBeVisible();
    await card.getByRole('button', { name: 'Delete', exact: true }).click();
    await dialog.getByRole('button', { name: 'Delete saved message', exact: true }).click();
    await expect(card).toHaveCount(0);
    await expect(second.locator(`[data-saved-message="${fixture.action.id}"]`)).toHaveCount(0);
    await page.reload();
    await expect(page.locator(`[data-saved-message="${fixture.action.id}"]`)).toHaveCount(0);
    await expect(page.getByLabel('Message Hermes')).toHaveValue(`Keep my new notes.\n\n${text}`);
    await expect(page.getByText('Existing conversation history stays here.', { exact: true })).toBeVisible();
    await page.getByLabel('Message Hermes').focus();
    await expect(page.getByRole('button', { name: 'Remove original.txt' })).toBeVisible();
    const action = (await (await request.get(`/api/v1/actions/${fixture.action.id}`)).json()).action;
    expect(action).toMatchObject({ savedMessageDeletedAt: expect.any(Number), text: '', uploadIds: [], state: fixture.action.state, receipt: fixture.action.receipt });
    expect((await request.get(`/api/v1/uploads/${fixture.action.uploadIds[0]}`)).status()).toBe(404);
    expect(await calls(request)).toEqual(before);
    // Only the explicit Send should start new work, with both attachments.
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase', 'complete');
    const after = (await calls(request)).slice(before.length);
    expect(after.filter(m => m === 'prompt.submit')).toHaveLength(1);
    expect(after.filter(m => m === 'file.attach')).toHaveLength(2);
  } finally { await other.close(); }
});

test('reconnecting removes deleted saved content and local submission copies without erasing independent drafts', async ({ page, request, browser }) => {
  const fixture = await seed(request, 'Synthetic content to delete', { attachment: true });
  await page.goto(fixture.url);
  const card = await expand(page, fixture.action.id); await card.getByRole('button', { name: 'Use this message' }).click();
  const peer = await browser.newContext(), second = await peer.newPage();
  const inspect = async (page: Page) => page.evaluate(async ({ id, uploadId }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('hermes-tasks'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try {
      const read = (store: string, key: string) => new Promise<any>((resolve, reject) => { const r = database.transaction(store).objectStore(store).get(key); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const saved = await read('kv', 'state');
      return { action: saved?.value?.actions?.find((a: any) => a.id === id), submission: !!await read('submissions', id), file: !!await read('files', uploadId) };
    } finally { database.close(); }
  }, { id: fixture.action.id, uploadId: fixture.action.uploadIds[0] });
  try {
    await second.goto('http://127.0.0.1:8790' + fixture.url);
    await expect(second.locator(`[data-saved-message="${fixture.action.id}"]`)).toBeVisible();
    // Simulate an older client retaining its outgoing request and cached attachment.
    await second.evaluate(async ({ action, contextId }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('hermes-tasks'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = database.transaction(['submissions', 'files'], 'readwrite');
          tx.objectStore('submissions').put({ id: action.id, input: { id: action.id, contextId, kind: 'send', text: action.text, uploadIds: action.uploadIds }, at: Date.now(), confirmed: true });
          tx.objectStore('files').put({ id: action.uploadIds[0], name: 'original.txt', type: 'text/plain', blob: new Blob(['Original attachment contents']) });
          tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
        });
      } finally { database.close(); }
    }, { action: fixture.action, contextId: fixture.contextId });
    await peer.setOffline(true);
    await card.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: 'Delete saved message', exact: true }).click();
    await expect(card).toHaveCount(0);
    await expect(page.getByLabel('Message Hermes', { exact: true })).toHaveValue(fixture.action.text);
    expect((await inspect(page)).file).toBe(true);
    await peer.setOffline(false);
    await expect(second.locator(`[data-saved-message="${fixture.action.id}"]`)).toHaveCount(0);
    await expect.poll(async () => { const result = await inspect(second); return { text: result.action?.text, files: result.action?.uploadIds, submission: result.submission, file: result.file }; }).toEqual({ text: '', files: [], submission: false, file: false });
  } finally { await peer.close(); }
});

test('uncertain messages show a warning, copy offline without sending, and retain their saved copy', async ({ page, request, context }) => {
  const fixture = await seed(request, 'Maybe already submitted', { submitted: true }), before = await calls(request);
  await page.goto(fixture.url); const card = await expand(page, fixture.action.id);
  await expect(card).toContainText('This message may already have been sent.');
  await context.setOffline(true);
  await expect(card.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled();
  await card.getByRole('button', { name: 'Use this message' }).click();
  await expect(page.getByLabel('Message Hermes')).toHaveValue(fixture.action.text);
  await card.getByRole('button', { name: 'Use this message' }).click();
  await expect(page.getByLabel('Message Hermes')).toHaveValue(fixture.action.text);
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await expect(card).toBeVisible(); expect(await calls(request)).toEqual(before);
  await context.setOffline(false);
});

test('an unavailable attachment or failed deletion preserves the saved message and current input', async ({ page, request }) => {
  const fixture = await seed(request, 'Recover everything together', { attachment: true }), before = await calls(request);
  await page.goto(fixture.url); await page.getByLabel('Message Hermes').fill('Keep this draft');
  const card = await expand(page, fixture.action.id);
  await page.route('**/api/v1/uploads/*/info', route => route.fulfill({ status: 404, json: { error: 'The saved attachment is unavailable.' } }));
  await card.getByRole('button', { name: 'Use this message' }).click();
  await expect(page.locator('.composer-wrap').getByRole('alert')).toContainText('The saved attachment is unavailable.');
  await expect(page.getByLabel('Message Hermes')).toHaveValue('Keep this draft'); await expect(card).toBeVisible();
  await page.route('**/discard-saved-message', route => route.fulfill({ status: 503, json: { error: 'Could not delete. Please try again.' } }));
  await card.getByRole('button', { name: 'Delete', exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: 'Delete saved message', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Could not delete. Please try again.');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(card).toBeVisible(); await expect(page.getByLabel('Message Hermes')).toHaveValue('Keep this draft');
  expect(await calls(request)).toEqual(before);
});
