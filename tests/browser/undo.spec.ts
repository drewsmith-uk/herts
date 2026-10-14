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
  await page.clock.install();
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
  await expect.poll(() => rows.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-task-id')))).toEqual(before);
  await expect(page.locator('.save-state')).toHaveText('Changes synced');
  const until = Date.now() + 3600000;
  expect((await request.post('/api/v1/sync', { headers, data: { id: crypto.randomUUID(), taskId: ids[1], spaceId, baseSpaceId: spaceId, kind: 'snooze', baseStatus: 'inbox', baseSnoozeId: null, snoozedUntil: until, at: Date.now() } })).ok()).toBe(true);
  await page.goto(`/#/spaces/${spaceId}/snoozed`);
  await page.getByRole('button', { name: `Complete ${ids[1]}`, exact: true }).click();
  await page.locator('.undo-toast').getByRole('button', { name: 'Undo', exact: true }).click();
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
