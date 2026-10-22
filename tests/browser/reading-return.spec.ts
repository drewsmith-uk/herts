import { test, expect, type APIRequestContext } from '@playwright/test';
import { closePageActions, detailsControl } from './composer-helpers';

async function create(request: APIRequestContext, read = false) {
  const itemId = crypto.randomUUID(), title = `Reading return https://example.com/${'long-reference/'.repeat(8)}${itemId}`;
  const headers = { 'x-herts-request': '1' };
  expect((await request.post('/api/v1/reading/sync', { headers, data: { id: crypto.randomUUID(), itemId, contextId: crypto.randomUUID(), kind: 'create', title, url: `https://example.com/${itemId}`, at: Date.now() } })).ok()).toBe(true);
  if (read) expect((await request.post('/api/v1/reading/sync', { headers, data: { id: crypto.randomUUID(), itemId, kind: 'read', read: true, baseReadAt: null, at: Date.now() } })).ok()).toBe(true);
  return { itemId, title };
}
const calls = async (request: APIRequestContext) => (await (await request.get('http://127.0.0.1:8791/calls')).json() as string[]).filter(m => ['session.create', 'session.resume', 'prompt.submit'].includes(m));

for (const width of [390, 1280]) for (const read of [false, true]) test(`reading returns to its original ${read ? 'read' : 'unread'} list at ${width}px`, async ({ page, context, request }) => {
  await page.setViewportSize({ width, height: 844 });
  const { title, itemId } = await create(request, read), before = await calls(request);
  const original = read ? '#/reading/read' : '#/reading', other = read ? '#/reading' : '#/reading/read';
  await page.goto(`/${original}`);
  await page.getByRole('link', { name: title, exact: true }).click();
  await page.getByRole('link', { name: 'Discussion', exact: true }).click();
  const draft = `Keep the reading draft ${itemId}`;
  await page.getByRole('textbox', { name: 'Message Hermes', exact: true }).fill(draft);
  const back = page.getByRole('link', { name: 'Back to Reading list', exact: true });
  await expect(back).toHaveAttribute('href', original);
  await back.focus(); await expect(back).toBeFocused(); await expect(back).toBeInViewport();
  await page.screenshot({ path: `test-results/reading-return-before-${read}-${width}.png` });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await (await detailsControl(page, 'button', read ? 'Mark unread' : 'Mark read')).click();
  await expect(await detailsControl(page, 'button', read ? 'Mark read' : 'Mark unread')).toBeVisible();
  await closePageActions(page);
  await expect(back).toHaveAttribute('href', original);
  await page.getByRole('link', { name: 'Article', exact: true }).click();
  await expect(back).toHaveAttribute('href', original);
  await page.reload();
  await expect(back).toHaveAttribute('href', original);
  await page.getByRole('link', { name: 'Discussion', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message Hermes', exact: true })).toHaveValue(draft);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/reading-return-after-${read}-${width}.png` });
  await back.click();
  await expect(page).toHaveURL(new RegExp(original + '$'));
  await expect(page.getByRole('link', { name: title, exact: true })).toHaveCount(0);
  await page.locator(`.reading-tabs a[href="${other}"]`).click();
  await page.getByRole('link', { name: title, exact: true }).click();
  await expect(back).toHaveAttribute('href', other);
  await expect(page.getByRole('textbox', { name: 'Message Hermes', exact: true })).toHaveValue(draft);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(other + '$'));
  await page.goForward();
  await expect(back).toHaveAttribute('href', other);
  await context.setOffline(false);
  await expect(page.locator('.save-state')).toContainText('Changes synced');
  expect(await calls(request)).toEqual(before);
});

test('reading direct links retain a stable list after a status change and reload', async ({ page, request }) => {
  const { itemId } = await create(request, true);
  await page.goto(`/#/reading-item/${itemId}`);
  const back = page.getByRole('link', { name: 'Back to Reading list', exact: true });
  await expect(back).toHaveAttribute('href', '#/reading/read');
  await (await detailsControl(page, 'button', 'Mark unread')).click();
  await closePageActions(page);
  await page.reload();
  await expect(back).toHaveAttribute('href', '#/reading/read');
  await back.click(); await expect(page).toHaveURL(/#\/reading\/read$/);
});

test('reading opened from a conversation returns to that conversation', async ({ page, request }) => {
  const before = await calls(request);
  await page.goto('/#/conversation/reading-links');
  const save = page.getByRole('button', { name: 'Save to reading list: https://example.com/one', exact: true }).first();
  await save.click();
  await page.getByRole('button', { name: 'Open reading item: https://example.com/one', exact: true }).first().click();
  const back = page.getByRole('link', { name: 'Back to Conversation', exact: true });
  await expect(back).toHaveAttribute('href', '#/conversation/reading-links');
  await (await detailsControl(page, 'button', 'Mark read')).click();
  await closePageActions(page);
  await page.getByRole('link', { name: 'Article', exact: true }).click();
  await page.reload();
  await expect(back).toHaveAttribute('href', '#/conversation/reading-links');
  await back.click(); await expect(page).toHaveURL(/#\/conversation\/reading-links$/);
  expect(await calls(request)).toEqual(before);
});

test('reading aliases retain the original return target', async ({ page, request }) => {
  const { itemId } = await create(request), alias = crypto.randomUUID();
  await page.goto('/#/reading/read');
  await expect(page.getByRole('heading', { name: 'Reading list', exact: false })).toBeVisible();
  await page.evaluate(async ({ alias, itemId }) => {
    await (globalThis as any).__HERTS_PLUGIN_RUNTIME__.sdk.pluginLocal('reading').kv.put({ key: `reading-alias:${alias}`, value: itemId });
    location.hash = `/reading-item/${alias}`;
  }, { alias, itemId });
  await expect(page).toHaveURL(new RegExp(`#/reading-item/${itemId}$`));
  const back = page.getByRole('link', { name: 'Back to Reading list', exact: true });
  await expect(back).toHaveAttribute('href', '#/reading/read');
  await page.reload(); await expect(back).toHaveAttribute('href', '#/reading/read');
  await page.goBack(); await expect(page).toHaveURL(/#\/reading\/read$/);
});
