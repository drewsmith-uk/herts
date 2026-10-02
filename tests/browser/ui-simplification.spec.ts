import { test, expect } from '@playwright/test';

const headers = { 'x-herts-request': '1' };

test('an empty task list stays usable when its last item is completed during editing', async ({ page }) => {
  await page.goto('/#/tasks');
  await page.getByRole('button', { name: 'Create space', exact: true }).click();
  await page.getByLabel('New space name', { exact: true }).fill(`Editing ${crypto.randomUUID().slice(0, 8)}`);
  await page.getByRole('dialog').getByRole('button', { name: 'Create space', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A clear Inbox', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit list', exact: true })).toHaveCount(0);
  await expect(page.locator('.list-summary')).toHaveCount(0);
  const listUrl = page.url();
  await page.getByLabel('Message Hermes', { exact: true }).fill('The last task');
  await page.getByRole('button', { name: 'Save to Inbox', exact: true }).click();
  await page.getByRole('button', { name: 'Edit list', exact: true }).click();
  await page.getByRole('button', { name: 'Complete The last task', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A clear Inbox', exact: true })).toBeVisible();
  await expect(page.locator('.list-summary')).toHaveCount(0);
  await page.getByRole('button', { name: 'Finish editing', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit list', exact: true })).toHaveCount(0);
  await page.goto(listUrl.replace(/inbox$/, 'done'));
  await expect(page.locator('.list-summary')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reopen The last task', exact: true }).click();
  await page.goto(listUrl);
  await expect(page.getByRole('button', { name: 'Edit list', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'The last task', exact: true })).toBeVisible();
});

test('reading edit mode remains escapable when the last unread item is marked read', async ({ page, request }) => {
  // Keep this independent of synthetic articles created by earlier specs.
  const { snapshot } = await (await request.get('/api/v1/state')).json();
  for (const item of snapshot.reading.items.filter((item: { readAt: number | null }) => item.readAt === null)) {
    expect((await request.post('/api/v1/reading/sync', { headers, data: { id: crypto.randomUUID(), itemId: item.id, kind: 'read', read: true, baseReadAt: null, at: Date.now() } })).ok()).toBe(true);
  }
  await page.goto('/#/reading');
  await expect(page.getByRole('heading', { name: 'Your next good read', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit list', exact: true })).toHaveCount(0);
  const itemId = crypto.randomUUID();
  expect((await request.post('/api/v1/reading/sync', { headers, data: { id: crypto.randomUUID(), itemId, contextId: crypto.randomUUID(), kind: 'create', title: 'The last article', url: 'https://example.com/last-article', at: Date.now() } })).ok()).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Edit list', exact: true }).click();
  await page.getByRole('button', { name: 'Mark read: The last article', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your next good read', exact: true })).toBeVisible();
  await expect(page.locator('.list-summary')).toHaveCount(0);
  await page.getByRole('button', { name: 'Finish editing', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit list', exact: true })).toHaveCount(0);
  await page.goto('/#/reading/read');
  await expect(page.locator('.list-summary')).toHaveCount(0);
  await page.getByRole('button', { name: 'Mark unread: The last article', exact: true }).click();
  await page.goto('/#/reading');
  await expect(page.getByRole('button', { name: 'Edit list', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'The last article', exact: true }).click();
  await expect(page.getByLabel('Message Hermes')).toBeEditable();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await expect(page.locator('.composer-note')).toContainText('Not sent');
  await expect(page.locator('.unlinked-note')).toHaveCount(0);
  await expect(page.locator('.conversation-heading')).toBeVisible();
});
