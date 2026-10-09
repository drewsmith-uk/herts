import { test, expect } from '@playwright/test';
import type { Conversation } from '../../shared/core';

test.use({ serviceWorkers: 'block' });
const conversation = (key: string, title: string): Conversation => ({ key, id: key, aliases: [key], title, preview: 'Saved preview', source: 'desktop', updatedAt: 1 });
const endpoint = '**/api/v1/conversations?*';
const listing = (conversations: Conversation[]) => ({ conversations, hasMore: false });
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

for (const width of [390, 1280]) test(`cached conversations can be opened before a refresh completes at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  const delayed = gate(), plugin = gate(); let refreshing = false;
  await page.route('**/_plugins/tasks/**/client.js', async route => {
    if (refreshing) await plugin.promise;
    await route.continue();
  });
  const saved = conversation('existing', 'Previously saved conversation');
  const fresh = [conversation('filter-390', 'New first conversation'), { ...saved, title: 'Updated conversation title' }];
  await page.route(endpoint, async route => {
    if (refreshing) await delayed.promise;
    await route.fulfill({ json: listing(refreshing ? fresh : [saved]) }).catch(() => {});
  });
  try {
    await page.goto('/#/conversations');
    await expect(page.getByRole('link', { name: /Previously saved conversation/ })).toBeVisible();
    await expect(page.locator('.loading')).toHaveCount(0);
    refreshing = true; await page.reload();
    const row = page.getByRole('link', { name: /Previously saved conversation/ });
    await expect(row).toBeVisible();
    await expect(page.getByText('Refreshing conversations…', { exact: true })).toBeVisible();
    await expect(page.getByText('SAVED ON THIS DEVICE', { exact: true })).toHaveCount(0);
    plugin.release();
    await expect(page.getByRole('link', { name: 'Tasks', exact: true })).toBeVisible();
    await row.click();
    await expect(page.locator('.history')).toContainText('A slower pace sounds good.');
    await page.evaluate(() => { location.hash = '/conversations'; });
    await expect(row).toBeVisible();
    await expect(page.getByText('Refreshing conversations…', { exact: true })).toBeVisible();
    delayed.release();
    await expect(page.locator('.conversation-list .item-title')).toHaveText(['New first conversation', 'Updated conversation title']);
    await expect(page.locator('.loading')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { delayed.release(); plugin.release(); }
});

test('a new search immediately finds saved message text, then accepts an empty server result', async ({ page }) => {
  const delayed = gate(); let searching = false;
  await page.route(endpoint, async route => {
    const query = new URL(route.request().url()).searchParams.get('q');
    if (query) { searching = true; await delayed.promise; }
    await route.fulfill({ json: listing(query ? [] : [conversation('existing', 'Saved history conversation')]) }).catch(() => {});
  });
  try {
    await page.goto('/#/conversations');
    await page.getByRole('link', { name: /Saved history conversation/ }).click();
    await expect(page.locator('.history')).toContainText('A slower pace sounds good.');
    await page.evaluate(() => { location.hash = '/conversations'; });
    await expect(page.locator('.loading')).toHaveCount(0);
    await page.getByLabel('Search conversations').fill('slower pace');
    await expect(page.getByRole('link', { name: /Saved history conversation/ })).toBeVisible();
    await expect(page.getByText('Refreshing conversations…', { exact: true })).toBeVisible();
    await expect.poll(() => searching).toBe(true);
    delayed.release();
    await expect(page.getByRole('heading', { name: 'No conversations found', exact: true })).toBeVisible();
    await expect(page.locator('.conversation-row')).toHaveCount(0);
  } finally { delayed.release(); }
});

test('first load waits for the server without flashing an empty result', async ({ page }) => {
  const delayed = gate();
  await page.route(endpoint, async route => { await delayed.promise; await route.fulfill({ json: listing([]) }).catch(() => {}); });
  try {
    await page.goto('/#/conversations');
    await expect(page.getByText('Loading conversations…', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No conversations found', exact: true })).toHaveCount(0);
    delayed.release();
    await expect(page.getByRole('heading', { name: 'No conversations found', exact: true })).toBeVisible();
  } finally { delayed.release(); }
});
