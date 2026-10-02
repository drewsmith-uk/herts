import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

const headers = { 'x-herts-request': '1' };
async function open(page: Page, request: APIRequestContext, id: string) {
  expect((await request.post('/__test/conversation-message', { headers, data: { id, title: id, text: 'Saved conversation before the connection problem.' } })).ok()).toBe(true);
  await page.goto(`/#/conversation/${id}`);
  await expect(page.locator('.history')).toContainText('Saved conversation before the connection problem.');
  await expect(page.getByLabel('Message Hermes')).toBeEditable();
}
async function saved(page: Page, id: string, replace = false) {
  return page.evaluate(async ({ id, replace }) => {
    const req = indexedDB.open('hermes-tasks');
    const db = await new Promise<IDBDatabase>((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    try {
      return await new Promise<any>((resolve, reject) => {
        const tx = db.transaction('kv', replace ? 'readwrite' : 'readonly'), key = `history:${id}:latest:0`;
        const op = replace ? tx.objectStore('kv').put({ key, value: { sessionId: id } }) : tx.objectStore('kv').get(key);
        tx.oncomplete = () => resolve(replace ? undefined : op.result?.value); tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  }, { id, replace });
}

for (const width of [390, 1280]) test(`Send survives incomplete saved history at ${width}px`, async ({ page, request }) => {
  await page.setViewportSize({ width, height: 844 });
  const id = `history-broken-cache-${width}`;
  await open(page, request, id);
  await page.route(`**/api/v1/conversations/${id}/history?*`, route => route.abort());
  await saved(page, id, true);
  await page.getByLabel('Message Hermes').fill('Retry');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByLabel('Message Hermes')).toHaveValue('');
  await expect(page.locator('.outgoing-message')).toContainText('Retry');
  await expect(page.getByText(/Cannot read properties/)).toHaveCount(0);
  await expect.poll(async () => {
    const calls = await (await request.get('http://127.0.0.1:8791/call-details')).json();
    return calls.filter((call: any) => call.method === 'prompt.submit' && call.params.session_id === `runtime-${id}`).length;
  }).toBe(1);
  await page.unroute(`**/api/v1/conversations/${id}/history?*`);
  await page.getByRole('button', { name: 'Refresh conversation history', exact: true }).click();
  await expect(page.locator('.outgoing-message')).toHaveCount(0);
  await expect(page.locator('.message.from-user').filter({ hasText: 'Retry' })).toHaveCount(1);
});

for (const body of ['{}', '{"messages":']) test(`a damaged history reply (${body}) preserves the saved copy and draft`, async ({ page, request }) => {
  const id = body === '{}' ? 'history-incomplete' : 'history-truncated';
  await open(page, request, id);
  const before = await saved(page, id);
  await page.getByLabel('Message Hermes').fill('Keep my unsent retry.');
  await page.route(`**/api/v1/conversations/${id}/history?*`, route => route.fulfill({ status: 200, contentType: 'application/json', body }));
  await page.getByRole('button', { name: 'Refresh conversation history', exact: true }).click();
  await expect(page.getByText('Showing saved messages', { exact: false })).toBeAttached();
  await expect(page.locator('.history')).toContainText('Saved conversation before the connection problem.');
  expect(await saved(page, id)).toEqual(before);
  await page.reload();
  await expect(page.locator('.history')).toContainText('Saved conversation before the connection problem.');
  await expect(page.getByLabel('Message Hermes')).toHaveValue('Keep my unsent retry.');
  await page.unroute(`**/api/v1/conversations/${id}/history?*`);
  await page.getByRole('button', { name: 'Refresh conversation history', exact: true }).click();
  await expect(page.getByText('Showing saved messages', { exact: false })).toHaveCount(0);
});
