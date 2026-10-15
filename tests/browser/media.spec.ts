import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const dataUrl = 'data:text/html;base64,PGgxPlJlcG9ydDwvaDE+';
async function attachment(page: import('@playwright/test').Page) {
  await page.route('**/api/v1/conversations/*/history*', route => route.fulfill({ json: {
    sessionId: 'existing', offset: 0, order: 'latest', hasMore: false, fetchedAt: Date.now(),
    messages: [{ role: 'assistant', content: 'MEDIA:/tmp/report.html' }],
  } }));
  await page.goto('/#/conversation/existing');
  return page.getByRole('button', { name: 'Download file', exact: true });
}

test('one press downloads bytes and cached files remain available offline', async ({ page, context }) => {
  let reads = 0;
  await page.route('**/api/v1/media', route => { reads++; return route.fulfill({ json: { dataUrl } }); });
  const button = await attachment(page);
  const first = page.waitForEvent('download');
  await button.click();
  const downloaded = await first;
  expect(downloaded.suggestedFilename()).toBe('report.html');
  expect(await readFile((await downloaded.path())!, 'utf8')).toBe('<h1>Report</h1>');
  await expect(button).toBeEnabled();
  await context.setOffline(true);
  const second = page.waitForEvent('download');
  await button.click();
  expect((await second).suggestedFilename()).toBe('report.html');
  expect(reads).toBe(1);
});

test('failed reads allow a manual retry and preserve the draft', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/v1/media', route => ++reads === 1
    ? route.fulfill({ status: 503, json: { error: 'Hermes is unavailable. Try again.' } })
    : route.fulfill({ json: { dataUrl } }));
  const button = await attachment(page);
  const draft = page.getByRole('textbox', { name: 'Message Hermes', exact: true });
  await draft.fill('Keep this draft while downloading.');
  await button.click();
  await expect(page.getByRole('alert').filter({ hasText: 'Hermes is unavailable' })).toBeVisible();
  expect(reads).toBe(1);
  const download = page.waitForEvent('download');
  await button.click(); await download;
  await expect(draft).toHaveValue('Keep this draft while downloading.');
});

test('navigation ignores a delayed file response', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.route('**/api/v1/media', async route => { await gate; await route.fulfill({ json: { dataUrl } }); });
  const button = await attachment(page);
  await button.click();
  await expect(page.getByRole('button', { name: 'Fetching file…' })).toBeDisabled();
  await page.goto('/#/conversations');
  const response = page.waitForResponse('**/api/v1/media');
  release();
  await (await response).finished();
  await expect(page.locator('.page-header')).toBeVisible();
  expect(downloads).toBe(0);
});
