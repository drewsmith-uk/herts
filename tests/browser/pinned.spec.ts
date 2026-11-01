import { openSettingsGroups } from './composer-helpers';
import { pageAction, closePageActions } from './composer-helpers';
import { test, expect, type Response } from '@playwright/test';
import { saveTitle, detailsField } from './composer-helpers';
import { pinnedPlugin, pinnedReady, seedPin, savedPins, notices, dismissPins } from './pinned-helpers';

test.beforeEach(async ({ request, context }) => { await pinnedPlugin(request, 'enable'); await context.grantPermissions(['notifications']); });
test.afterEach(async ({ request }) => { await pinnedPlugin(request, 'disable'); });

for (const recovery of ['timer', 'focus', 'visibility'] as const) test(`recovers notification readiness through ${recovery} without leaving the conversation`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: recovery === 'focus' ? 1280 : 390, height: 844 });
  await pinnedReady(page);
  await page.addInitScript(() => {
    const original = ServiceWorker.prototype.postMessage;
    (window as any).notificationCommands = [];
    (window as any).holdNotificationChecks = true;
    ServiceWorker.prototype.postMessage = function(data: any, transfer: any) {
      if (data?.type === 'PLUGIN_NOTIFICATIONS') {
        (window as any).notificationCommands.push(data.command);
        if (data.command === 'check' && (window as any).holdNotificationChecks) return;
      }
      return original.call(this, data, transfer);
    };
  });
  await page.goto('/#/conversation/existing');
  await page.reload();
  const draft = page.getByRole('textbox', { name: /^Message / });
  await draft.fill('Keep this draft through notification recovery.');
  const pin = await pageAction(page, 'button', 'Pin notification');
  await expect(pin).toBeDisabled();
  await expect(page.getByRole('link', { name: /Open Pinned:.*not confirmed/ })).toBeVisible();
  await page.evaluate(recovery => {
    (window as any).holdNotificationChecks = false;
    if (recovery === 'focus') {
      for (let i = 0; i < 5; i++) window.dispatchEvent(new Event('focus'));
    }
    if (recovery === 'visibility') document.dispatchEvent(new Event('visibilitychange'));
  }, recovery);
  await expect(pin).toBeEnabled();
  await expect(page.getByRole('link', { name: /^Open Pinned:/ })).toHaveCount(0);
  await expect(draft).toHaveValue('Keep this draft through notification recovery.');
  await expect(page).toHaveURL(/#\/conversation\/existing$/);
  const commands = await page.evaluate(() => (window as any).notificationCommands as string[]);
  expect(commands.filter(command => command === 'check')).toHaveLength(2);
  expect(commands.filter(command => ['set', 'remove', 'retry'].includes(command))).toEqual([]);
  expect(await savedPins(page)).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath('recovered-pin.png') });
});

test('pins from a conversation, survives offline dismissal, and preserves an unsent draft', async ({ page, context, request }) => {
  await pinnedReady(page); await page.goto('/#/conversation/existing');
  const draft = page.getByRole('textbox', { name: /^Message / });
  await expect(draft).toBeVisible(); await draft.fill('Keep these synthetic notes until I send them.');
  await expect(await pageAction(page, 'button', 'Pin notification')).toBeEnabled();
  await (await pageAction(page, 'button', 'Pin notification')).click();
  await expect(await pageAction(page, 'button', 'Unpin notification')).toBeEnabled();
  expect(await savedPins(page)).toHaveLength(1); expect(await notices(page)).toHaveLength(1);
  const before = await (await request.get('http://127.0.0.1:8791/calls')).json();
  await context.setOffline(true);
  try {
    await dismissPins(page); await dismissPins(page); expect(await notices(page)).toHaveLength(1);
    await page.goto('/#/plugins/pinned'); await expect(page.locator('.pinned-list .item-title')).toHaveText('Plan the autumn trip');
    await page.reload(); await expect(page.locator('.pinned-list .item-title')).toHaveText('Plan the autumn trip');
    await page.locator('.pinned-list a').click(); await expect(draft).toHaveValue('Keep these synthetic notes until I send them.');
    await (await pageAction(page, 'button', 'Unpin notification')).click();
    await expect(await pageAction(page, 'button', 'Pin notification')).toBeEnabled();
    expect(await savedPins(page)).toHaveLength(0); expect(await notices(page)).toHaveLength(0);
  } finally { await context.setOffline(false); }
  const calls = await (await request.get('http://127.0.0.1:8791/calls')).json();
  expect(calls.filter((m: string) => ['prompt.submit', 'session.create', 'session.resume'].includes(m))).toEqual(before.filter((m: string) => ['prompt.submit', 'session.create', 'session.resume'].includes(m)));
});

test('retains pins through disable and re-enable, but reset fences old handles', async ({ page, request }) => {
  await pinnedReady(page); await seedPin(page);
  await page.evaluate(() => { (globalThis as any).oldPinService = (globalThis as any).__HERTS_PLUGIN_RUNTIME__.sdk.pluginNotifications('pinned'); });
  await pinnedPlugin(request, 'disable'); await page.evaluate(() => (globalThis as any).__HERTS_PLUGIN_RUNTIME__.sdk.refresh());
  await expect(page.getByRole('heading', { name: 'Plugin unavailable' })).toBeVisible();
  await expect.poll(() => notices(page)).toHaveLength(0);
  await pinnedPlugin(request, 'enable'); await page.evaluate(() => (globalThis as any).__HERTS_PLUGIN_RUNTIME__.sdk.refresh());
  await expect(page.locator('.pinned-list .item-title')).toHaveText('Synthetic pinned conversation'); await expect.poll(() => notices(page)).toHaveLength(1);
  await pinnedPlugin(request, 'reset'); await page.evaluate(() => (globalThis as any).__HERTS_PLUGIN_RUNTIME__.sdk.refresh());
  await expect(page.getByRole('heading', { name: 'No pinned notifications' })).toBeVisible(); await expect.poll(() => notices(page)).toHaveLength(0);
  expect(await page.evaluate(async () => { try { await (globalThis as any).oldPinService.remove('old'); return ''; } catch (error) { return (error as Error).message; } })).toContain('plugin changed');
});

test('keeps blocked pins, supports search, and recovers notification display', async ({ page, context }) => {
  await context.clearPermissions(); await pinnedReady(page); const record = await seedPin(page);
  await expect(page.locator('.pinned-list')).toContainText('Allow notifications');
  expect(await savedPins(page)).toHaveLength(1);
  await page.getByRole('searchbox', { name: 'Search pinned notifications' }).fill('unmatched');
  await expect(page.getByRole('heading', { name: 'No pins match this search' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search pinned notifications' }).click();
  await context.grantPermissions(['notifications']);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(async () => (await notices(page)).map(notice => notice.data.key)).toEqual([record.key]);
  await expect(page.locator('.pinned-list').getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  expect(await savedPins(page)).toMatchObject([{ key: record.key }]);
  await page.locator('.pinned-list').getByRole('button', { name: /^Unpin:/ }).click();
  await expect(page.getByRole('heading', { name: 'No pinned notifications' })).toBeVisible();
  await expect(page.getByRole('searchbox')).toBeFocused();
});

test('pins task titles and retains them after completion', async ({ page, request }) => {
  const id = crypto.randomUUID(), title = 'Synthetic task notification';
  expect((await request.post('/api/v1/sync', { headers: { 'x-herts-request': '1' }, data: { id: crypto.randomUUID(), taskId: id, kind: 'create', title, at: Date.now() } })).ok()).toBe(true);
  await pinnedReady(page); await page.goto(`/#/task/${id}`);
  await (await pageAction(page, 'button', 'Pin notification')).click();
  await expect(await pageAction(page, 'button', 'Unpin notification')).toBeEnabled();
  const field = await detailsField(page, 'Task title'); await field.fill('Edited synthetic task notification'); await saveTitle(page);
  await expect.poll(async () => (await savedPins(page))[0]?.title).toBe('Edited synthetic task notification');
  await (await pageAction(page, 'button', 'Complete task')).click();
  await page.goto('/#/plugins/pinned'); await expect(page.locator('.pinned-list a')).toHaveAttribute('href', `#/task/${id}`);
  expect(await savedPins(page)).toHaveLength(1);
});

test('updates task titles while Pinned is open and recognises the same conversation elsewhere', async ({ page, request }) => {
  const id = crypto.randomUUID();
  const change = async (kind: string, title: string, baseTitle?: string) => expect((await request.post('/api/v1/sync', { headers: { 'x-herts-request': '1' }, data: { id: crypto.randomUUID(), taskId: id, kind, title, ...(baseTitle ? { baseTitle } : {}), at: Date.now() } })).ok()).toBe(true);
  await change('create', 'Initial synthetic title'); await pinnedReady(page); await page.goto(`/#/task/${id}`);
  await (await pageAction(page, 'button', 'Pin notification')).click();
  await expect(await pageAction(page, 'button', 'Unpin notification')).toBeEnabled();
  await page.goto(`/#/draft/${id}`); await expect(await pageAction(page, 'button', 'Unpin notification')).toBeEnabled();
  expect(await savedPins(page)).toHaveLength(1);
  await page.goto('/#/plugins/pinned'); await change('title', 'Updated from another synthetic client', 'Initial synthetic title');
  await page.evaluate(() => (globalThis as any).__HERTS_PLUGIN_RUNTIME__.sdk.refresh());
  await expect(page.locator('.pinned-list .item-title')).toHaveText('Updated from another synthetic client');
  await expect.poll(async () => (await notices(page))[0]?.title).toBe('Updated from another synthetic client');
});

test('a delayed display cannot restore a pin after unpinning from another tab', async ({ page, context }) => {
  await pinnedReady(page); await page.goto('/#/conversation/existing');
  await expect(await pageAction(page, 'button', 'Pin notification')).toBeEnabled();
  const worker = context.serviceWorkers().find(worker => worker.url().endsWith('/sw.js'))!;
  await worker.evaluate(() => {
    const scope = self as any, original = scope.registration.showNotification.bind(scope.registration);
    scope.registration.showNotification = async (...args: unknown[]) => {
      scope.displayStarted = true;
      await new Promise<void>(resolve => { scope.releaseDisplay = resolve; });
      scope.registration.showNotification = original;
      return original(...args);
    };
  });
  await (await pageAction(page, 'button', 'Pin notification')).click();
  await expect.poll(() => worker.evaluate(() => !!(self as any).displayStarted)).toBe(true);
  await closePageActions(page);
  const draft = page.getByRole('textbox', { name: /^Message / }); await draft.fill('Draft written during notification acknowledgement.');
  const second = await context.newPage();
  try {
    await second.goto('/#/plugins/pinned'); await expect(second.locator('.pinned-list .item-row')).toHaveCount(1);
    await second.locator('.pinned-list').getByRole('button', { name: /^Unpin:/ }).click();
    await worker.evaluate(() => (self as any).releaseDisplay());
    await expect(second.getByRole('heading', { name: 'No pinned notifications' })).toBeVisible();
    await expect(await pageAction(page, 'button', 'Pin notification')).toBeEnabled();
    expect(await notices(page)).toHaveLength(0); expect(await savedPins(page)).toHaveLength(0);
    await expect(draft).toHaveValue('Draft written during notification acknowledgement.');
  } finally { await worker.evaluate(() => (self as any).releaseDisplay?.()); await second.close(); }
});

test('a lost acknowledgement leaves one saved pin and never submits another notification operation', async ({ page, context }) => {
  await pinnedReady(page); await page.goto('/#/conversation/existing');
  await expect(page.locator('.conversation-compact-title')).toHaveText('Plan the autumn trip');
  await expect(await pageAction(page, 'button', 'Pin notification')).toBeEnabled();
  const worker = context.serviceWorkers().find(worker => worker.url().endsWith('/sw.js'))!;
  await worker.evaluate(() => {
    (self as any).pinWrites = 0;
    self.addEventListener('message', ((event: MessageEvent) => {
      if (event.data?.type === 'PLUGIN_NOTIFICATIONS' && event.data.command === 'set') {
        (self as any).pinWrites++;
        event.ports[0].postMessage = () => {};
      }
    }) as EventListener);
  });
  await (await pageAction(page, 'button', 'Pin notification')).click();
  await expect(await pageAction(page, 'button', 'Unpin notification')).toBeEnabled({ timeout: 20_000 });
  await expect(page.getByRole('link', { name: /Open Pinned: The notification operation was not confirmed/ })).toBeVisible();
  await page.reload(); await expect(await pageAction(page, 'button', 'Unpin notification')).toBeEnabled();
  expect(await savedPins(page)).toHaveLength(1); expect(await worker.evaluate(() => (self as any).pinWrites)).toBe(1);
});

test('an older host keeps plugin settings and app updates reachable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, '__HERTS_PLUGIN_RUNTIME__', { configurable: true, set(runtime) {
      Object.defineProperty(globalThis, '__HERTS_PLUGIN_RUNTIME__', { configurable: true, writable: true, value: { ...runtime, sdk: { ...runtime.sdk, pluginNotifications: undefined } } });
    } });
  });
  await page.goto('/#/plugins/pinned');
  await expect(page.getByText('Update Herts through Settings → App updates to use Pinned.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await openSettingsGroups(page);
  await expect(page.getByRole('button', { name: 'Check for updates', exact: true })).toBeVisible();
});

test('a failed local read reports failure and recovers without claiming that pins are missing', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, '__HERTS_PLUGIN_RUNTIME__', { configurable: true, set(runtime) {
      const original = runtime.sdk.pluginNotifications;
      const service = (id: string) => {
        const handle = original(id);
        return { ...handle, list() { (globalThis as any).failPinRead = false; return handle.list(); }, watch(next: Function, error: Function) {
          return handle.watch((rows: unknown[]) => {
            if ((globalThis as any).failPinRead !== false) error(new Error('Synthetic local storage read failure'));
            else next(rows);
          }, error);
        } };
      };
      Object.defineProperty(globalThis, '__HERTS_PLUGIN_RUNTIME__', { configurable: true, writable: true, value: { ...runtime, sdk: { ...runtime.sdk, pluginNotifications: service } } });
    } });
  });
  await page.goto('/#/plugins/pinned');
  await expect(page.getByRole('alert')).toContainText('Synthetic local storage read failure');
  await expect(page.getByRole('heading', { name: 'No pinned notifications' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Check again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No pinned notifications' })).toBeVisible();
});

test('an obsolete local read cannot replace a newer saved pin', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, '__HERTS_PLUGIN_RUNTIME__', { configurable: true, set(runtime) {
      const original = runtime.sdk.pluginNotifications;
      const service = (id: string) => {
        const handle = original(id);
        return { ...handle, async list() {
          const rows = await handle.list();
          if (!(globalThis as any).pinReadHeld) {
            (globalThis as any).pinReadHeld = true;
            await new Promise<void>(resolve => { (globalThis as any).releasePinRead = resolve; });
          }
          return rows;
        } };
      };
      Object.defineProperty(globalThis, '__HERTS_PLUGIN_RUNTIME__', { configurable: true, writable: true, value: { ...runtime, sdk: { ...runtime.sdk, pluginNotifications: service } } });
    } });
  });
  await pinnedReady(page);
  await expect.poll(() => page.evaluate(() => !!(globalThis as any).pinReadHeld)).toBe(true);
  await seedPin(page, 'Newer synthetic pin');
  await expect(page.locator('.pinned-list .item-title')).toHaveText('Newer synthetic pin');
  await page.evaluate(() => (globalThis as any).releasePinRead());
  await expect(page.locator('.pinned-list .item-title')).toHaveText('Newer synthetic pin');
});

test('restores saved notifications after the worker restarts', async ({ page, context }) => {
  const workerResponses: Response[] = [];
  context.on('response', response => { if (response.request().serviceWorker()) workerResponses.push(response); });
  await pinnedReady(page); await seedPin(page, 'Survives a worker restart');
  await page.evaluate(async () => { for (const notification of await (await navigator.serviceWorker.ready).getNotifications()) notification.close(); });
  // Chromium can crash when tracing reads a response body after its worker stops.
  // Finish these reads first: https://github.com/microsoft/playwright/issues/43374.
  expect(workerResponses.length).toBeGreaterThan(0);
  for (const response of workerResponses) await response.body();
  const cdp = await context.newCDPSession(page);
  let workerStopped = false;
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
    if (versions.some(version => version.scriptURL === new URL('/sw.js', page.url()).href && version.runningStatus === 'stopped')) workerStopped = true;
  });
  await cdp.send('ServiceWorker.enable'); await cdp.send('ServiceWorker.stopAllWorkers');
  await expect.poll(() => workerStopped).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(async () => (await notices(page)).map(n => n.title)).toEqual(['Survives a worker restart']);
  expect(await savedPins(page)).toHaveLength(1);
  await cdp.detach();
});

test('updates existing notification text without losing the pin', async ({ page }) => {
  await pinnedReady(page);
  const pin = await seedPin(page, 'Synthetic pinned conversation', crypto.randomUUID(), 'Pinned in Herts. Unpin inside the app.');
  await expect.poll(async () => (await notices(page))[0]?.body).toBe('Pinned');
  const rows = await savedPins(page);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ key: pin.key, title: pin.title, route: pin.route, metadata: pin.metadata, body: 'Pinned' });
});

test('only pins a new conversation after its draft is saved', async ({ page, context }) => {
  await pinnedReady(page);
  await page.goto('/#/new');
  const draft = page.getByRole('textbox', { name: /^Message / });
  const pin = page.getByRole('button', { name: 'Pin notification', exact: true });
  await expect(draft).toBeVisible();
  await expect(await pageAction(page, 'button', 'Pin notification')).toBeDisabled();
  await closePageActions(page);
  expect(await savedPins(page)).toHaveLength(0);
  await page.goto('/#/conversations');
  await page.goto('/#/new');
  await expect(draft).toBeVisible();
  await expect(await pageAction(page, 'button', 'Pin notification')).toBeDisabled();
  await closePageActions(page);
  await draft.fill('Keep this synthetic draft available from its notification.');
  await expect(page).toHaveURL(/#\/draft\//);
  await expect(await pageAction(page, 'button', 'Pin notification')).toBeEnabled();
  await pin.click();
  await expect(await pageAction(page, 'button', 'Unpin notification')).toBeEnabled();
  const rows = await savedPins(page);
  expect(rows).toHaveLength(1);
  expect(rows[0].route).toBe(new URL(page.url()).hash.slice(1));
  await context.setOffline(true);
  try {
    await page.goto('/#/plugins/pinned');
    await page.locator('.pinned-list a').click();
    await page.reload();
    await expect(draft).toHaveValue('Keep this synthetic draft available from its notification.');
    await expect(page.getByRole('heading', { name: 'Draft unavailable' })).toHaveCount(0);
  } finally { await context.setOffline(false); }
});


test('startup automatically redisplays saved pins offline despite stale browser display state', async ({ page, context }) => {
  await pinnedReady(page); await seedPin(page, 'Automatically restore this pin');
  const saved = await savedPins(page);
  const tag = () => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications())[0]?.tag);
  const previous = await tag();
  await context.setOffline(true);
  try {
    await page.reload();
    await expect.poll(tag).not.toBe(previous);
    await expect.poll(() => notices(page)).toHaveLength(1);
    expect(await savedPins(page)).toEqual(saved);
    for (let attempt = 0; attempt < 10; attempt++) {
      const restored = await tag();
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect.poll(async () => {
        const current = await tag();
        return !!current && current !== restored;
      }).toBe(true);
      await expect.poll(() => notices(page)).toHaveLength(1);
      expect(await savedPins(page)).toEqual(saved);
    }
  } finally { await context.setOffline(false); }
});

test('startup retries notification restoration after an unanswered worker request', async ({ page, context }) => {
  await pinnedReady(page); await seedPin(page, 'Restore after a startup failure');
  const saved = await savedPins(page);
  const previous = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications())[0]?.tag);
  await page.addInitScript(() => {
    const send = ServiceWorker.prototype.postMessage;
    let dropped = false;
    ServiceWorker.prototype.postMessage = function (message: any, ...args: any[]) {
      if (!dropped && message?.type === 'PLUGIN_NOTIFICATIONS' && message.command === 'reconcile') {
        dropped = true; return;
      }
      return Reflect.apply(send, this, [message, ...args]);
    };
  });
  await context.setOffline(true);
  try {
    await page.reload();
    await expect.poll(() => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications())[0]?.tag), { timeout: 20_000 }).not.toBe(previous);
    await expect.poll(() => notices(page)).toHaveLength(1);
    expect(await savedPins(page)).toEqual(saved);
  } finally { await context.setOffline(false); }
});
