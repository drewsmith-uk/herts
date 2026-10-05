import { test, expect, type Locator, type Page } from '@playwright/test';

async function usable(locator: Locator) {
  await expect(locator).toBeInViewport();
  await expect.poll(() => locator.evaluate(el => {
    const rect = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
  })).toBe(true);
}
async function older(page: Page) {
  await page.getByLabel('Message Hermes').evaluate(el => (el as HTMLElement).blur());
  const history = page.locator('.conversation-scroll');
  await history.hover();
  const top = await history.evaluate(el => el.scrollTop);
  await page.mouse.wheel(0, -1000);
  // Replacing outgoing feedback with fetched history can change the layout by
  // a few pixels. Require a substantial move into older history, not an exact delta.
  await expect.poll(() => history.evaluate(el => el.scrollTop)).toBeLessThanOrEqual(Math.max(0, top - 500) + 1);
  await expect(page.locator('.conversation-status')).toBeInViewport();
}
async function conversationReady(page: Page) {
  await expect(page.getByLabel('Message Hermes')).toBeEditable();
  await expect(page.locator('.history [data-history-message]').last()).toBeVisible();
  await expect(page.locator('.composer-wrap')).toBeInViewport();
}
for (const width of [390, 1280]) test(`one reachable activity row and task toolbar across all conversation views at ${width}px`, async ({ page, request }) => {
  // This scenario navigates all three views and completes stop, approval and question turns.
  test.setTimeout(90_000);
  await page.setViewportSize({ width, height: 844 });
  await page.goto(`/#/conversation/controls-${width}`);
  const header = page.locator('.conversation-page-header'), taskButton = page.getByRole('button', { name: 'Make a task', exact: true });
  await conversationReady(page);
  if (await header.getByRole('button', { name: 'Collapse page details', exact: true }).isVisible()) await header.getByRole('button', { name: 'Collapse page details', exact: true }).click();
  await usable(taskButton);
  await taskButton.click(); await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await usable(taskButton);
  await page.getByRole('button', { name: `Save to reading list: https://example.com/controls-${width}`, exact: true }).click();
  await page.getByRole('button', { name: `Open reading item: https://example.com/controls-${width}`, exact: true }).click();
  await expect(page).toHaveURL(/#\/reading-item\//);
  const readingUrl = page.url();
  await conversationReady(page);
  await expect(header.getByRole('button', { name: 'Make a task', exact: true })).toHaveCount(1);
  if (await header.getByRole('button', { name: 'Collapse page details', exact: true }).isVisible()) await header.getByRole('button', { name: 'Collapse page details', exact: true }).click();
  await usable(taskButton); await expect(header).toHaveClass(/is-compact/);
  await page.getByLabel('Message Hermes').fill('Standalone wait for stop');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.conversation-status')).toHaveCount(1);
  await expect(page.locator('.conversation-status')).toContainText('Working');
  await expect(page.locator('.execution-card, .working-feedback')).toHaveCount(0);
  await older(page); await usable(page.getByRole('button', { name: 'Stop', exact: true }));
  await page.screenshot({ path: `output/conversation-controls/reading-working-${width}.png` });
  // Creating a task while the agent works does not send, stop, or restart it.
  const before = await (await request.get('http://127.0.0.1:8791/calls')).json();
  await taskButton.click(); await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page).toHaveURL(/#\/task\//);
  await expect(page.locator('.conversation-status')).toContainText('Working');
  expect((await (await request.get('http://127.0.0.1:8791/calls')).json()).slice(before.length).filter((m: string) => ['prompt.submit','session.resume','session.create','session.interrupt'].includes(m))).toEqual([]);
  await expect(page.getByRole('button', { name: 'Open task', exact: true })).toHaveCount(0);
  await older(page); await usable(page.getByRole('button', { name: 'Stop', exact: true }));
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase', 'stopped');
  await page.goto(readingUrl);
  await conversationReady(page);
  if (await header.getByRole('button', { name: 'Collapse page details', exact: true }).isVisible()) await header.getByRole('button', { name: 'Collapse page details', exact: true }).click();
  await usable(page.getByRole('button', { name: 'Open task', exact: true }));
  // Pending approvals stay at the tail; the docked row takes readers to them.
  await page.getByLabel('Message Hermes').fill('Please ask approval'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.conversation-status')).toContainText('Needs your input');
  await older(page);
  await page.getByRole('button', { name: 'Needs your input: view details', exact: true }).click();
  await usable(page.getByRole('button', { name: 'Approve once', exact: true }));
  await expect(page.getByRole('button', { name: 'Approve once', exact: true })).toBeFocused();
  const statusBox = (await page.locator('.conversation-status').boundingBox())!;
  const composerBox = (await page.locator('.composer-wrap').boundingBox())!;
  expect(statusBox.y + statusBox.height).toBeLessThanOrEqual(composerBox.y);
  await page.screenshot({ path: `output/conversation-controls/approval-${width}.png` });
  await page.getByRole('button', { name: 'Approve once', exact: true }).click();
  await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase', 'complete');
  await expect(page.locator('.conversation-status, .conversation-attention')).toHaveCount(0);
  await page.getByLabel('Message Hermes').fill('Please ask clarification'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByLabel('Answer Hermes')).toBeVisible(); await older(page);
  await page.getByRole('button', { name: 'Needs your input: view details', exact: true }).click();
  await usable(page.getByLabel('Answer Hermes')); await page.getByLabel('Answer Hermes').fill('Check the article first.');
  await page.getByRole('button', { name: 'Send answer', exact: true }).click();
  await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase', 'complete');
  await expect(page.locator('.conversation-status')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const theme of ['fieldwork', 'press', 'nocturne']) test(`${theme} keeps the compact toolbar and pending controls usable down to 320px`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#/settings'); await page.getByLabel('Theme on this device', { exact: true }).selectOption(theme);
  await page.goto(`/#/conversation/controls-${theme}`);
  await page.getByLabel('Message Hermes').fill('Please ask approval'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.conversation-status')).toContainText('Needs your input');
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 }); await older(page);
    const collapse = page.getByRole('button', { name: 'Collapse page details', exact: true });
    if (await collapse.count()) await collapse.click();
    await expect(page.locator('.conversation-page-header')).toHaveClass(/is-compact/);
    await usable(page.getByRole('button', { name: 'Make a task', exact: true }));
    await usable(page.getByRole('button', { name: 'Stop', exact: true }));
    await usable(page.getByRole('button', { name: 'Needs your input: view details', exact: true }));
    expect((await page.locator('.conversation-page-header').boundingBox())!.height).toBeLessThan(80);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `output/conversation-controls/${theme}-compact-${width}.png` });
  }
  await page.getByRole('button', { name: 'Needs your input: view details', exact: true }).click();
  await page.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase', 'complete');
  await expect(page.locator('.conversation-status')).toHaveCount(0);
  expect(errors).toEqual([]);
});
