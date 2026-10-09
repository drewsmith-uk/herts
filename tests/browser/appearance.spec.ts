import { detailsField, detailsControl } from './composer-helpers';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { builtinThemes, themeStorageKey } from '../../shared/themes';
import { themeApiVersion } from '../../shared/themeValues';

const custom = { schemaVersion: 1, id: 'woodland', name: 'Woodland', extends: 'fieldwork', colors: { background: '#EEF1E9' }, typography: { headingFont: 'Georgia, serif' } };
const file = (request: APIRequestContext, content: string | null) => request.post('/__test/theme-file', { headers: { 'x-herts-request': '1' }, data: { content } });
test.afterEach(async ({ request }) => { await file(request, null); });

test('Press is the default and every theme preserves desktop and mobile task controls', async ({ page, request }) => {
  await request.post('/api/v1/sync', { headers: { 'x-herts-request': '1' }, data: { id: crypto.randomUUID(), taskId: crypto.randomUUID(), kind: 'create', title: 'Check theme controls', at: Date.now() } });
  await page.goto('/#/settings');
  await expect(page.getByLabel('Theme on this device', { exact: true })).toHaveValue('press');
  for (const theme of builtinThemes) {
    await page.getByLabel('Theme on this device', { exact: true }).selectOption(theme.id);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id);
    expect(await page.locator('html').evaluate(element => getComputedStyle(element).colorScheme)).toBe(theme.mode);
    await page.goto('/#/tasks/inbox');
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole('textbox', { name: 'Message Hermes', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Edit list', exact: true })).toBeVisible();
      await expect(page.locator('.mobile-lists a')).toHaveCount(6);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator('.composer').evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
      await page.screenshot({ path: `test-results/theme-${theme.id}-${width}.png`, fullPage: true });
    }
    await page.goto('/#/settings');
  }
});

test('themes persist across reload and tabs but a separate device starts with Press', async ({ page, context, browser }) => {
  await page.goto('/#/settings');
  const other = await context.newPage();await other.goto('/#/settings');
  await page.getByLabel('Theme on this device', { exact: true }).selectOption('nocturne');
  await expect(other.getByLabel('Theme on this device', { exact: true })).toHaveValue('nocturne');
  await page.reload();
  await expect(page.getByLabel('Theme on this device', { exact: true })).toHaveValue('nocturne');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#191C22');
  const fresh = await browser.newContext();
  try {
    const freshPage = await fresh.newPage();await freshPage.goto('http://127.0.0.1:8790/#/settings');
    await expect(freshPage.getByLabel('Theme on this device', { exact: true })).toHaveValue('press');
  } finally { await fresh.close(); }
});

test('discovers custom configs without rebuilding and restores them offline', async ({ page, context, request }) => {
  await page.goto('/#/settings');
  await file(request, JSON.stringify(custom));
  await page.getByRole('button', { name: 'Refresh themes', exact: true }).click();
  await expect(page.getByLabel('Theme on this device', { exact: true }).locator('option[value="woodland"]')).toHaveCount(1);
  await page.getByLabel('Theme on this device', { exact: true }).selectOption('woodland');
  await expect(page.locator('h1')).toHaveCSS('font-family', 'Georgia, serif');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(page.getByLabel('Theme on this device', { exact: true })).toHaveValue('woodland');
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByLabel('Theme on this device', { exact: true })).toHaveValue('woodland');
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(238, 241, 233)');
  // Some Chromium versions report navigator.onLine=true after an offline reload.
  // Both network messages must preserve cached themes and offer recovery.
  await expect(page.locator('.appearance-settings [role="status"]')).toContainText('The themes listed here still work.');
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  await page.getByLabel('Theme on this device', { exact: true }).selectOption('nocturne');
  await page.reload();
  await expect(page.getByLabel('Theme on this device', { exact: true })).toHaveValue('nocturne');
  await context.setOffline(false);
  await page.locator('.theme-refresh').click();
  await expect(page.getByRole('button', { name: 'Refresh themes', exact: true })).toBeVisible();
  await expect(page.locator('.appearance-settings [role="status"]')).toHaveCount(0);
});

test('offline and online browser events explain the connection state and refresh automatically', async ({ page, context }) => {
  await page.goto('/#/settings');
  await expect(page.getByRole('button', { name: 'Refresh themes', exact: true })).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText('You are offline. Custom themes will refresh automatically when you reconnect.', { exact: false })).toBeVisible();
  await page.getByLabel('Theme on this device', { exact: true }).selectOption('studio');
  await context.setOffline(false);
  await expect(page.getByRole('button', { name: 'Refresh themes', exact: true })).toBeVisible();
  await expect(page.locator('.appearance-settings [role="status"]')).toHaveCount(0);
  await expect(page.getByLabel('Theme on this device', { exact: true })).toHaveValue('studio');
});

test('an older server explains the missing theme support and retry recovers without losing the selection', async ({ page, request }) => {
  let available = false;
  const catalogue = await (await request.get('/api/v1/themes', { headers: { 'x-herts-theme-api': themeApiVersion } })).json();
  await page.route('**/api/v1/themes', route => route.fulfill(available
    ? { json: catalogue }
    : { status: 404, json: { error: 'Not found' } }));
  await page.goto('/#/settings');
  const warning = page.getByText('This Herts server does not provide a theme list yet.', { exact: false });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('Restart the Herts app service to load the update, then try again.');
  await expect(warning).toContainText('The themes listed here still work.');
  await expect(page.getByLabel('Theme on this device', { exact: true }).locator('option')).toHaveCount(builtinThemes.length);
  await page.getByLabel('Theme on this device', { exact: true }).selectOption('nocturne');
  await expect(warning).toBeVisible();
  available = true;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(warning).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Refresh themes', exact: true })).toBeVisible();
  await expect(page.getByLabel('Theme on this device', { exact: true })).toHaveValue('nocturne');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'nocturne');
});

test('theme failures distinguish access, server, invalid response and network problems', async ({ page }) => {
  let failure: 'access' | 'server' | 'html' | 'invalid' | 'network' = 'access';
  await page.route('**/api/v1/themes', route => {
    switch (failure) {
      case 'access': return route.fulfill({ status: 403, json: { error: 'Forbidden' } });
      case 'server': return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
      case 'html': return route.fulfill({ contentType: 'text/html', body: '<html>Old app shell</html>' });
      case 'invalid': return route.fulfill({ json: null });
      case 'network': return route.abort('failed');
    }
  });
  await page.goto('/#/settings');
  const card = page.locator('.appearance-settings');
  await expect(card.getByRole('status')).toContainText('Open Herts using its usual Tailscale address, then try again.');
  for (const [next, message] of [
    ['server', 'Herts could not load custom themes. Try again in a moment.'],
    ['html', 'Herts returned an unreadable theme list.'],
    ['invalid', 'Herts returned an unreadable theme list.'],
    ['network', 'Could not reach Herts to refresh custom themes. Check your connection to Herts, then try again.'],
  ] as const) {
    failure = next;
    await card.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(card.getByRole('status')).toContainText(message);
    await expect(card.getByRole('button', { name: 'Try again', exact: true })).toBeEnabled();
    await expect(card.getByLabel('Theme on this device', { exact: true })).toHaveValue('press');
  }
  await expect(card).not.toContainText('Connect to check for new themes.');
});

test('invalid or removed selected configs fall back without blocking the app', async ({ page, request }) => {
  await file(request, JSON.stringify(custom));
  await page.goto('/#/settings');
  await expect(page.getByLabel('Theme on this device', { exact: true }).locator('option[value="woodland"]')).toHaveCount(1);
  await page.getByLabel('Theme on this device', { exact: true }).selectOption('woodland');
  await file(request, '{');
  await page.reload();
  await expect(page.getByLabel('Theme on this device', { exact: true })).toHaveValue('press');
  await expect(page.getByText('Some custom themes could not be loaded')).toBeVisible();
  await file(request, JSON.stringify(custom));
  await page.reload();
  await expect(page.getByLabel('Theme on this device', { exact: true }).locator('option[value="woodland"]')).toHaveCount(1);
  await page.getByLabel('Theme on this device', { exact: true }).selectOption('woodland');
  await file(request, null);
  await page.reload();
  await expect(page.getByLabel('Theme on this device', { exact: true })).toHaveValue('press');
  await expect(page.getByRole('heading', { name: 'Appearance', exact: true })).toBeVisible();
});

test('a delayed catalogue response does not undo a newer selection', async ({ page, request }) => {
  const catalogue = await (await request.get('/api/v1/themes', { headers: { 'x-herts-theme-api': themeApiVersion } })).json();
  let release!: () => void;const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/themes', async route => { await gate; await route.fulfill({ json: catalogue }); });
  await page.goto('/#/settings');
  await page.getByLabel('Theme on this device', { exact: true }).selectOption('studio');
  release();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'studio');
  await expect(page.getByLabel('Theme on this device', { exact: true })).toHaveValue('studio');
});

for (const themeId of ['nocturne', 'press', 'fieldwork', 'unsaved']) test(`cached ${themeId} is applied before the React bundle runs`, async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const page = await context.newPage(), theme = builtinThemes.find(t => t.id === themeId);
    const expectedId = theme?.id || 'press';
    if (theme) await page.addInitScript(({ key, theme }) => { localStorage.setItem(key, JSON.stringify({ id: theme.id, theme })); }, { key: themeStorageKey, theme });
    let release!: () => void;const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/assets/index-*.js', async route => { await gate; await route.continue(); });
    await page.goto('http://127.0.0.1:8790/#/settings', { waitUntil: 'commit' });
    try {
      await expect(page.locator('html')).toHaveAttribute('data-theme', expectedId);
      expect(await page.locator('#root').innerHTML()).toBe('');
      await expect(page.locator('html')).toHaveCSS('background-color', expectedId === 'press' ? 'rgb(247, 245, 240)' : expectedId === 'fieldwork' ? 'rgb(244, 243, 237)' : 'rgb(25, 28, 34)');
    } finally { release(); }
    await expect(page.getByLabel('Theme on this device', { exact: true })).toHaveValue(expectedId);
  } finally { await context.close(); }
});

test('Press keeps task, reading and conversation controls usable and its treatments reset on switching', async ({ page, context }) => {
  await page.goto('/#/settings');
  await page.getByLabel('Theme on this device', { exact: true }).selectOption('press');
  await page.goto('/#/tasks/inbox');
  await expect(page.locator('h1')).toHaveCSS('font-weight', '900');
  await expect(page.locator('.composer')).toHaveCSS('border-top-width', '2px');
  await page.getByRole('textbox', { name: 'Message Hermes', exact: true }).fill('Review the Press theme');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toHaveCSS('box-shadow', 'rgb(21, 21, 21) 3px 3px 0px 0px');
  await page.getByRole('button', { name: 'Save to Inbox', exact: true }).click();
  await page.getByRole('link', { name: 'Review the Press theme', exact: true }).click();
  await (await detailsControl(page, 'button', 'Snooze')).click();
  await expect(page.locator('dialog[open]')).toHaveCSS('border-top-width', '2px');
  await expect(page.locator('dialog[open]')).toHaveCSS('box-shadow', 'rgb(21, 21, 21) 4px 4px 0px 0px');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect((await detailsField(page, 'Task list'))).toHaveValue('inbox');
  await (await detailsControl(page, 'button', 'Complete task')).click();
  await expect((await detailsField(page, 'Task list'))).toHaveValue('done');
  // Exercise offline Save link without starting a Hermes conversation.
  await context.setOffline(true);
  for (const [index, title] of ['Designing for a quieter web', 'The value of keeping notes', 'A walk along the coast'].entries()) {
    await page.goto('/#/reading/add');
    await page.getByLabel('Message Hermes', { exact: true }).fill(`https://example.com/press-preview-${index}`);
    await (await detailsField(page, 'Reading title')).fill(title);
    await page.getByRole('button', { name: 'Save link', exact: true }).click();
    await expect(page).toHaveURL(/#\/reading$/);
    await page.getByRole('link', { name: title, exact: true }).click();
    await expect((await detailsField(page, 'Reading title'))).toHaveValue(title);
  }
  await context.setOffline(false);
  await expect(page.locator('.save-state')).toContainText('Changes synced');
  await page.goto('/#/reading');
  await page.getByRole('button', { name: 'Edit list', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Move The value of keeping notes down', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Finish editing', exact: true }).click();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator('.mobile-nav a.active')).toHaveCSS('background-color', 'rgb(255, 230, 0)');
    await expect(page.getByRole('link', { name: 'Add link', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/press-reading-mobile.png', fullPage: true });
  for (const title of ['Designing for a quieter web', 'The value of keeping notes', 'A walk along the coast']) {
    await page.getByRole('button', { name: `Mark read: ${title}`, exact: true }).click();
  }
  await page.goto('/#/conversation/existing');
  await expect(page.getByLabel('Message Hermes', { exact: true })).toBeVisible();
  await page.getByLabel('Message Hermes', { exact: true }).fill('A saved Press draft');
  await expect(page.locator('.composer')).toHaveCSS('border-top-width', '2px');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'press');
  await expect(page.getByLabel('Message Hermes', { exact: true })).toHaveValue('A saved Press draft');
  await page.goto('/#/settings');
  await page.getByLabel('Theme on this device', { exact: true }).selectOption('fieldwork');
  await page.goto('/#/tasks/inbox');
  await expect(page.locator('.composer')).toHaveCSS('border-top-width', '1px');
  await expect(page.locator('.mobile-nav a.active')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.getByRole('textbox', { name: 'Message Hermes', exact: true }).fill('Check original styling');
  await expect(page.getByRole('button', { name: 'Save to Inbox', exact: true })).toHaveCSS('box-shadow', 'none');
  await context.setOffline(false);
});

test('dark themes cover reading, conversation settings and snooze dialogs without changing task state', async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByLabel('Theme on this device', { exact: true }).selectOption('nocturne');
  await page.goto('/#/tasks/inbox');
  await page.getByRole('textbox', { name: 'Message Hermes', exact: true }).fill('Theme regression task');
  await page.getByRole('button', { name: 'Save to Inbox', exact: true }).click();
  await page.getByRole('link', { name: 'Theme regression task', exact: true }).click();
  await (await detailsControl(page, 'button', 'Snooze')).click();
  await expect(page.locator('dialog[open]')).toHaveCSS('background-color', 'rgb(34, 38, 46)');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect((await detailsField(page, 'Task list'))).toHaveValue('inbox');
  await page.goto('/#/conversation/existing');
  await page.getByRole('button', { name: /^Conversation settings:/ }).click();
  await expect(page.locator('dialog[open]')).toHaveCSS('background-color', 'rgb(34, 38, 46)');
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(page.getByLabel('Message Hermes', { exact: true })).toBeVisible();
  await page.goto('/#/reading/add');
  await expect(page.locator('.composer')).toHaveCSS('background-color', 'rgb(34, 38, 46)');
  await expect(page.getByLabel('Message Hermes', { exact: true })).toHaveCSS('color', 'rgb(236, 238, 243)');
});
