import { test, expect, type Locator, type Page } from '@playwright/test';

async function mouseSwipe(page: Page, item: Locator, dx: number) {
  await item.scrollIntoViewIfNeeded(); const box = (await item.locator('.conversation-row').boundingBox())!;
  const x = box.x + box.width * (dx < 0 ? .8 : .2), y = box.y + 38;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y, { steps: 8 }); await page.mouse.up();
}
async function changeVisibilityFromView(page: Page, id: string, hidden: boolean) {
  await page.goto(`/#/conversation/${id}`);
  await page.getByRole('button', { name: hidden ? 'Hide conversation' : 'Unhide conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: hidden ? 'Unhide conversation' : 'Hide conversation', exact: true })).toBeEnabled();
  await page.locator('.back-link').click();
}

test('phone swipes respect scrolling and cancellation, hide with undo, and create exactly one task', async ({ browser, request }) => {
  const before: string[] = await (await request.get('http://127.0.0.1:8791/calls')).json();
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:8790', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage(); let writes = 0;
    page.on('request', r => { if (r.method() === 'POST' && !/\/plugins\/[^/]+\/queries\//.test(new URL(r.url()).pathname)) writes++; });
    await page.goto('/#/conversations'); await page.getByLabel('Search conversations').fill('Swipe conversation');
    const item = page.locator('[data-conversation-key="swipe-first"]');
    await expect(item).toBeVisible();
    await expect(page.locator('.conversation-list button')).toHaveCount(0);
    const cdp = await context.newCDPSession(page);
    async function swipe(target: Locator, dx: number, dy = 0, cancel = false) {
      await target.scrollIntoViewIfNeeded(); const box = (await target.locator('.conversation-row').boundingBox())!;
      const x = box.x + (dx < 0 ? box.width * .8 : box.width * .2), y = box.y + 38;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 6, y: y + dy * i / 6 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
    }
    await swipe(item, 35); await expect(item).toBeVisible(); expect(writes).toBe(0); await expect(page).toHaveURL(/#\/conversations$/);
    const scrollBefore = await page.evaluate(() => scrollY);
    await swipe(item, 4, -120); await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(scrollBefore);
    expect(writes).toBe(0); await expect(item).toBeVisible();
    await swipe(item, -150, 0, true); expect(writes).toBe(0); await expect(item).toBeVisible();
    await swipe(item, -150); await expect(item).toHaveCount(0); await expect(page).toHaveURL(/#\/conversations$/);
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(item).toBeVisible();
    await swipe(item, -150); await expect(item).toHaveCount(0);
    await page.getByLabel('Show hidden items').check(); await expect(item.locator('.hidden-item-badge')).toHaveText('Hidden');
    await page.screenshot({ path: 'test-results/phone-conversation-triage.png', fullPage: true });
    await swipe(item, -150); await expect(item.locator('.hidden-item-badge')).toHaveCount(0);
    await swipe(item, 150); await expect(page.getByText('Task created in Personal Inbox.', { exact: true })).toBeVisible(); await expect(item).toHaveCount(0);
    await expect(page).toHaveURL(/#\/conversations$/);
    await page.getByLabel('Show linked conversations').check(); await expect(item).toContainText('Task created');
    const state = await (await request.get('/api/v1/state')).json();
    expect(state.snapshot.tasks.filter((t: any) => t.link?.key === 'swipe-first')).toHaveLength(1);
    await swipe(item, 150); await expect(page.getByLabel('Task title', { exact: true })).toHaveValue('Swipe conversation one');
    expect((await (await request.get('/api/v1/state')).json()).snapshot.tasks.filter((t: any) => t.link?.key === 'swipe-first')).toHaveLength(1);
    const after: string[] = await (await request.get('http://127.0.0.1:8791/calls')).json();
    expect(after.slice(before.length).filter(m => ['session.create', 'session.resume', 'prompt.submit', 'session.interrupt'].includes(m))).toEqual([]);
  } finally { await context.close(); }
});

test('hidden items survive offline reload, search saved results and sync between devices', async ({ page, context, browser }) => {
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.goto('/#/conversations');
  const item = page.locator('[data-conversation-key="hidden-offline"]'); await expect(item).toBeVisible();
  await page.getByLabel('Show hidden items').check(); await expect(item).toBeVisible();
  await page.getByLabel('Show hidden items').uncheck(); await expect(item).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  const otherContext = await browser.newContext({ baseURL: 'http://127.0.0.1:8790' });
  try {
    const other = await otherContext.newPage(); await other.goto('/#/conversations'); await other.getByLabel('Search conversations').fill('Offline triage');
    const otherItem = other.locator('[data-conversation-key="hidden-offline"]'); await expect(otherItem).toBeVisible();
    await context.setOffline(true);
    await changeVisibilityFromView(page, 'hidden-offline', true); await expect(item).toHaveCount(0);
    await page.reload(); await expect(page.getByText('SAVED ON THIS DEVICE', { exact: true })).toBeVisible(); await expect(item).toHaveCount(0);
    await page.getByLabel('Show hidden items').check(); await expect(item.locator('.hidden-item-badge')).toHaveText('Hidden');
    await page.getByLabel('Search conversations').fill('Offline triage'); await expect(item).toBeVisible();
    await page.getByLabel('Show hidden items').uncheck(); await expect(item).toHaveCount(0);
    await page.getByLabel('Show hidden items').check(); await expect(item).toBeVisible();
    await context.setOffline(false); await expect(page.locator('.save-state')).toContainText('All changes saved');
    await expect(otherItem).toHaveCount(0);
    // Cache an empty filtered result, then unhide offline: the restored item must still be found.
    await page.getByLabel('Show hidden items').uncheck(); await expect(item).toHaveCount(0); await expect(page.locator('.loading')).toHaveCount(0);
    await page.getByLabel('Show hidden items').check(); await expect(item).toBeVisible();
    await context.setOffline(true);
    await changeVisibilityFromView(page, 'hidden-offline', false);
    await expect(item.locator('.hidden-item-badge')).toHaveCount(0);
    await page.getByLabel('Show hidden items').uncheck(); await expect(item).toBeVisible();
    await page.reload(); await page.getByLabel('Search conversations').fill('Offline triage'); await expect(item).toBeVisible();
    await changeVisibilityFromView(page, 'hidden-offline', true); await expect(item).toHaveCount(0);
    await page.getByLabel('Show hidden items').check(); await expect(item).toBeVisible();
    await context.setOffline(false); await expect(page.locator('.save-state')).toContainText('All changes saved');
    await other.getByLabel('Show hidden items').check(); await expect(otherItem.locator('.hidden-item-badge')).toHaveText('Hidden');
    await changeVisibilityFromView(other, 'hidden-offline', false);
    await expect(other.locator('.save-state')).toContainText('All changes saved');
    await expect(item.locator('.hidden-item-badge')).toHaveCount(0);
    await page.reload(); await page.getByLabel('Search conversations').fill('Offline triage'); await expect(item).toBeVisible();
    await expect(page.getByLabel('Show hidden items')).not.toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/desktop-conversation-triage.png' });
  } finally { await otherContext.close(); }
});

test('recovering task creation after a lost response and reload reuses the saved intent and creates one task', async ({ page, request }) => {
  await page.goto('/#/conversations'); await page.getByLabel('Search conversations').fill('Receipt triage');
  const item = page.locator('[data-conversation-key="triage-receipt"]'); await expect(item).toBeVisible();
  const initial = await (await request.get('/api/v1/state')).json();
  let holdState = true; const ids: string[] = [];
  await page.route('**/api/v1/state', route => holdState ? route.fulfill({ json: initial }) : route.continue());
  await page.route('**/api/v1/plugins/tasks/commands', async route => {
    if (route.request().postDataJSON().command !== 'link') return route.continue();
    ids.push(route.request().postDataJSON().id);
    if (holdState) { await route.fetch(); await route.abort(); }
    else await route.continue();
  });
  await mouseSwipe(page, item, 150);
  await expect(page.getByRole('alert')).toContainText('The task request is saved');
  await page.reload();
  await expect.poll(() => ids.length).toBeGreaterThanOrEqual(2);
  holdState = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('.save-state')).toContainText('All changes saved');
  await page.getByLabel('Show linked conversations').check();
  await expect(item).toContainText('Task created');
  expect(new Set(ids).size).toBe(1);
  const final = await (await request.get('/api/v1/state')).json();
  expect(final.snapshot.tasks.filter((t: any) => t.link?.key === 'triage-receipt')).toHaveLength(1);
});

test('hiding on a later page preserves loaded conversations and the reading position', async ({ page, request }) => {
  const rows = Array.from({ length: 70 }, (_, i) => ({ id: `page-${i}`, key: `page-${i}`, aliases: [`page-${i}`], title: `Page conversation ${i}`, preview: 'Available history', source: 'desktop', updatedAt: Date.now() - i }));
  await page.route('**/api/v1/conversations?*', async route => {
    const state = await (await request.get('/api/v1/state')).json();
    const url = new URL(route.request().url()), offset = Number(url.searchParams.get('offset'));
    const visible = rows.filter(c => url.searchParams.get('includeHidden') === 'true' || !state.snapshot.hiddenConversations.includes(c.key));
    await route.fulfill({ json: { conversations: visible.slice(offset, offset + 50), hasMore: visible.length > offset + 50, total: visible.length } });
  });
  await page.goto('/#/conversations'); await expect(page.locator('.conversation-row')).toHaveCount(50);
  await page.getByRole('button', { name: 'Load more conversations' }).click(); await expect(page.locator('.conversation-row')).toHaveCount(70);
  const item = page.locator('[data-conversation-key="page-60"]'); await item.scrollIntoViewIfNeeded();
  const before = await page.locator('[data-conversation-key="page-61"]').evaluate(e => e.getBoundingClientRect().top);
  await mouseSwipe(page, item, -150);
  await expect(page.locator('.save-state')).toContainText('All changes saved');
  await expect(page.locator('.loading')).toHaveCount(0); await expect(page.locator('.conversation-row')).toHaveCount(69);
  await expect(page.locator('[data-conversation-key="page-69"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Load more conversations' })).toHaveCount(0);
  expect(Math.abs(await page.locator('[data-conversation-key="page-61"]').evaluate(e => e.getBoundingClientRect().top) - before)).toBeLessThan(220);
});
