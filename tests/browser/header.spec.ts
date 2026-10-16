import { test, expect } from '@playwright/test';
import { saveTitle, detailsField, pageAction, closePageActions } from './composer-helpers';

for (const width of [390, 1280]) test(`conversation header preserves title edits and exposes actions through More at ${width}px`, async ({ page, request }) => {
  await page.setViewportSize({ width, height: 844 });
  const before = await (await request.get('http://127.0.0.1:8791/calls')).json();
  await page.goto('/#/conversation/header-history');
  const header = page.locator('.conversation-page-header'), viewport = page.locator('.conversation-scroll');
  await expect(page.getByLabel(/^(Message Hermes|Add a task)$/)).toBeEditable();
  await expect(page.locator('[data-history-message="header-history:450"]')).toBeInViewport();
  await expect(header).not.toHaveClass(/is-compact/);
  await viewport.hover(); await page.mouse.wheel(0,-600);
  await expect(header).toHaveClass(/is-compact/);
  await page.locator('.conversation-page-header').getByRole('button', { name: 'More', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Rename conversation', exact: true })).toBeVisible();
  await viewport.evaluate(el => { el.scrollTop += 200; });
  await closePageActions(page);
  await expect(header).toHaveClass(/is-compact/);
  await (await pageAction(page, 'button', /^(Make a task|Open task)$/)).click();
  if (await page.getByRole('button',{name:'Create task',exact:true}).isVisible()) await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page).toHaveURL(/#\/task\//);
  await (await detailsField(page, 'Task list')).selectOption('next');await page.getByRole('button', { name: 'Move', exact: true }).click();
  const title = await detailsField(page, 'Task title');
  await title.fill(`Edited header title ${width}`); await saveTitle(page);
  await expect(page.locator('.save-state')).toContainText('Changes synced');
  await page.reload();
  await expect(page.locator('.conversation-compact-title')).toHaveText(`Edited header title ${width}`);
  await expect(page.locator('.conversation-compact-title')).toBeVisible();
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
