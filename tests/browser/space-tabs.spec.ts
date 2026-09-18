import { test, expect, type Page, type APIRequestContext, type Locator } from '@playwright/test';
import { originalSpaceId, spacePath } from '../../shared/model';

const headers = { 'x-tasks-request': '1' };
const snapshot = async (request: APIRequestContext) => (await (await request.get('/api/v1/state')).json()).snapshot;
const tab = (page: Page, id: string) => page.getByRole('navigation', { name: 'Task spaces', exact: true }).locator(`[data-drop-space="${id}"]`);
const row = (page: Page, id: string) => page.locator(`[data-task-id="${id}"]`);
const agentCalls = async (request: APIRequestContext) => (await (await request.get('http://127.0.0.1:8791/calls')).json() as string[]).filter(m => ['session.create', 'session.resume', 'prompt.submit', 'session.interrupt'].includes(m));
async function space(request: APIRequestContext, name: string) {
  const spaceId = crypto.randomUUID();
  expect((await request.post('/api/v1/spaces/sync', { headers, data: { id: crypto.randomUUID(), spaceId, kind: 'create', name, at: Date.now() } })).ok()).toBe(true);
  return spaceId;
}
async function task(request: APIRequestContext, spaceId: string, title: string) {
  const taskId = crypto.randomUUID();
  expect((await request.post('/api/v1/sync', { headers, data: { id: crypto.randomUUID(), taskId, spaceId, kind: 'create', title, at: Date.now() } })).ok()).toBe(true);
  return taskId;
}
async function pickUp(page: Page, source: Locator) {
  await source.scrollIntoViewIfNeeded(); const b = (await source.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.waitForTimeout(550);
  await expect(page.locator('.task-drag-overlay')).toBeVisible();
}
async function drop(page: Page, target: Locator) {
  const b = (await target.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 }); await expect(target).toHaveClass(/task-drop-over/); await page.mouse.up();
}

for (const width of [390, 1280]) test(`space tabs and creation modal work on ${width}px without changing the default`, async ({ page, request }) => {
  await page.setViewportSize({ width, height: 844 });
  const before = await agentCalls(request), defaultId = (await snapshot(request)).defaultSpaceId, name = `Tab space ${width}`;
  await page.goto(`/#${spacePath(originalSpaceId, 'next')}`);
  await expect(page.getByRole('combobox', { name: 'Viewing space' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Sidebar space' })).toHaveCount(0);
  const add = page.getByRole('button', { name: 'Create space', exact: true });
  await add.click(); const dialog = page.getByRole('dialog', { name: 'Create space' });
  await expect(dialog.getByLabel('New space name', { exact: true })).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Create space', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(add).toBeFocused();
  await add.click(); await dialog.getByLabel('New space name', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Create space', exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(page.locator('.save-state')).toContainText('All changes saved');
  const current = (await snapshot(request)).spaces.find((s: any) => s.name === name).id;
  await expect(page).toHaveURL(new RegExp(`/spaces/${current}/inbox$`)); await expect(tab(page, current)).toHaveAttribute('aria-current', 'page');
  expect((await snapshot(request)).defaultSpaceId).toBe(defaultId);
  await page.getByLabel('New task title', { exact: true }).fill('A draft for this space');
  await tab(page, originalSpaceId).click(); await expect(page.getByLabel('New task title', { exact: true })).toHaveValue('');
  await tab(page, current).click(); await expect(page.getByLabel('New task title', { exact: true })).toHaveValue('A draft for this space');
  await add.click(); await dialog.getByLabel('New space name', { exact: true }).fill(name.toUpperCase());
  await dialog.getByRole('button', { name: 'Create space', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('already exists'); await expect(dialog.getByLabel('New space name')).toHaveValue(name.toUpperCase());
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await agentCalls(request)).toEqual(before); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/space-tabs-${width}.png` });
});

for (const width of [390, 1280]) test(`overflow tabs scroll during a drag and move into the destination Inbox on ${width}px`, async ({ page, request }) => {
  await page.setViewportSize({ width, height: 844 });
  const source = await space(request, `Drag source ${width}`), before = await agentCalls(request);
  for (let i = 0; i < 9; i++) await space(request, `Extra ${width} ${i + 1}`);
  const destination = await space(request, `Far destination ${width}`), existing = await task(request, destination, 'Already in destination'), moved = await task(request, source, 'Move between spaces');
  await page.goto(`/#${spacePath(source)}`); await expect(row(page, moved)).toBeVisible();
  const tabs = page.getByRole('navigation', { name: 'Task spaces', exact: true });
  const overflow = await tabs.evaluate(node => {
    const add = node.querySelector('button')!, r = node.getBoundingClientRect();
    return { scrolls: node.scrollWidth > node.clientWidth, plusOffscreen: add.getBoundingClientRect().left >= r.right, plusLast: node.lastElementChild === add };
  });
  expect(overflow).toEqual({ scrolls: true, plusOffscreen: true, plusLast: true });
  await pickUp(page, row(page, moved));
  const bounds = (await tabs.boundingBox())!;
  // Hold near the right edge to expose tabs beyond the visible part of the row.
  await page.mouse.move(bounds.x + bounds.width - 10, bounds.y + bounds.height / 2, { steps: 8 });
  await expect.poll(async () => tab(page, destination).evaluate(node => {
    const r = node.getBoundingClientRect(), parent = node.parentElement!.getBoundingClientRect();
    return r.right <= parent.right && r.left >= parent.left;
  })).toBe(true);
  await drop(page, tab(page, destination)); await expect(row(page, moved)).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/spaces/${source}/inbox$`));
  await expect(page.locator('.save-state')).toContainText('All changes saved');
  const s = await snapshot(request); expect(s.tasks.find((t: any) => t.id === moved)).toMatchObject({ spaceId: destination, status: 'inbox' });
  expect(s.spaceLists[destination].inbox.ids.slice(0, 2)).toEqual([moved, existing]);
  await tab(page, destination).click(); await expect(row(page, moved)).toBeVisible(); expect(await agentCalls(request)).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (width === 390) await expect(page.locator('.mobile-nav')).toBeInViewport();
  await page.screenshot({ path: `test-results/space-tabs-overflow-${width}.png` });
});

test('creating a space in the modal offline retains it and its tasks after reload', async ({ page, context, request }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/#/tasks');
  await expect(page.locator('.save-state')).toContainText('All changes saved'); await page.evaluate(() => navigator.serviceWorker.ready); await page.reload();
  await context.setOffline(true);
  try {
    await page.getByRole('button', { name: 'Create space', exact: true }).click(); const dialog = page.getByRole('dialog');
    await dialog.getByLabel('New space name').fill('Offline tab space'); await dialog.getByRole('button', { name: 'Create space', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Task spaces' }).getByRole('link', { name: 'Offline tab space', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.getByLabel('New task title', { exact: true }).fill('Offline space task'); await page.getByRole('button', { name: 'Add task', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Offline space task', exact: true })).toBeVisible(); await page.reload();
    await expect(page.getByRole('link', { name: 'Offline space task', exact: true })).toBeVisible();
  } finally { await context.setOffline(false); }
  await expect(page.locator('.save-state')).toContainText('All changes saved'); const s = await snapshot(request);
  const id = s.spaces.find((v: any) => v.name === 'Offline tab space').id; expect(s.tasks.find((t: any) => t.title === 'Offline space task').spaceId).toBe(id);
});

test('touch scrolling reveals more space tabs and a held snoozed task can move to another space', async ({ browser, request }) => {
  const source = await space(request, 'Touch source space'), destination = await space(request, 'Touch destination space');
  const moved = await task(request, source, 'Touch move from Snoozed'), at = Date.now(), before = await agentCalls(request);
  expect((await request.post('/api/v1/sync', { headers, data: { id: crypto.randomUUID(), taskId: moved, spaceId: source, baseSpaceId: source, kind: 'snooze', baseStatus: 'inbox', baseSnoozeId: null, snoozedUntil: at + 3600_000, at } })).ok()).toBe(true);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage(), cdp = await context.newCDPSession(page);
    await page.goto(`/#${spacePath(source, 'snoozed')}`); await expect(row(page, moved)).toBeVisible();
    const tabs = page.getByRole('navigation', { name: 'Task spaces', exact: true }), bounds = (await tabs.boundingBox())!, scroll = await tabs.evaluate(node => node.scrollLeft);
    const y = bounds.y + bounds.height / 2, x = bounds.x + bounds.width - 25;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - i * 27, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => tabs.evaluate(node => node.scrollLeft)).toBeGreaterThan(scroll);
    await expect(page.locator('.task-drag-overlay')).toHaveCount(0); await expect(page.getByRole('dialog')).toHaveCount(0);
    await tab(page, destination).scrollIntoViewIfNeeded(); await row(page, moved).scrollIntoViewIfNeeded();
    const from = (await row(page, moved).boundingBox())!, target = (await tab(page, destination).boundingBox())!;
    const sx = from.x + from.width / 2, sy = from.y + from.height / 2, tx = target.x + target.width / 2, ty = target.y + target.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] });
    await page.waitForTimeout(550); await expect(page.locator('.task-drag-overlay')).toBeVisible();
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx + (tx - sx) * i / 8, y: sy + (ty - sy) * i / 8 }] });
    await expect(tab(page, destination)).toHaveClass(/task-drop-over/);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(row(page, moved)).toHaveCount(0); await expect(page.locator('.save-state')).toContainText('All changes saved');
    expect((await snapshot(request)).tasks.find((t: any) => t.id === moved)).toMatchObject({ spaceId: destination, status: 'inbox', snoozedUntil: null, snoozeId: null });
    await expect(page).toHaveURL(new RegExp(`/spaces/${source}/snoozed$`)); expect(await agentCalls(request)).toEqual(before);
  } finally { await context.close(); }
});
