import { detailsField, detailsControl } from './composer-helpers';
import { randomUUID } from 'node:crypto';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

async function create(request: APIRequestContext, title: string) {
  const itemId = randomUUID();
  const response = await request.post('/api/v1/reading/sync', { headers: { 'x-tasks-request': '1' }, data: { id: randomUUID(), itemId, contextId: randomUUID(), kind: 'create', title, url: `https://example.com/${itemId}`, at: Date.now() } });
  expect(response.ok()).toBe(true); return `/#/reading-item/${itemId}`;
}
async function edit(page: Page, title: string) {
  await (await detailsField(page, 'Reading title')).fill(title);
}
const agentCalls = async (request: APIRequestContext) => (await (await request.get('http://127.0.0.1:8791/calls')).json() as string[]).filter(method => ['session.create', 'session.resume', 'prompt.submit'].includes(method));

test('reading titles save on blur, restore blank edits, survive offline reload and remain editable after marking read', async ({ page, context, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const url = await create(request, 'Shared reading title'), before = await agentCalls(request);
  await page.goto(url);
  await expect(page.locator('.offline-controls')).toContainText('Available offline');
  await expect(page.getByRole('button', { name: /^(Edit title|Save title)$/ })).toHaveCount(0);
  await edit(page, '   ');
  await (await detailsField(page, 'Reading title')).blur();
  await expect((await detailsField(page, 'Reading title'))).toHaveValue('Shared reading title');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await edit(page, '  Saved offline reading title  ');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/reading-title-edit-phone.png', fullPage: true });
  await (await detailsField(page, 'Reading title')).blur();
  await expect((await detailsField(page, 'Reading title'))).toHaveValue('Saved offline reading title');
  await page.reload();
  await expect((await detailsField(page, 'Reading title'))).toHaveValue('Saved offline reading title');
  await expect(page.locator('.offline-controls')).toContainText('Available offline');
  await page.goto('/#/reading');
  await expect(page.getByRole('link', { name: 'Saved offline reading title', exact: true })).toBeVisible();
  await context.setOffline(false);
  await expect(page.locator('.save-state')).toContainText('Changes synced');
  await page.getByRole('link', { name: 'Saved offline reading title', exact: true }).click();
  await (await detailsControl(page, 'button', 'Mark read')).click();
  await expect((await detailsControl(page, 'button', 'Mark unread'))).toBeVisible();
  await edit(page, 'Finished article title');
  await (await detailsField(page, 'Reading title')).blur();
  await expect(page.locator('.save-state')).toContainText('Changes synced');
  await page.reload();
  await expect((await detailsField(page, 'Reading title'))).toHaveValue('Finished article title');
  await expect((await detailsControl(page, 'button', 'Mark unread'))).toBeVisible();
  await page.getByRole('link', { name: 'Back to Reading list', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Finished article title', exact: true })).toBeVisible();
  expect(await agentCalls(request)).toEqual(before);
});

for (const keepMine of [true, false]) test(`competing reading-title edits preserve the draft and allow ${keepMine ? 'keeping mine' : 'using the synced title'}`, async ({ page, browser, request }) => {
  const url = await create(request, 'Original shared title'), before = await agentCalls(request);
  const second = await browser.newContext(), other = await second.newPage();
  try {
    await page.goto(url); await other.goto(`http://127.0.0.1:8790${url}`);
    await expect(page.locator('.save-state')).toContainText('Changes synced');
    await expect(other.locator('.save-state')).toContainText('Changes synced');
    await edit(page, 'My draft title');
    await edit(other, 'Other device title');
    await (await detailsField(other, 'Reading title')).blur();
    await expect(other.locator('.save-state')).toContainText('Changes synced');
    await expect((await detailsField(page, 'Reading title'))).toHaveValue('My draft title');
    await (await detailsField(page, 'Reading title')).blur();
    const conflict = page.locator('.conflict-banner');
    await expect(conflict).toContainText('Your title: My draft title');
    await expect(conflict).toContainText('Synced title: Other device title');
    await conflict.getByRole('button', { name: keepMine ? 'Keep my change' : 'Use synced version', exact: true }).click();
    await expect(conflict).toHaveCount(0);
    await expect(page.locator('.save-state')).toContainText('Changes synced');
    const title = keepMine ? 'My draft title' : 'Other device title';
    await expect((await detailsField(page, 'Reading title'))).toHaveValue(title);
    await expect((await detailsField(other, 'Reading title'))).toHaveValue(title);
    await page.reload(); await expect((await detailsField(page, 'Reading title'))).toHaveValue(title);
    expect(await agentCalls(request)).toEqual(before);
  } finally { await second.close(); }
});

for (const width of [390, 1280]) test(`reading list Edit mode saves inline titles without dragging on ${width}px screens`, async ({ page, request }) => {
  await page.setViewportSize({ width, height: 844 });
  const original = `Inline reading ${width}`, updated = `Renamed reading ${width}`, finished = `Read title ${width}`;
  const url = await create(request, original), before = await agentCalls(request);
  await page.goto('/#/reading');
  await page.getByRole('button', { name: 'Edit list', exact: true }).click();
  const row = page.getByRole('group', { name: original, exact: true }), input = row.getByLabel('Edit reading title', { exact: true });
  await input.fill('   '); await input.press('Enter'); await expect(input).toHaveValue(original);
  await input.hover(); await page.mouse.down(); await page.waitForTimeout(550);
  await expect(page.locator('.reading-row.dragging')).toHaveCount(0); await page.mouse.up();
  await input.fill(updated);
  await page.getByRole('button', { name: 'Finish editing', exact: true }).click();
  await expect(page.getByRole('link', { name: updated, exact: true })).toBeVisible();
  await expect(page.locator('.save-state')).toContainText('Changes synced');
  await page.goto(url); await expect((await detailsField(page, 'Reading title'))).toHaveValue(updated);
  await (await detailsControl(page, 'button', 'Mark read')).click();
  await expect((await detailsControl(page, 'button', 'Mark unread'))).toBeVisible();
  await page.getByRole('link', { name: 'Back to Reading list', exact: true }).click();
  await page.getByRole('button', { name: 'Edit list', exact: true }).click();
  const readRow = page.getByRole('group', { name: updated, exact: true });
  await expect(readRow.locator('.reorder-controls')).toHaveCount(0);
  await readRow.getByLabel('Edit reading title', { exact: true }).fill(finished);
  await readRow.getByLabel('Edit reading title', { exact: true }).press('Enter');
  await expect(page.getByRole('group', { name: finished, exact: true }).getByLabel('Edit reading title', { exact: true })).toHaveValue(finished);
  await expect(page.locator('.save-state')).toContainText('Changes synced');
  await page.reload(); await expect(page.getByRole('link', { name: finished, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await agentCalls(request)).toEqual(before);
});
