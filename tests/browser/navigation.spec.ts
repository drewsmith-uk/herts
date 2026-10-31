import { seedPendingDraftSettings } from './pending-sync-helpers';
import { openConnectionDetails } from './navigation-helpers';
import { test, expect } from '@playwright/test';

test.afterEach(async ({ request }) => {
  const { catalogue } = await (await request.get('/api/v1/plugins')).json();
  if (!catalogue.entries.find((entry: any) => entry.manifest.id === 'reading')?.enabled) {
    expect((await request.post('/api/v1/plugins/reading/manage', {
      headers: { 'x-herts-request': '1' }, data: { action: 'enable', revision: catalogue.revision },
    })).ok()).toBe(true);
  }
});

const status = (page: import('@playwright/test').Page) => page.locator('#connection-status-label');
test('device placement switches More to direct Settings and preserves offline drafts', async ({ page, context }) => {
  await page.setViewportSize({ width: 650, height: 844 });
  await page.goto('/#/settings/plugins');
  await expect(status(page)).toHaveText('Connection status: Connected and synced');
  const nav = page.locator('.mobile-nav');
  await expect(nav.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 280, height: 844 });
  await nav.getByRole('button', { name: 'More', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('link', { name: 'Reading', exact: true })).toHaveAttribute('href', '#/reading');
  await page.keyboard.press('Escape');
  await expect(nav.getByRole('button', { name: 'More', exact: true })).toBeFocused();
  await nav.getByRole('button', { name: 'More', exact: true }).click();
  await dialog.getByRole('link', { name: 'Reading', exact: true }).click();
  await expect(page).toHaveURL(/#\/reading$/);
  await expect(dialog).toHaveCount(0);
  await expect(nav.getByRole('button', { name: 'More', exact: true })).toHaveClass(/active/);
  await page.goto('/#/settings/plugins');
  await page.reload();
  await expect(page.locator('.tab-order-divider')).toHaveText('More');
  await page.getByLabel('Enable Reading', { exact: true }).click();
  await expect(page.getByLabel('Enable Reading', { exact: true })).not.toBeChecked();
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(nav.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByLabel('Enable Reading', { exact: true }).click();
  await expect(page.getByLabel('Enable Reading', { exact: true })).toBeChecked();
  await expect(nav.getByRole('button', { name: 'More', exact: true })).toBeVisible();
  await expect(page.locator('.tab-order-divider')).toHaveText('More');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await expect(status(page)).toHaveText('Connection status: Disconnected');
  await page.setViewportSize({ width: 650, height: 844 });
  await expect(nav.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
  await page.evaluate(() => { location.hash = '/new'; });
  const editor = page.getByLabel(/^(Message Hermes|Add a task)$/,  { exact: true });
  await editor.fill('Keep this local draft through connection checks and navigation changes.');
  await expect(page).toHaveURL(/#\/draft\//);
  const closeDetails = await openConnectionDetails(page);
  const details = page.getByRole('dialog', { name: 'Connection and sync', exact: true });
  await expect(details).toContainText('Server unavailable');
  await details.getByRole('button', { name: 'Check again', exact: true }).click();
  await closeDetails();
  await expect(editor).toHaveValue('Keep this local draft through connection checks and navigation changes.');
  await page.setViewportSize({ width: 390, height: 560 });
  await expect(nav.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 280, height: 560 });
  await expect(nav.getByRole('button', { name: 'More', exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'More', exact: true }).click();
  await page.setViewportSize({ width: 650, height: 560 });
  await expect(dialog).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Settings', exact: true })).toBeFocused();
  await context.setOffline(false);
  await expect(status(page)).toHaveText('Connection status: Connected and synced');
  await page.reload();
  await expect(editor).toHaveValue('Keep this local draft through connection checks and navigation changes.');
});

test('status distinguishes Hermes failure and recovers without sending model prompts', async ({ page, request }) => {
  const before = await (await request.get('http://127.0.0.1:8791/calls')).json();
  let unavailable = true;
  await page.route(/\/api\/v1\/(state|connection)$/, async route => {
    const response = await route.fetch(), data = await response.json();
    if (unavailable) data.gateway.online = false;
    await route.fulfill({ response, json: data });
  });
  await page.goto('/#/conversations');
  await expect(status(page)).toHaveText('Connection status: Hermes unavailable');
  await openConnectionDetails(page);
  await expect(page.getByRole('dialog', { name: 'Connection and sync', exact: true })).toContainText('Unavailable');
  unavailable = false;
  await page.getByRole('button', { name: 'Check again', exact: true }).click();
  await expect(status(page)).toHaveText('Connection status: Connected and synced');
  const after = await (await request.get('http://127.0.0.1:8791/calls')).json();
  expect(after.slice(before.length).filter((method: string) => ['session.create', 'session.resume', 'prompt.submit'].includes(method))).toEqual([]);
});

test('a failed order write keeps the saved choice and permits retry', async ({ page }) => {
  await page.goto('/#/settings/plugins');
  const rows = page.locator('.tab-order-row');
  await expect(rows).toHaveCount(3);
  const order = await rows.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-tab-id')));
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'herts-navigation-order') throw new Error('Storage unavailable');
      return original.call(this, key, value);
    };
    (window as any).restoreNavigationStorage = () => { Storage.prototype.setItem = original; };
  });
  await page.getByRole('button', {name: 'Move Reading up', exact: true}).click();
  await expect(page.getByText('Navigation preferences could not be saved. Try again.')).toBeVisible();
  expect(await rows.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-tab-id')))).toEqual(order);
  await page.evaluate(() => (window as any).restoreNavigationStorage());
  await page.getByRole('button', {name: 'Move Reading up', exact: true}).click();
  await expect(rows.nth(1)).toHaveAttribute('data-tab-id', 'reading');
  await page.reload();
  await expect(rows.nth(1)).toHaveAttribute('data-tab-id', 'reading');
});

test('keyboard dragging swaps overflow tabs and preserves offline order', async ({ page, context }) => {
  await page.setViewportSize({width: 320, height: 844});
  await page.goto('/#/settings/plugins');
  const rows = page.locator('.tab-order-row');
  await expect(rows).toHaveCount(3);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await expect(status(page)).toHaveText('Connection status: Disconnected');
  await page.evaluate(() => document.fonts.ready);
  const handle = page.getByRole('button', {name: 'Drag Reading', exact: true});
  await handle.scrollIntoViewIfNeeded();
  await handle.focus();
  await page.keyboard.press('Space');
  await expect(handle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[id^=DndLiveRegion]')).toContainText('over droppable area reading');
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('[id^=DndLiveRegion]')).toContainText(/over droppable area (conversations|__navigation_more__)/);
  await page.keyboard.press('Space');
  await expect(rows.nth(1)).toHaveAttribute('data-tab-id', 'reading');
  await expect(page.locator('.mobile-nav').getByRole('link', {name: 'Reading', exact: true})).toBeVisible();
  await page.locator('.mobile-nav').getByRole('button', {name: 'More', exact: true}).click();
  await expect(page.getByRole('dialog').getByRole('link', {name: 'Conversations', exact: true})).toBeVisible();
  await page.keyboard.press('Escape');
  await context.setOffline(false);
  await page.reload();
  await expect(rows.nth(1)).toHaveAttribute('data-tab-id', 'reading');
});

test.describe('synchronization requests', () => {
  test.use({ serviceWorkers: 'block' });

test('delayed synchronization retains edits until acknowledgement', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/settings/plugins');
  await expect(status(page)).toHaveText('Connection status: Connected and synced');
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let intercepted = false;
  await page.route('**/api/v1/plugins/tasks/commands', async route => {
    intercepted = true;
    await held;
    await route.continue();
  });
  try {
    const input = page.getByLabel('New space name', { exact: true });
    await input.fill('Navigation delayed acknowledgement');
    await page.getByRole('button', { name: 'Create space', exact: true }).click();
    await expect.poll(() => intercepted).toBe(true);
    await expect(status(page)).toHaveText('Connection status: Syncing changes');
    await expect(page.locator('.connection-badge:visible svg')).toHaveCSS('animation-name', 'none');
    const closeDetails = await openConnectionDetails(page);
    await expect(page.getByRole('dialog', { name: 'Connection and sync', exact: true })).toContainText('1 pending');
    await closeDetails();
    await expect(page.getByRole('textbox', { name: 'Name of Navigation delayed acknowledgement space', exact: true })).toBeVisible();
  } finally { release(); }
  await expect(status(page)).toHaveText('Connection status: Connected and synced');
});

test('initial checks, server failure, and retry keep connection details accurate', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let fail = true;
  await page.route(/\/api\/v1\/(state|connection)$/, async route => {
    await held;
    if (fail) await route.abort();
    else await route.continue();
  });
  await page.goto('/#/conversations');
  try {
    await expect(status(page)).toHaveText('Connection status: Checking connection');
  } finally { release(); }
  await expect(status(page)).toHaveText('Connection status: Disconnected');
  await openConnectionDetails(page);
  await expect(page.getByRole('dialog', { name: 'Connection and sync', exact: true })).toContainText('Server unavailable');
  await expect(page.getByRole('dialog', { name: 'Connection and sync', exact: true })).not.toContainText('missing record');
  fail = false;
  await page.getByRole('button', { name: 'Check again', exact: true }).click();
  await expect(status(page)).toHaveText('Connection status: Connected and synced');
});

test('a failed background sync retains connection status and permits retry', async ({ page }) => {
  let fail = true;
  await page.route('**/api/v1/state', route => fail ? route.abort() : route.continue());
  await page.goto('/#/conversations');
  await expect(status(page)).toHaveText('Connection status: Synchronization needs attention');
  await openConnectionDetails(page);
  const details = page.getByRole('dialog', { name: 'Connection and sync', exact: true });
  await expect(details).toContainText('Updates could not be loaded.');
  await expect(details.locator('dd').nth(0)).toHaveText('Connected');
  await expect(details.locator('dd').nth(1)).toHaveText('Connected');
  fail = false;
  await details.getByRole('button', { name: 'Check again', exact: true }).click();
  await expect(status(page)).toHaveText('Connection status: Connected and synced');
});

});


test('unconfirmed conversation actions do not change connection and sync status', async ({ page }) => {
  await page.route('**/api/v1/activity-sync*', async route => {
    const response = await route.fetch();
    const body = await response.json();
    const action = { id: 'historical-unknown', kind: 'send', receipt: 'unknown', state: 'unknown', phase: 'unconfirmed', createdAt: 1, updatedAt: 1 };
    body.changes.push({ summary: { contextId: 'existing', version: 1, main: action, latestSend: action, hasSubmission: true, recoveryCount: 1, pendingRecovery: false }, retired: [] });
    await route.fulfill({ response, json: body });
  });
  await page.goto('/#/conversations');
  await expect.poll(() => page.evaluate(() => (window as any).__HERTS_PLUGIN_RUNTIME__.sdk.getCore().activitySummaries.existing?.main?.receipt)).toBe('unknown');
  await expect(status(page)).toHaveText('Connection status: Connected and synced');
  await openConnectionDetails(page);
  const dialog = page.getByRole('dialog', { name: 'Connection and sync', exact: true });
  await expect(dialog.locator('dd')).toHaveText(['Connected', 'Connected', 'Up to date']);
  await expect(dialog.locator('p')).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: 'Check again', exact: true })).toBeVisible();
});


test('More and direct Settings carry live status and keep a single navigation target', async ({ page, context }) => {
  await page.setViewportSize({ width: 280, height: 844 });
  await page.addInitScript(() => localStorage.setItem('herts-navigation-more', JSON.stringify(['reading'])));
  await page.goto('/#/conversations');
  const nav = page.locator('.mobile-nav'), end = nav.locator('.navigation-end');
  await expect(end).toHaveAccessibleName('More');
  await expect(end).toHaveAccessibleDescription('Connection status: Connected and synced');
  await expect(end.locator('.connection-badge')).toHaveClass(/status-synced/);
  await expect(page.locator('.shell-status')).toHaveCount(0);
  await expect(end.locator('button,a')).toHaveCount(0);
  await context.setOffline(true);
  await expect(end).toHaveAccessibleDescription('Connection status: Disconnected');
  await expect(end.locator('.connection-badge.status-offline svg')).toBeVisible();
  await end.click();
  const more = page.getByRole('dialog', { name: 'More', exact: true });
  const row = more.getByRole('button', { name: 'Connection status: Disconnected', exact: true });
  await row.click();
  await expect(page.getByRole('dialog', { name: 'Connection and sync', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(row).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(end).toBeFocused();
  await context.setOffline(false);
  await expect(end).toHaveAccessibleDescription('Connection status: Connected and synced');
  await page.goto('/#/settings/plugins');
  await page.setViewportSize({ width: 650, height: 844 });
  await page.getByRole('button', {name: 'Move Reading up', exact: true}).click();
  await expect(end).toHaveAccessibleName('Settings');
  await expect(end).toHaveAttribute('href', '#/settings');
  await expect(end).toHaveAccessibleDescription('Connection status: Connected and synced');
  await end.click();
  await page.getByRole('button', { name: 'Connection status: Connected and synced', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Connection and sync', exact: true })).toBeVisible();
  await page.mouse.click(1, 1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Connection status: Connected and synced', exact: true })).toBeFocused();
});

test('touch dragging moves a tab across the More divider', async ({ page, context }) => {
  await page.setViewportSize({width: 280, height: 844});
  await page.goto('/#/settings/plugins');
  const handle = page.getByRole('button', {name: 'Drag Reading', exact: true});
  await handle.scrollIntoViewIfNeeded();
  const source = (await handle.boundingBox())!;
  const target = (await page.getByRole('button', {name: 'Drag Conversations', exact: true}).boundingBox())!;
  const cdp = await context.newCDPSession(page);
  const point = {x: source.x + source.width / 2, y: source.y + source.height / 2};
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [point]});
  await expect(handle).toHaveAttribute('aria-pressed', 'true');
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: point.x, y: target.y + target.height / 2}]});
  await expect(page.locator('[id^=DndLiveRegion]')).toContainText(/over droppable area (conversations|__navigation_more__)/);
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await expect(page.locator('.tab-order-row').nth(1)).toHaveAttribute('data-tab-id', 'reading');
});

test('plugin sections collapse without losing edits or changing enabled state', async ({ page }) => {
  await page.goto('/#/settings/plugins');
  await expect(page.locator('.plugin-settings-groups > .settings-section').first()).toHaveClass(/tab-order/);
  const tabOrder = page.getByRole('button', {name: 'Tab order', exact: true});
  await tabOrder.click();
  await expect(page.getByRole('button', {name: 'Drag Reading', exact: true})).toBeHidden();
  await tabOrder.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', {name: 'Drag Reading', exact: true})).toBeVisible();
  const input = page.getByLabel('New space name', {exact: true});
  await input.fill('Keep this unfinished edit');
  const tasks = page.getByRole('button', {name: /^Tasks /});
  await tasks.click();
  await expect(input).toBeHidden();
  await expect(page.getByLabel('Enable Tasks', {exact: true})).toBeChecked();
  await tasks.click();
  await expect(input).toHaveValue('Keep this unfinished edit');
});

test('tabs can enter an empty More section even when all tabs fit', async ({ page, context }) => {
  await page.setViewportSize({width: 650, height: 844});
  await page.goto('/#/settings/plugins');
  const nav = page.locator('.mobile-nav');
  await expect(nav.getByRole('link', {name: 'Settings', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Move Reading down', exact: true}).click();
  await expect(nav.getByRole('button', {name: 'More', exact: true})).toBeVisible();
  await page.reload();
  await expect(nav.getByRole('button', {name: 'More', exact: true})).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', {name: 'Move Reading up', exact: true}).click();
  await expect(nav.getByRole('link', {name: 'Settings', exact: true})).toBeVisible();
  await context.setOffline(false);
  const handle = page.getByRole('button', {name: 'Drag Reading', exact: true});
  await handle.scrollIntoViewIfNeeded();
  const source = (await handle.boundingBox())!;
  const target = (await page.locator('.tab-order-divider').boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await expect(handle).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {steps: 8});
  await expect(page.locator('[id^=DndLiveRegion]')).toContainText('over droppable area __navigation_more__');
  await page.mouse.up();
  await expect(nav.getByRole('button', {name: 'More', exact: true})).toBeVisible();
});

test('background reads keep draft settings saved without claiming to send them', async ({ page, context }) => {
  await page.goto('/#/settings');
  await expect(status(page)).toHaveText('Connection status: Connected and synced');
  const pending = await seedPendingDraftSettings(page);
  let writes = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes(`/contexts/${pending.id}/settings`)) writes++; });
  let release!: () => void, started = false;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/state*', async route => { started = true; await held; await route.continue(); });
  try {
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(() => started).toBe(true);
    await expect(status(page)).toHaveText('Connection status: Connected and synced');
    const close = await openConnectionDetails(page);
    const dialog = page.getByRole('dialog', { name: 'Connection and sync', exact: true });
    await expect(dialog).toContainText('Saved with draft');
    await close();
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
  await page.reload();
  await openConnectionDetails(page);
  const dialog = page.getByRole('dialog', { name: 'Connection and sync', exact: true });
  await expect(dialog).toContainText('Up to date');
  await expect(dialog).toContainText('Saved with draft');
  await context.setOffline(true);
  await expect(dialog).toContainText('Disconnected');
  await expect(dialog).toContainText('Saved with draft');
  const saved = await page.evaluate(async id => {
    const db = (window as any).__HERTS_PLUGIN_RUNTIME__.sdk.conversationDrafts.db;
    return { settings: (await db.table('kv').get(`settings-op:${id}`)).value, draft: await db.table('drafts').get(id) };
  }, pending.id);
  expect(saved.settings.input.id).toBe(pending.operationId);
  expect(saved.draft.text).toBe('Preserve this unsent draft.');
  expect(writes).toBe(0);
});

test('a recovered state read clears its warning while retaining saved draft choices', async ({ page }) => {
  await page.goto('/#/settings');
  await expect(status(page)).toHaveText('Connection status: Connected and synced');
  const pending = await seedPendingDraftSettings(page);
  let fail = true;
  await page.route('**/api/v1/state*', route => fail ? route.abort() : route.continue());
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await openConnectionDetails(page);
  const dialog = page.getByRole('dialog', { name: 'Connection and sync', exact: true });
  await expect(dialog).toContainText('Updates could not be loaded.');
  await expect(dialog.locator('dd').nth(2)).toHaveText('Needs attention');
  fail = false;
  await dialog.getByRole('button', { name: 'Check again', exact: true }).click();
  await expect(dialog).not.toContainText('Updates could not be loaded.');
  await expect(dialog).toContainText('Connected and synced');
  await expect(dialog.locator('dd').nth(2)).toHaveText('Up to date');
  await expect(dialog).toContainText('Saved with draft');
  const saved = await page.evaluate(async id => (await (window as any).__HERTS_PLUGIN_RUNTIME__.sdk.conversationDrafts.db.table('kv').get(`settings-op:${id}`)).value, pending.id);
  expect(saved.input.id).toBe(pending.operationId);
  expect(saved.input.values).toEqual({ effort: 'high' });
});

test('a failed state read retries promptly while an open conversation keeps its draft', async ({ page }) => {
  await page.goto('/#/conversation/existing');
  const editor = page.getByRole('textbox', { name: 'Message Hermes', exact: true });
  await editor.fill('Keep this unsent message during automatic recovery.');
  await expect(status(page)).toHaveText('Connection status: Connected and synced');
  let fail = true, failedReads = 0, successfulReads = 0, sends = 0;
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/actions') sends++; });
  await page.route('**/api/v1/state*', async route => {
    if (fail) { failedReads++; await route.abort(); }
    else { successfulReads++; await route.continue(); }
  });
  await page.evaluate(() => (window as any).__HERTS_PLUGIN_RUNTIME__.sdk.refresh());
  await expect.poll(() => failedReads).toBeGreaterThan(0);
  await expect(status(page)).toHaveText('Connection status: Synchronization needs attention');
  fail = false;
  await expect(status(page)).toHaveText('Connection status: Connected and synced', { timeout: 5000 });
  expect(successfulReads).toBeGreaterThan(0);
  await expect(editor).toHaveValue('Keep this unsent message during automatic recovery.');
  expect(sends).toBe(0);
  await page.unrouteAll({ behavior: 'wait' });
});

test('resolving a conflict clears its warning while draft choices remain saved', async ({ page }) => {
  await page.goto('/#/settings/plugins');
  await expect(status(page)).toHaveText('Connection status: Connected and synced');
  const draft = await seedPendingDraftSettings(page);
  await page.route('**/api/v1/plugins/tasks/commands', route => route.fulfill({ status: 409, json: { error: 'Review this saved space.' } }));
  await page.getByLabel('New space name', { exact: true }).fill('Conflict recovery');
  await page.getByRole('button', { name: 'Create space', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__HERTS_PLUGIN_RUNTIME__.sdk.getCore().pluginPending[0]?.conflict)).toBe('Review this saved space.');
  await page.evaluate(() => (window as any).__HERTS_PLUGIN_RUNTIME__.sdk.rebuild());
  await expect(status(page)).toHaveText('Connection status: Synchronization needs attention');
  await page.evaluate(async () => {
    const sdk = (window as any).__HERTS_PLUGIN_RUNTIME__.sdk;
    await sdk.resolvePluginOperation(sdk.getCore().pluginPending[0].id);
    await sdk.sync();
  });
  await expect(status(page)).toHaveText('Connection status: Connected and synced');
  const saved = await page.evaluate(async id => {
    const db = (window as any).__HERTS_PLUGIN_RUNTIME__.sdk.conversationDrafts.db;
    return { settings: (await db.kv.get(`settings-op:${id}`)).value, draft: await db.drafts.get(id) };
  }, draft.id);
  expect(saved.settings.input.id).toBe(draft.operationId);
  expect(saved.draft.text).toBe('Preserve this unsent draft.');
});
