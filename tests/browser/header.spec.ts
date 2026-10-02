import { test, expect } from '@playwright/test';
import { detailsField } from './composer-helpers';

for (const width of [390, 1280]) test(`conversation header changes only on explicit disclosure at ${width}px`, async ({ page, request }) => {
  await page.setViewportSize({ width, height: 844 });
  const before = await (await request.get('http://127.0.0.1:8791/calls')).json();
  await page.goto('/#/conversation/header-history');
  const header = page.locator('.conversation-page-header'), viewport = page.locator('.conversation-scroll');
  await expect(page.getByLabel('Message Hermes')).toBeEditable();
  await expect(page.locator('[data-history-message="header-history:450"]')).toBeInViewport();
  await expect(header).toHaveClass(/is-compact/);
  const box = await header.boundingBox();
  await viewport.evaluate(el => { el.scrollTop -= 600; });
  await expect(header).toHaveClass(/is-compact/);
  expect(await header.boundingBox()).toEqual(box);
  await page.getByRole('button', { name: 'Show page details', exact: true }).click();
  await expect(header).not.toHaveClass(/is-compact/);
  await expect(page.getByLabel('Conversation title', { exact: true })).toBeVisible();
  await viewport.evaluate(el => { el.scrollTop += 200; });
  await expect(header).not.toHaveClass(/is-compact/);
  await page.getByRole('button', { name: 'Collapse page details', exact: true }).click();
  await expect(header).toHaveClass(/is-compact/);
  await page.getByRole('button', { name: /^(Make a task|Open task)$/ }).click();
  if (await page.getByRole('dialog').isVisible()) await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page).toHaveURL(/#\/task\//);
  await (await detailsField(page, 'Task list')).selectOption('next');
  const title = await detailsField(page, 'Task title');
  await title.fill(`Edited header title ${width}`); await title.press('Tab');
  await expect(page.locator('.save-state')).toContainText('Changes synced');
  await page.reload();
  await expect(page.locator('.conversation-compact-title')).toHaveText(`Edited header title ${width}`);
  await expect(header).toHaveClass(/is-compact/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const after = await (await request.get('http://127.0.0.1:8791/calls')).json();
  expect(after.slice(before.length).filter((method: string) => ['session.create', 'session.resume', 'prompt.submit'].includes(method))).toEqual([]);
});

test('touch scrolling preserves the compact header and history uses its own viewport', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage(); await page.goto('/#/conversation/long-history');
    await expect(page.locator('[data-history-message="long-history:450"]')).toBeInViewport();
    const viewport = page.locator('.conversation-scroll'), before = await viewport.evaluate(el => el.scrollTop);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 220, y: 320 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 220, y: 560 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBeLessThan(before);
    await expect(page.locator('.conversation-page-header')).toHaveClass(/is-compact/);
    expect(await page.evaluate(() => scrollY)).toBe(0);
  } finally { await context.close(); }
});
