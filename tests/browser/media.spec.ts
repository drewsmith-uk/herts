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
  await page.unroute('**/api/v1/media');
  await context.setOffline(true);
  const second = page.waitForEvent('download');
  await button.click();
  expect((await second).suggestedFilename()).toBe('report.html');
  await expect(page.locator('.message-file [role="alert"]')).toHaveText('Saved copy. Reconnect and download again for the latest file.');
  expect(reads).toBe(1);
});

test('failed reads allow a manual retry and preserve the draft', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/v1/media', route => ++reads === 1
    ? route.fulfill({ status: 503, json: { error: 'Hermes is unavailable. Try again.' } })
    : route.fulfill({ json: { dataUrl } }));
  const button = await attachment(page);
  const draft = page.getByRole('textbox', { name: /^(Message Hermes|Add a task)$/, exact: true });
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

for (const reload of [false, true]) test(`downloads changed bytes at the same path after reload=${reload}`, async ({ page }) => {
  let reads = 0;
  await page.route('**/api/v1/media', route => route.fulfill({ json: {
    dataUrl: `data:text/html;base64,${Buffer.from(++reads === 1 ? 'Original' : 'Updated').toString('base64')}`,
  } }));
  let button = await attachment(page);
  const first = page.waitForEvent('download');
  await button.click();
  expect(await readFile((await (await first).path())!, 'utf8')).toBe('Original');
  await expect(button).toBeEnabled();
  if (reload) { await page.reload(); button = page.getByRole('button', { name: 'Download file', exact: true }); }
  const second = page.waitForEvent('download');
  await button.click();
  expect(await readFile((await (await second).path())!, 'utf8')).toBe('Updated');
  expect(reads).toBe(2);
});

test('image downloads refresh a previously displayed image', async ({ page }) => {
  const original = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  let reads = 0;
  await page.route('**/api/v1/media', route => route.fulfill({ json: { dataUrl: ++reads === 1 ? original : dataUrl } }));
  await page.route('**/api/v1/conversations/*/history*', route => route.fulfill({ json: {
    sessionId: 'existing', offset: 0, order: 'latest', hasMore: false, fetchedAt: Date.now(),
    messages: [{ role: 'assistant', content: 'MEDIA:/tmp/image.png' }],
  } }));
  await page.goto('/#/conversation/existing');
  await page.getByRole('button', { name: 'View image', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download image' }).click();
  expect(await readFile((await (await download).path())!, 'utf8')).toBe('<h1>Report</h1>');
  expect(reads).toBe(2);
});

for (const failure of [
  { status: 404, error: 'Hermes request failed (404).', warning: 'Saved copy. The current file is unavailable. Ask Hermes to provide it again.' },
  { status: 409, error: 'This file is not referenced in the selected conversation message.', warning: 'Saved copy. The file reference has changed. Refresh the conversation and download again.' },
  { status: 503, error: 'Hermes is unavailable.', warning: 'Saved copy. Hermes is unavailable. Try downloading again.' },
]) test(`saved downloads retain recovery guidance after HTTP ${failure.status}`, async ({ page }) => {
  let reads = 0;
  const updated = `data:text/html;base64,${Buffer.from('Updated').toString('base64')}`;
  await page.route('**/api/v1/media', route => ++reads === 2
    ? route.fulfill({ status: failure.status, json: { error: failure.error } })
    : route.fulfill({ json: { dataUrl: reads === 1 ? dataUrl : updated } }));
  const button = await attachment(page);
  const draft = page.getByRole('textbox', { name: /^(Message Hermes|Add a task)$/, exact: true });
  await draft.fill('Keep my draft through file recovery.');
  const first = page.waitForEvent('download');
  await button.click(); await first;
  await expect(button).toBeEnabled();
  const saved = page.waitForEvent('download');
  await button.click();
  expect(await readFile((await (await saved).path())!, 'utf8')).toBe('<h1>Report</h1>');
  await expect(page.locator('.message-file [role="alert"]')).toHaveText(failure.warning);
  await expect(draft).toHaveValue('Keep my draft through file recovery.');
  expect(reads).toBe(2);
  await expect(button).toBeEnabled();
  const retry = page.waitForEvent('download');
  await button.click();
  expect(await readFile((await (await retry).path())!, 'utf8')).toBe('Updated');
  await expect(page.locator('.message-file [role="alert"]')).toHaveCount(0);
  await expect(draft).toHaveValue('Keep my draft through file recovery.');
  expect(reads).toBe(3);
});
