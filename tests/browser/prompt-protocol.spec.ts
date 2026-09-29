import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
const headers = { 'x-herts-request': '1', 'x-herts-plugin-api': '1' };
const state = async (request: APIRequestContext) => (await request.get('/api/v1/state', { headers })).json();
const calls = async (request: APIRequestContext) => (await request.get('http://127.0.0.1:8791/call-details')).json();
async function protocol(request: APIRequestContext, modern: boolean) {
  expect((await request.post('/__test/prompt-protocol', { headers, data: { modern } })).ok()).toBe(true);
  await expect.poll(async () => { const s = await state(request); return s.gateway.online && s.gateway.promptProtocol; }).toBe(modern ? 'requests' : 'legacy');
}
async function send(page: Page, text: string) {
  await page.getByLabel('Message Hermes').fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}
test.beforeEach(async ({ request }) => { await protocol(request, true); });
test.afterEach(async ({ request }) => { await protocol(request, false); });

for (const width of [390, 1280]) test(`modern approvals survive reconnect and require an explicit decision at ${width}px`, async ({ page, request }) => {
  await page.setViewportSize({ width, height: 844 });
  const before = (await calls(request)).length;
  await page.goto('/#/new'); await send(page, `Please ask approval ${width}`);
  await expect(page.getByRole('button', { name: 'Approve once', exact: true })).toBeVisible();
  await expect(page.locator('.conversation-status')).toContainText('Needs your input');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Approve once', exact: true })).toBeEnabled();
  await request.post('/__test/hermes-connection', { headers, data: { online: false } });
  await expect(page.getByRole('button', { name: 'Approve once', exact: true })).toBeDisabled();
  await request.post('/__test/hermes-connection', { headers, data: { online: true } });
  await expect(page.getByRole('button', { name: 'Approve once', exact: true })).toBeEnabled();
  expect((await calls(request)).slice(before).filter((c: any) => ['request.answer', 'approval.respond'].includes(c.method))).toEqual([]);
  const choice = width === 390 ? 'Approve once' : 'Deny';
  await page.getByRole('button', { name: choice, exact: true }).click();
  await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase', 'complete');
  await expect(page.getByRole('button', { name: 'Approve once', exact: true })).toHaveCount(0);
  const decisions = (await calls(request)).slice(before).filter((c: any) => c.method === 'request.answer');
  expect(decisions).toHaveLength(1);
  expect(decisions[0].params).toMatchObject({ id: expect.stringMatching(/^srq-/), result: { choice: width === 390 ? 'once' : 'deny' } });
});

test('modern single and batch questions use the shared conversation controls', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const before = (await calls(request)).length;
  await page.goto('/#/new'); await send(page, 'Please ask clarification');
  await expect(page.getByLabel('Answer Hermes')).toBeVisible();
  await page.getByRole('button', { name: 'Article', exact: true }).click();
  await page.getByRole('button', { name: 'Send answer', exact: true }).click();
  await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase', 'complete');
  await send(page, 'Please ask batch questions');
  await expect(page.getByLabel('Answer: Which folder?')).toHaveValue('Work');
  await expect(page.getByLabel('Answer: Which folder?')).toBeDisabled();
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await page.getByRole('button', { name: 'Storage', exact: true }).click();
  await expect(page.getByLabel('Answer: Which checks?')).toHaveValue('Files, Storage');
  await page.getByRole('button', { name: 'Send answers', exact: true }).click();
  await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase', 'complete');
  const answers = (await calls(request)).slice(before).filter((c: any) => c.method === 'request.answer').map((c: any) => c.params.result);
  expect(answers).toEqual([{ answer: 'Article' }, { answers: { a: 'Work', b: 'Files, Storage' } }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('expired approvals disappear without submitting a decision', async ({ page, request }) => {
  const before = (await calls(request)).length;
  await page.goto('/#/new'); await send(page, 'Please ask approval then expire');
  await expect(page.getByRole('button', { name: 'Approve once', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve once', exact: true })).toHaveCount(0);
  expect((await calls(request)).slice(before).filter((c: any) => c.method === 'request.answer')).toEqual([]);
});

test('unsupported prompt types are explained and explicitly rejected', async ({ page, request }) => {
  const before = (await calls(request)).length;
  await page.goto('/#/new'); await send(page, 'Please ask unsupported prompt');
  await expect(page.getByRole('alert')).toContainText('Herts cannot display the Hermes “sudo” prompt');
  const replies = (await calls(request)).slice(before).filter((c: any) => c.method === 'server-response');
  expect(replies).toHaveLength(1); expect(replies[0].params.error.code).toBe(-32601);
  expect((await calls(request)).slice(before).filter((c: any) => c.method === 'request.answer')).toEqual([]);
});

test('unavailable preview reads return a tool explanation without an approval warning', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const before = (await calls(request)).length;
  await page.goto('/#/new'); await send(page, 'Please ask preview read');
  await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase', 'complete');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.conversation-status')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Approve once', exact: true })).toHaveCount(0);
  const replies = (await calls(request)).slice(before).filter((c: any) => c.method === 'server-response');
  expect(replies).toHaveLength(1);
  expect(JSON.parse(replies[0].params.result.value)).toMatchObject({ success: false, error: expect.stringContaining('Herts does not support reading the Hermes Desktop browser preview') });
  await page.reload();
  await expect(page.getByLabel('Message Hermes')).toBeEditable();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect((await calls(request)).slice(before).filter((c: any) => ['request.answer', 'approval.respond', 'session.resume'].includes(c.method))).toEqual([]);
});
