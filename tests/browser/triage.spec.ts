import { detailsField, detailsControl, closePageActions } from './composer-helpers';
import { test, expect, type Locator, type Page } from '@playwright/test';

async function swipeBox(item: Locator) {
  await expect(item).toHaveAttribute('aria-busy', 'false');
  const row = item.locator('.conversation-row');
  await row.scrollIntoViewIfNeeded();
  // The wrapper stays still while its content returns from the previous swipe.
  // Read coordinates only after that animation finishes.
  await expect(item.locator('.conversation-item-content')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  return (await row.boundingBox())!;
}

async function mouseSwipe(page: Page, item: Locator, dx: number) {
  const box = await swipeBox(item);
  const x = box.x + box.width * (dx < 0 ? .8 : .2), y = box.y + 38;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y, { steps: 8 }); await page.mouse.up();
}
async function changeVisibilityFromView(page: Page, id: string, hidden: boolean) {
  await page.goto(`/#/conversation/${id}`);
  await (await detailsControl(page, 'button', hidden ? 'Hide conversation' : 'Unhide conversation')).click();
  await expect(page.getByRole('button', { name: hidden ? 'Unhide conversation' : 'Hide conversation', exact: true })).toBeEnabled();
  await closePageActions(page); await page.getByRole('link', { name: 'Back to Conversations', exact: true }).click();
}

test('phone swipes respect scrolling and cancellation, hide with undo, and create exactly one task', async ({ browser, request }) => {
  const before: string[] = await (await request.get('http://127.0.0.1:8791/calls')).json();
  // The compact three-row result fits taller phones; use a short viewport to exercise scrolling.
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:8790', viewport: { width: 390, height: 600 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage(); let writes = 0;
    page.on('request', r => { if (r.method() === 'POST' && !/\/plugins\/[^/]+\/queries\//.test(new URL(r.url()).pathname)) writes++; });
    await page.goto('/#/conversations');
    // Slow the return animation to expose gesture coordinates read before the row settles.
    await page.addStyleTag({ content: '.conversation-item-content { transition-duration: 1s; }' });
    await page.getByLabel('Search conversations').fill('Swipe conversation');
    const item = page.locator('[data-conversation-key="swipe-first"]');
    await expect(item).toBeVisible();
    await expect(page.locator('.conversation-list button:not(.swipe-keyboard-action)')).toHaveCount(0);
    await expect(item.locator('.swipe-keyboard-action')).toHaveCSS('clip-path', 'inset(50%)');
    const cdp = await context.newCDPSession(page);
    async function swipe(target: Locator, dx: number, dy = 0, cancel = false) {
      const box = await swipeBox(target);
      const x = box.x + (dx < 0 ? box.width * .8 : box.width * .2), y = box.y + 38;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 6, y: y + dy * i / 6 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
    }
    await swipe(item, 35); await expect(item).toBeVisible(); expect(writes).toBe(0); await expect(page).toHaveURL(/#\/conversations$/);
    const scrollBefore = await page.evaluate(() => scrollY);
    expect(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight)).toBe(true);
    await swipe(item, 4, -120); await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(scrollBefore);
    expect(writes).toBe(0); await expect(item).toBeVisible();
    await swipe(item, -150, 0, true); expect(writes).toBe(0); await expect(item).toBeVisible();
    await swipe(item, -150); await expect(item).toHaveCount(0); await expect(page).toHaveURL(/#\/conversations$/);
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(item).toBeVisible();
    await swipe(item, -150); await expect(item).toHaveCount(0);
    await page.getByLabel('Show all').check(); await expect(item.locator('.hidden-item-badge')).toHaveText('Hidden');
    await page.screenshot({ path: 'test-results/phone-conversation-triage.png', fullPage: true });
    await swipe(item, -150); await expect(item.locator('.hidden-item-badge')).toHaveCount(0);
    await swipe(item, 150); await expect(page.getByText('Task created in Personal Inbox.', { exact: true })).toBeVisible(); await expect(item).toBeVisible();
    await expect(page).toHaveURL(/#\/conversations$/);
    await expect(item).toContainText('Task created');
    await page.getByLabel('Show all').uncheck(); await expect(item).toHaveCount(0);
    await page.getByLabel('Show all').check(); await expect(item).toBeVisible();
    const state = await (await request.get('/api/v1/state')).json();
    expect(state.snapshot.tasks.filter((t: any) => t.link?.key === 'swipe-first')).toHaveLength(1);
    await swipe(item, 150); await expect((await detailsField(page, 'Task title'))).toHaveValue('Swipe conversation one');
    expect((await (await request.get('/api/v1/state')).json()).snapshot.tasks.filter((t: any) => t.link?.key === 'swipe-first')).toHaveLength(1);
    const after: string[] = await (await request.get('http://127.0.0.1:8791/calls')).json();
    expect(after.slice(before.length).filter(m => ['session.create', 'session.resume', 'prompt.submit', 'session.interrupt'].includes(m))).toEqual([]);
  } finally { await context.close(); }
});

for (const width of [390, 1280]) test(`Undo refreshes the list after a delayed visibility acknowledgement at ${width}px`, async ({ page, request }) => {
  const id = `undo-${crypto.randomUUID()}`, title = `Synthetic Undo ${id}`;
  expect((await request.post('/__test/conversation-message', { headers: { 'x-herts-request': '1' }, data: {
    id, title, text: 'An isolated synthetic conversation for Undo recovery.',
  } })).ok()).toBe(true);
  await page.setViewportSize({ width, height: 844 });
  await page.goto('/#/conversations');
  await page.getByLabel('Search conversations').fill(title);
  const item = page.locator(`[data-conversation-key="${id}"]`);
  await expect(item).toBeVisible();
  const hidden = page.waitForResponse(response => response.url().endsWith('/api/v1/conversations/visibility')
    && response.request().postDataJSON().hidden === true);
  await mouseSwipe(page, item, -150);
  expect((await hidden).ok()).toBe(true);
  await expect(item).toHaveCount(0);
  await expect(page.locator('.loading')).toHaveCount(0);
  let release!: () => void, held = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/conversations/visibility', async route => {
    if (route.request().postDataJSON().hidden === false) { held = true; await gate; }
    await route.continue();
  });
  try {
    const staleList = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/v1/conversations' && url.searchParams.get('q') === title;
    });
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(() => held).toBe(true);
    expect((await (await staleList).json()).conversations.some((row: any) => row.key === id)).toBe(false);
    await expect(page.locator('.loading')).toHaveCount(0);
    release();
    await expect(item).toBeVisible();
    const link = item.getByRole('link');
    await link.focus(); await expect(link).toBeFocused();
    await page.screenshot({ path: `test-results/undo-acknowledgement-${width}.png`, fullPage: true });
  } finally { release(); await page.unroute('**/api/v1/conversations/visibility'); }
});

test('hidden items survive offline reload, search saved results and sync between devices', async ({ page, context, browser }) => {
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.goto('/#/conversations'); await page.getByLabel('Search conversations').fill('Offline triage');
  const item = page.locator('[data-conversation-key="hidden-offline"]'); await expect(item).toBeVisible();
  await page.getByLabel('Show all').check(); await expect(item).toBeVisible();
  await page.getByLabel('Show all').uncheck(); await expect(item).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  const otherContext = await browser.newContext({ baseURL: 'http://127.0.0.1:8790' });
  try {
    const other = await otherContext.newPage(); await other.goto('/#/conversations'); await other.getByLabel('Search conversations').fill('Offline triage');
    const otherItem = other.locator('[data-conversation-key="hidden-offline"]'); await expect(otherItem).toBeVisible();
    await context.setOffline(true);
    await changeVisibilityFromView(page, 'hidden-offline', true); await expect(item).toHaveCount(0);
    await page.reload(); await expect(page.getByText('SAVED ON THIS DEVICE', { exact: true })).toBeVisible(); await expect(item).toHaveCount(0);
    await page.getByLabel('Show all').check(); await expect(item.locator('.hidden-item-badge')).toHaveText('Hidden');
    await page.getByLabel('Search conversations').fill('Offline triage'); await expect(item).toBeVisible();
    await page.getByLabel('Show all').uncheck(); await expect(item).toHaveCount(0);
    await page.getByLabel('Show all').check(); await expect(item).toBeVisible();
    await context.setOffline(false); await expect(page.locator('.save-state')).toContainText('Changes synced');
    await expect(otherItem).toHaveCount(0);
    // Cache an empty filtered result, then unhide offline: the restored item must still be found.
    await page.getByLabel('Show all').uncheck(); await expect(item).toHaveCount(0); await expect(page.locator('.loading')).toHaveCount(0);
    await page.getByLabel('Show all').check(); await expect(item).toBeVisible();
    await context.setOffline(true);
    await changeVisibilityFromView(page, 'hidden-offline', false);
    await expect(item.locator('.hidden-item-badge')).toHaveCount(0);
    await page.getByLabel('Show all').uncheck(); await expect(item).toBeVisible();
    await page.reload(); await page.getByLabel('Search conversations').fill('Offline triage'); await expect(item).toBeVisible();
    await changeVisibilityFromView(page, 'hidden-offline', true); await expect(item).toHaveCount(0);
    await page.getByLabel('Show all').check(); await expect(item).toBeVisible();
    await context.setOffline(false); await expect(page.locator('.save-state')).toContainText('Changes synced');
    await other.getByLabel('Show all').check(); await expect(otherItem.locator('.hidden-item-badge')).toHaveText('Hidden');
    await changeVisibilityFromView(other, 'hidden-offline', false);
    await expect(other.locator('.save-state')).toContainText('Changes synced');
    await expect(item.locator('.hidden-item-badge')).toHaveCount(0);
    await page.reload(); await page.getByLabel('Search conversations').fill('Offline triage'); await expect(item).toBeVisible();
    await expect(page.getByLabel('Show all')).not.toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/desktop-conversation-triage.png' });
  } finally { await otherContext.close(); }
});

test('recovering task creation after a lost response and reload reuses the saved intent and creates one task', async ({ page, request }) => {
  const id = `receipt-${crypto.randomUUID()}`, title = `Receipt recovery ${id}`, headers = { 'x-herts-request': '1' };
  expect((await request.post('/__test/conversation-message', { headers, data: { id, title, text: 'Synthetic task creation recovery.' } })).ok()).toBe(true);
  await page.goto('/#/conversations'); await page.getByLabel('Search conversations').fill(title);
  const item = page.locator(`[data-conversation-key="${id}"]`); await expect(item).toBeVisible();
  const initial = await (await request.get('/api/v1/state')).json();
  const configure = async (action: string) => expect((await request.post('/__test/task-link-recovery', { headers, data: { action, ...(action === 'hold' ? { initial } : {}) } })).ok()).toBe(true);
  const status = async () => (await request.get('/__test/task-link-recovery')).json();
  await configure('hold');
  try {
    await mouseSwipe(page, item, 150);
    await expect(page.getByRole('alert')).toContainText('The task request is saved');
    await expect.poll(async () => (await status()).refreshStarted).toBe(true);
    await configure('release-list');
    await expect(page.locator('.loading')).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText('The task request is saved');
    await page.reload();
    await expect.poll(async () => (await status()).ids.length).toBeGreaterThanOrEqual(2);
    await configure('resume');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.locator('.save-state')).toContainText('Changes synced');
    await expect(page.getByLabel('Show all')).not.toBeChecked();
    await page.getByLabel('Show all').check();
    await page.getByLabel('Search conversations').fill(title);
    await expect(item).toContainText('Task created');
    expect(new Set((await status()).ids).size).toBe(1);
    const final = await (await request.get('/api/v1/state')).json();
    expect(final.snapshot.tasks.filter((t: any) => t.link?.key === id)).toHaveLength(1);
  } finally { await configure('reset'); }
});

test('hiding on a later page preserves loaded conversations and the reading position', async ({ page, request }) => {
  const rows = Array.from({ length: 70 }, (_, i) => ({ id: `page-${i}`, key: `page-${i}`, aliases: [`page-${i}`], title: `Page conversation ${i}`, preview: 'Available history', source: 'desktop', updatedAt: Date.now() - i }));
  await page.route('**/api/v1/conversations?*', async route => {
    const state = await (await request.get('/api/v1/state')).json();
    const url = new URL(route.request().url()), offset = Number(url.searchParams.get('offset')), limit = Number(url.searchParams.get('limit') || 50);
    const visible = rows.filter(c => url.searchParams.get('includeHidden') === 'true' || !state.snapshot.hiddenConversations.includes(c.key));
    await route.fulfill({ json: { conversations: visible.slice(offset, offset + limit), hasMore: visible.length > offset + limit, total: visible.length } });
  });
  try {
    await page.goto('/#/conversations'); await expect(page.locator('.conversation-row')).toHaveCount(50);
    await page.getByRole('button', { name: 'Load more conversations' }).click(); await expect(page.locator('.conversation-row')).toHaveCount(70);
    const item = page.locator('[data-conversation-key="page-60"]'); await item.scrollIntoViewIfNeeded();
    const before = await page.locator('[data-conversation-key="page-61"]').evaluate(e => e.getBoundingClientRect().top);
    await mouseSwipe(page, item, -150);
    await expect(page.locator('.save-state')).toContainText('Changes synced');
    await expect(page.locator('.loading')).toHaveCount(0); await expect(page.locator('.conversation-row')).toHaveCount(69);
    await expect(page.locator('[data-conversation-key="page-69"]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Load more conversations' })).toHaveCount(0);
    expect(Math.abs(await page.locator('[data-conversation-key="page-61"]').evaluate(e => e.getBoundingClientRect().top) - before)).toBeLessThan(220);
  } finally {
    // List refreshes can still be reading state when the assertions finish.
    // Drain those handlers before Playwright disposes the request fixture.
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('loading plugin filters preserves the requested conversation page depth',async({page})=>{
 const rows=Array.from({length:70},(_,i)=>({id:`filter-page-${i}`,key:`filter-page-${i}`,aliases:[`filter-page-${i}`],title:`Filter page ${i}`,preview:'Synthetic history',source:'desktop',updatedAt:Date.now()-i}));
 let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 await page.route('**/_plugins/tasks/**/client.js',async route=>{await gate;await route.continue();});
 await page.route('**/api/v1/conversations?*',route=>{const params=new URL(route.request().url()).searchParams,offset=Number(params.get('offset')),limit=Number(params.get('limit')||50);return route.fulfill({json:{conversations:rows.slice(offset,offset+limit),hasMore:rows.length>offset+limit,total:rows.length}});});
 try{await page.goto('/#/conversations');await expect(page.locator('.conversation-row')).toHaveCount(50);await page.getByRole('button',{name:'Load more conversations'}).click();await expect(page.locator('.conversation-row')).toHaveCount(70);release();await expect(page.locator('.sidebar').getByRole('link',{name:'Reading',exact:true})).toBeVisible();await expect(page.locator('.conversation-row')).toHaveCount(70);await expect(page.getByRole('button',{name:'Load more conversations'})).toHaveCount(0);}
 finally{release();await page.unrouteAll({behavior:'wait'});}
});
