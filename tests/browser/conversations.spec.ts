import { test, expect } from '@playwright/test';

for (const width of [390, 1280]) test(`filters linked conversations, search and stale offline pages on ${width}px screens`, async ({ page, context, request }) => {
  await page.setViewportSize({ width, height: 844 });
  const before: string[] = await (await request.get('http://127.0.0.1:8791/calls')).json();
  await page.goto('/#/conversations');
  const filter = page.getByRole('checkbox', { name: 'Show linked conversations' });
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
  await expect(page.getByLabel('Task title', { exact: true })).toHaveValue(`Filter conversation ${width}`);
  await page.getByLabel('Task list', { exact: true }).selectOption('done');
  await expect(page.locator('.save-state')).toContainText('All changes saved');
  await context.setOffline(true);
  await page.goto('/#/conversations'); await page.reload();
  await expect(page.getByText('SAVED ON THIS DEVICE', { exact: true })).toBeVisible();
  await expect(row).toHaveCount(0); await expect(filter).not.toBeChecked();
  await filter.check(); await expect(row).toBeVisible(); await expect(row).toContainText('Task created');
  // A query without its own cached page uses the saved-list/history fallback.
  await page.getByRole('textbox', { name: 'Search conversations' }).fill(`conversation ${width}`);
  await expect(row).toBeVisible(); await expect(page.locator('.conversation-row')).toHaveCount(1);
  await filter.uncheck(); await expect(row).toHaveCount(0);
  await expect(page.getByText('Turn on “Show linked conversations” to include them.')).toBeVisible();
  await context.setOffline(false); await page.reload();
  await expect(page.getByRole('heading', { name: 'Conversations', exact: true })).toBeVisible(); await expect(row).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Search conversations' }).fill(`Saved filter response ${width}`);
  await expect(page.getByRole('heading', { name: 'No conversations found' })).toBeVisible();
  await filter.check(); await expect(row).toContainText('Task created');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/conversation-filter-${width}.png` });
  await row.click(); await page.getByRole('button', { name: 'Open task', exact: true }).click();
  await expect(page.getByLabel('Task list', { exact: true })).toHaveValue('done');
  const after: string[] = await (await request.get('http://127.0.0.1:8791/calls')).json();
  expect(after.slice(before.length).filter(method => ['session.create', 'session.resume', 'prompt.submit'].includes(method))).toEqual([]);
});
