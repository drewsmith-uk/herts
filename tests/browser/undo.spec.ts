import { test, expect } from '@playwright/test';

test('completion and reading undo survive navigation and offline use', async ({ page, request, context }) => {
  const title = `Undo task ${crypto.randomUUID()}`, reading = `Undo reading ${crypto.randomUUID()}`;
  await request.post('/api/v1/sync', { headers: { 'x-herts-request': '1' }, data: { id: crypto.randomUUID(), taskId: crypto.randomUUID(), kind: 'create', title, at: Date.now() } });
  await request.post('/api/v1/reading/sync', { headers: { 'x-herts-request': '1' }, data: { id: crypto.randomUUID(), itemId: crypto.randomUUID(), contextId: crypto.randomUUID(), kind: 'create', title: reading, url: 'https://example.com/undo', at: Date.now() } });
  await page.goto('/#/tasks/inbox');
  await expect(page.getByRole('button', { name: `Complete ${title}`, exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: `Complete ${title}`, exact: true }).click();
  const toast = page.getByRole('region', { name: 'Recent change' });
  await expect(toast).toContainText('Marked as complete.');
  await expect(page.getByRole('link', { name: title, exact: true })).toHaveCount(0);
  await page.evaluate(() => { location.hash = '/reading'; });
  await toast.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(toast).toHaveCount(0);
  const readingOrder = await page.locator('.reading-row .task-title').allTextContents();
  await page.getByRole('button', { name: `Mark read: ${reading}`, exact: true }).click();
  await expect(toast).toContainText('Marked as read.');
  await toast.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('link', { name: reading, exact: true })).toBeVisible();
  await expect.poll(() => page.locator('.reading-row .task-title').allTextContents()).toEqual(readingOrder);
  await page.evaluate(() => { location.hash = '/tasks/inbox'; });
  await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
  await context.setOffline(false);
  await expect(page.locator('.save-state')).toHaveText('Changes synced');
  await page.reload();
  await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
});

test('queued changes get separate undo periods and expire after five seconds', async ({ page }) => {
  await page.goto('/#/tasks/inbox');
  await expect(page.locator('.page-header')).toBeVisible();
  await page.clock.install({ time: new Date('2026-10-14T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-14T12:00:01Z'));
  await page.evaluate(async () => {
    const sdk = (globalThis as any).__HERTS_PLUGIN_RUNTIME__.sdk;
    (globalThis as any).undoCalls = 0;
    await sdk.undoableAction('first', 'First change.', async () => {}, async () => { (globalThis as any).undoCalls++; });
    await sdk.undoableAction('second', 'Second change.', async () => {}, async () => { (globalThis as any).undoCalls++; });
  });
  const toast = page.locator('.undo-toast');
  await expect(toast).toContainText('First change.');
  await page.clock.runFor(4900);
  await expect(toast).toContainText('First change.');
  await page.clock.runFor(100);
  await expect(toast).toContainText('Second change.');
  await page.clock.runFor(5000);
  await expect(toast).toHaveCount(0);
  expect(await page.evaluate(() => (globalThis as any).undoCalls)).toBe(0);
});

test('delayed actions wait for acknowledgement and failed undo is not repeated', async ({ page }) => {
  await page.goto('/#/tasks/inbox');
  await expect(page.locator('.page-header')).toBeVisible();
  await page.evaluate(() => {
    const runtime = globalThis as any;
    runtime.undoCalls = 0;
    void runtime.__HERTS_PLUGIN_RUNTIME__.sdk.undoableAction('delayed', 'Saved.', () => new Promise(resolve => { runtime.finishChange = resolve; }), async () => {
      runtime.undoCalls++;
      await new Promise(resolve => setTimeout(resolve, 300));
      throw new Error('Could not undo. Check the list.');
    });
  });
  await expect(page.locator('.undo-toast')).toHaveCount(0);
  await page.evaluate(() => (globalThis as any).finishChange());
  await page.locator('.undo-toast button').click();
  await expect(page.locator('.undo-toast button')).toBeDisabled();
  await expect(page.locator('.undo-toast')).toContainText('Could not undo. Check the list.');
  expect(await page.evaluate(() => (globalThis as any).undoCalls)).toBe(1);
  await page.locator('.undo-toast').getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.locator('.undo-toast')).toHaveCount(0);
});

test('undo restores task position and a future snooze', async ({ page, request }) => {
  const headers = { 'x-herts-request': '1' }, spaceId = crypto.randomUUID();
  await request.post('/api/v1/spaces/sync', { headers, data: { id: crypto.randomUUID(), spaceId, kind: 'create', name: `Undo ${spaceId}`, at: Date.now() } });
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  for (const taskId of ids) await request.post('/api/v1/sync', { headers, data: { id: crypto.randomUUID(), taskId, spaceId, kind: 'create', title: taskId, at: Date.now() } });
  await page.goto(`/#/spaces/${spaceId}/inbox`);
  const rows = page.locator('.task-item');
  await expect(rows).toHaveCount(3);
  const before = await rows.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-task-id')));
  await page.getByRole('button', { name: `Complete ${ids[1]}`, exact: true }).click();
  await page.locator('.undo-toast').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.undo-toast')).toHaveCount(0);
  await expect.poll(() => rows.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-task-id')))).toEqual(before);
  await expect(page.locator('.save-state')).toHaveText('Changes synced');
  const until = Date.now() + 3600000;
  expect((await request.post('/api/v1/sync', { headers, data: { id: crypto.randomUUID(), taskId: ids[1], spaceId, baseSpaceId: spaceId, kind: 'snooze', baseStatus: 'inbox', baseSnoozeId: null, snoozedUntil: until, at: Date.now() } })).ok()).toBe(true);
  await page.goto(`/#/spaces/${spaceId}/snoozed`);
  await page.getByRole('button', { name: `Complete ${ids[1]}`, exact: true }).click();
  await page.locator('.undo-toast').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.undo-toast')).toHaveCount(0);
  await expect(page.getByRole('link', { name: ids[1], exact: true })).toBeVisible();
  await expect(page.locator('.save-state')).toHaveText('Changes synced');
  const state = (await (await request.get('/api/v1/state')).json()).snapshot;
  expect(state.tasks.find((task: any) => task.id === ids[1]).snoozedUntil).toBe(until);
});

test('failed saves show no undo and duplicate pending actions run once', async ({ page }) => {
  await page.goto('/#/tasks/inbox');
  await expect(page.locator('.page-header')).toBeVisible();
  await page.evaluate(async () => {
    const runtime = globalThis as any, sdk = runtime.__HERTS_PLUGIN_RUNTIME__.sdk;
    runtime.saveCalls = 0;
    const save = async () => { runtime.saveCalls++; await new Promise(resolve => setTimeout(resolve, 200)); throw new Error('Device storage is unavailable.'); };
    await Promise.all([sdk.undoableAction('duplicate', 'Saved.', save, async () => {}), sdk.undoableAction('duplicate', 'Saved.', save, async () => {})]);
  });
  await expect(page.locator('.undo-toast')).toContainText('Device storage is unavailable.');
  await expect(page.locator('.undo-toast').getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (globalThis as any).saveCalls)).toBe(1);
  await page.locator('.undo-toast').getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.locator('.undo-toast')).toHaveCount(0);
});

for (const offline of [false, true]) test(`reading undo preserves saved content ${offline ? 'offline' : 'online'}`, async ({ page, request, context }) => {
  const itemId = crypto.randomUUID(), title = `Saved undo ${itemId}`, headers = { 'x-herts-request': '1' };
  await request.post('/api/v1/reading/sync', { headers, data: { id: crypto.randomUUID(), itemId, contextId: crypto.randomUUID(), kind: 'create', title, url: `https://example.com/${itemId}`, at: Date.now() } });
  await page.goto('/#/reading');
  const row = page.getByRole('group', { name: title, exact: true });
  await expect(row).toContainText('Available offline');
  const article = async () => (await request.post('/api/v1/plugins/reading/queries/article', { headers, data: { id: itemId } })).json();
  const saved = await article();
  if (offline) await context.setOffline(true);
  await row.getByRole('button', { name: `Mark read: ${title}`, exact: true }).click();
  if (!offline) {
    await expect(page.locator('.save-state')).toHaveText('Changes synced');
    expect(await article()).toEqual(saved);
  }
  await page.locator('.undo-toast').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.undo-toast')).toHaveCount(0);
  await expect(row).toContainText('Available offline');
  await page.evaluate(id => { location.hash = `/reader/${id}`; }, itemId);
  await expect(page.locator('.reader-article')).toContainText('Article paragraph 7');
  if (offline) await context.setOffline(false);
  await expect(page.locator('.save-state')).toHaveText('Changes synced');
  expect(await article()).toEqual(saved);
});

test('undo restores original task and reading completion timestamps on the server', async ({ page, request }) => {
  const headers = { 'x-herts-request': '1' }, taskId = crypto.randomUUID(), itemId = crypto.randomUUID();
  const at = Date.now() - 86400000;
  await request.post('/api/v1/sync', { headers, data: { id: crypto.randomUUID(), taskId, kind: 'create', title: taskId, at: at - 1 } });
  await request.post('/api/v1/sync', { headers, data: { id: crypto.randomUUID(), taskId, kind: 'move', status: 'done', baseStatus: 'inbox', at } });
  await request.post('/api/v1/reading/sync', { headers, data: { id: crypto.randomUUID(), itemId, contextId: crypto.randomUUID(), kind: 'create', title: itemId, url: 'https://example.com/time', at: at - 1 } });
  await request.post('/api/v1/reading/sync', { headers, data: { id: crypto.randomUUID(), itemId, kind: 'read', read: true, baseReadAt: null, at } });
  await page.goto('/#/tasks/done');
  await page.getByRole('button', { name: `Reopen ${taskId}`, exact: true }).click();
  await page.locator('.undo-toast').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.undo-toast')).toHaveCount(0);
  await expect(page.locator('.save-state')).toHaveText('Changes synced');
  await page.goto('/#/reading/read');
  await page.getByRole('button', { name: `Mark unread: ${itemId}`, exact: true }).click();
  await page.locator('.undo-toast').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.undo-toast')).toHaveCount(0);
  await expect(page.locator('.save-state')).toHaveText('Changes synced');
  await expect.poll(async () => {
    const state = (await (await request.get('/api/v1/state')).json()).snapshot;
    return [state.tasks.find((item: any) => item.id === taskId).completedAt,
      state.reading.items.find((item: any) => item.id === itemId).readAt];
  }).toEqual([at, at]);
});

test('article cleanup waits until its queued undo window expires', async ({ page, request }) => {
  const itemId = crypto.randomUUID(), title = `Expire ${itemId}`, headers = { 'x-herts-request': '1' };
  await request.post('/api/v1/reading/sync', { headers, data: { id: crypto.randomUUID(), itemId, contextId: crypto.randomUUID(), kind: 'create', title, url: `https://example.com/${itemId}`, at: Date.now() } });
  await page.goto('/#/reading');
  const row = page.getByRole('group', { name: title, exact: true });
  await expect(row).toContainText('Available offline');
  await page.clock.install({ time: new Date('2026-10-14T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-14T12:00:01Z'));
  await page.evaluate(async () => {
    await (globalThis as any).__HERTS_PLUGIN_RUNTIME__.sdk.undoableAction('queue-blocker', 'Earlier change.', async () => {}, async () => {});
  });
  await row.getByRole('button', { name: `Mark read: ${title}`, exact: true }).click();
  const cached = () => page.evaluate(async id => !!await (globalThis as any).__HERTS_PLUGIN_RUNTIME__.sdk.pluginLocal('reading').articles.get(id), itemId);
  expect(await cached()).toBe(true);
  await page.clock.runFor(5000);
  await expect(page.locator('.undo-toast')).toContainText('Marked as read.');
  expect(await cached()).toBe(true);
  await page.clock.runFor(4900);
  expect(await cached()).toBe(true);
  await page.clock.runFor(100);
  await expect(page.locator('.undo-toast')).toHaveCount(0);
  await expect.poll(cached).toBe(false);
  await page.clock.resume();
  await expect(page.locator('.save-state')).toHaveText('Changes synced');
  const state = (await (await request.get('/api/v1/state')).json()).snapshot.reading;
  expect(state.items.find((item: any) => item.id === itemId).articleHold).toBeUndefined();
});

for (const plugin of ['tasks', 'reading']) test(`${plugin} undo waits for a delayed save acknowledgement`, async ({ page, request }) => {
  const id = crypto.randomUUID(), headers = { 'x-herts-request': '1' };
  const reading = plugin === 'reading';
  await request.post(reading ? '/api/v1/reading/sync' : '/api/v1/sync', { headers, data: reading
    ? { id: crypto.randomUUID(), itemId: id, contextId: crypto.randomUUID(), kind: 'create', title: id, url: 'https://example.com/delayed-undo', at: Date.now() }
    : { id: crypto.randomUUID(), taskId: id, kind: 'create', title: id, at: Date.now() } });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let delayed = false;
  await page.route(`**/api/v1/plugins/${plugin}/commands`, async route => {
    if (delayed) return route.continue();
    delayed = true;
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  try {
    await page.goto(reading ? '/#/reading' : '/#/tasks/inbox');
    await page.getByRole('button', { name: reading ? `Mark read: ${id}` : `Complete ${id}`, exact: true }).click();
    const toast = page.locator('.undo-toast');
    await toast.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(toast).toContainText('Undoing');
    await expect(toast.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    release();
    await expect(toast).toHaveCount(0);
    await expect(page.getByRole('link', { name: id, exact: true })).toBeVisible();
    await expect.poll(async () => {
      const snapshot = (await (await request.get('/api/v1/state')).json()).snapshot;
      return reading ? snapshot.reading.items.find((item: any) => item.id === id).readAt : snapshot.tasks.find((item: any) => item.id === id).status;
    }).toBe(reading ? null : 'inbox');
  } finally { release(); }
});
