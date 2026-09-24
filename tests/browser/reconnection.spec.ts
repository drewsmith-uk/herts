import { test, expect, type APIRequestContext } from '@playwright/test';

const state = async (request: APIRequestContext) => (await request.get('/api/v1/state')).json();
const headers = { 'x-herts-request': '1' };
const work = async (request: APIRequestContext) => ((await (await request.get('http://127.0.0.1:8791/calls')).json()) as string[]).filter(method => ['session.create', 'session.resume', 'prompt.submit', 'config.set', 'session.cwd.set', 'approval.respond', 'session.interrupt'].includes(method));
async function hermes(request: APIRequestContext, online: boolean) {
  expect((await request.post('/__test/hermes-connection', { headers, data: { online } })).ok()).toBe(true);
  await expect.poll(async () => (await state(request)).gateway.online).toBe(online);
}
async function message(request: APIRequestContext, id: string, text: string) {
  expect((await request.post('/__test/conversation-message', { headers, data: { id, title: id, text } })).ok()).toBe(true);
}
test.afterEach(async ({ request }) => { await hermes(request, true); });

test('the conversation list recovers from a Hermes outage without navigation or reload', async ({ page, request }) => {
  const before = await work(request);
  await hermes(request, false);
  await page.goto('/#/conversations');
  await page.getByLabel('Search conversations').fill('reconnect-list');
  await expect(page.getByText('SAVED ON THIS DEVICE', { exact: true })).toBeVisible();
  await message(request, 'reconnect-list', 'Available after Hermes reconnects.');
  await hermes(request, true);
  await expect(page.getByRole('link', { name: /reconnect-list/ })).toBeVisible();
  await expect(page.getByText('SAVED ON THIS DEVICE', { exact: true })).toHaveCount(0);
  expect(await work(request)).toEqual(before);
});

for (const outage of ['Hermes', 'network']) test(`idle conversation history and draft recover after a ${outage} outage`, async ({ page, context, request }) => {
  const id = `reconnect-history-${outage}`, before = await work(request);
  await message(request, id, 'Message before disconnect.');
  await page.goto(`/#/conversation/${id}`);
  await expect(page.locator('.history')).toContainText('Message before disconnect.');
  await page.getByLabel('Message Hermes').fill('Keep this unsent draft.');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  if (outage === 'Hermes') await hermes(request, false); else await context.setOffline(true);
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await message(request, id, 'Message received while disconnected.');
  if (outage === 'Hermes') await hermes(request, true); else await context.setOffline(false);
  await expect(page.locator('.history')).toContainText('Message received while disconnected.');
  await expect(page.getByLabel('Message Hermes')).toHaveValue('Keep this unsent draft.');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  expect(await work(request)).toEqual(before);
});

test('returning to the app replaces a stalled status read and ignores its late response', async ({ page, request }) => {
  const id = 'reconnect-stalled', before = await work(request);
  await message(request, id, 'Before the app was backgrounded.');
  await page.goto(`/#/conversation/${id}`);
  await expect(page.locator('.history')).toContainText('Before the app was backgrounded.');
  await page.getByLabel('Message Hermes').fill('Still unsent after returning.');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  const stale = await state(request); stale.gateway.online = false;
  let requests = 0, release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/state', async route => {
    if (++requests === 1) { await delayed; await route.fulfill({ json: stale }).catch(() => {}); }
    else await route.continue();
  });
  try {
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(() => requests).toBe(1);
    await message(request, id, 'Latest message after returning to the app.');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await expect.poll(() => requests, { timeout: 5000 }).toBeGreaterThan(1);
    await expect(page.locator('.history')).toContainText('Latest message after returning to the app.');
    release();
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
    await expect(page.getByLabel('Message Hermes')).toHaveValue('Still unsent after returning.');
    expect(await work(request)).toEqual(before);
  } finally { release(); }
});
