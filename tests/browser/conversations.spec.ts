import { detailsField, detailsControl } from './composer-helpers';
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

for (const width of [390, 1280]) test(`filters linked conversations, search and stale offline pages on ${width}px screens`, async ({ page, context, request }) => {
  await page.setViewportSize({ width, height: 844 });
  const before: string[] = await (await request.get('http://127.0.0.1:8791/calls')).json();
  await page.goto('/#/conversations');
  const filter = page.getByRole('checkbox', { name: 'Show all' });
  const row = page.getByRole('link', { name: new RegExp(`Filter conversation ${width}`) });
  await expect(filter).not.toBeChecked(); await expect(row).toBeVisible();
  await page.getByRole('textbox', { name: 'Search conversations' }).fill(`Saved filter response ${width}`);
  await expect(row).toBeVisible(); await expect(page.locator('.conversation-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear search' }).click(); await expect(row).toBeVisible();
  // Save both filter modes before linking, so offline checks exercise stale caches.
  await filter.check(); await expect(row).toBeVisible();
  await filter.uncheck(); await expect(row).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await row.click();
  await page.getByRole('button', { name: 'Make a task' }).click();
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect((await detailsField(page, 'Task title'))).toHaveValue(`Filter conversation ${width}`);
  await (await detailsField(page, 'Task list')).selectOption('done');
  await expect(page.locator('.save-state')).toContainText('Changes synced');
  await context.setOffline(true);
  await page.goto('/#/conversations'); await page.reload();
  await expect(page.getByText('SAVED ON THIS DEVICE', { exact: true })).toBeVisible();
  await expect(row).toHaveCount(0); await expect(filter).not.toBeChecked();
  await filter.check(); await expect(row).toContainText('Task created');
  // A query without its own cached page uses the saved-list/history fallback.
  await page.getByRole('textbox', { name: 'Search conversations' }).fill(`conversation ${width}`);
  await expect(row).toBeVisible(); await expect(page.locator('.conversation-row')).toHaveCount(1);
  await filter.uncheck(); await expect(row).toHaveCount(0);
  await expect(page.getByText('Turn on “Show all” to include linked and hidden conversations.')).toBeVisible();
  await context.setOffline(false); await page.reload();
  await expect(page.getByRole('heading', { name: 'Conversations', exact: true })).toBeVisible(); await expect(row).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Search conversations' }).fill(`Saved filter response ${width}`);
  await expect(page.getByRole('heading', { name: 'No conversations found' })).toBeVisible();
  await filter.check(); await expect(row).toContainText('Task created');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/conversation-filter-${width}.png` });
  await row.click(); await page.getByRole('button', { name: 'Open task', exact: true }).click();
  await expect((await detailsField(page, 'Task list'))).toHaveValue('done');
  const after: string[] = await (await request.get('http://127.0.0.1:8791/calls')).json();
  expect(after.slice(before.length).filter(method => ['session.create', 'session.resume', 'prompt.submit'].includes(method))).toEqual([]);
});

test('Show all includes hidden, reading-linked and task-linked conversations online and offline', async ({ page, context, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const headers = { 'x-herts-request': '1' };
  const readingRow = page.locator('[data-conversation-key="standalone-unavailable"]');
  const bothRow = page.locator('[data-conversation-key="filter-390"]');
  const hiddenRow = page.locator('[data-conversation-key="hidden-offline"]');
  await page.goto('/#/conversations');
  const filter = page.getByRole('checkbox', { name: 'Show all', exact: true });
  await expect(page.getByRole('checkbox')).toHaveCount(1); await expect(filter).not.toBeChecked();
  await expect(readingRow).toBeVisible();
  await expect(page.locator('.loading')).toHaveCount(0);
  await filter.check(); await expect(bothRow).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  for (const conversationId of ['standalone-unavailable', 'filter-390']) {
    for (let i = 0; i < 2; i++) {
      const itemId = randomUUID();
      expect((await request.post('/api/v1/reading/sync', { headers, data: { id: randomUUID(), itemId, contextId: randomUUID(), conversationId, kind: 'create', url: `https://example.com/filter-${conversationId}-${i}`, at: Date.now() } })).ok()).toBe(true);
      expect((await request.post('/api/v1/reading/sync', { headers, data: { id: randomUUID(), itemId, kind: 'read', read: true, baseReadAt: null, at: Date.now() } })).ok()).toBe(true);
    }
  }
  const state = await (await request.get('/api/v1/state')).json();
  if (!state.snapshot.tasks.some((t: any) => t.link?.key === 'filter-390')) {
    expect((await request.post('/api/v1/conversations/filter-390/task', { headers, data: { id: randomUUID(), taskId: randomUUID(), title: 'Filter conversation 390', at: Date.now() } })).ok()).toBe(true);
  }
  for (const key of ['filter-390', 'hidden-offline']) {
    expect((await request.post('/api/v1/conversations/visibility', { headers, data: { id: randomUUID(), key, aliases: [key], hidden: true, at: Date.now() } })).ok()).toBe(true);
  }
  await expect(hiddenRow.locator('.hidden-item-badge')).toHaveText('Hidden');
  await expect(bothRow.locator('.hidden-item-badge')).toHaveText('Hidden');
  await expect(readingRow).toContainText('Reading · 2 items');
  await expect(bothRow).toContainText('Reading · 2 items');
  await expect(bothRow).toContainText('Task created');
  await filter.uncheck();
  await expect(page.locator('.loading')).toHaveCount(0);
  for (const row of [readingRow, bothRow, hiddenRow]) await expect(row).toHaveCount(0);
  await filter.check();
  await expect(readingRow).toContainText('Reading · 2 items');
  await expect(bothRow.locator('.hidden-item-badge')).toHaveText('Hidden');
  await bothRow.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/show-all-conversations-390.png' });
  await context.setOffline(true); await page.reload();
  await expect(page.getByText('SAVED ON THIS DEVICE', { exact: true })).toBeVisible();
  await expect(filter).not.toBeChecked();
  for (const row of [readingRow, bothRow, hiddenRow]) await expect(row).toHaveCount(0);
  await filter.check();
  await expect(readingRow).toContainText('Reading · 2 items'); await expect(bothRow).toContainText('Task created');
  await expect(bothRow.locator('.hidden-item-badge')).toHaveText('Hidden');
  await expect(hiddenRow.locator('.hidden-item-badge')).toHaveText('Hidden');
  await filter.uncheck();
  for (const row of [readingRow, bothRow, hiddenRow]) await expect(row).toHaveCount(0);
  await page.getByLabel('Search conversations').fill('Conversation retry');
  await expect(page.getByText('Turn on “Show all” to include linked and hidden conversations.')).toBeVisible();
  await filter.check(); await expect(readingRow).toContainText('Reading · 2 items');
  await context.setOffline(false);
  for (const key of ['filter-390', 'hidden-offline']) {
    expect((await request.post('/api/v1/conversations/visibility', { headers, data: { id: randomUUID(), key, aliases: [key], hidden: false, at: Date.now() } })).ok()).toBe(true);
  }
});
