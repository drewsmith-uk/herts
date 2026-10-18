import { detailsField, detailsControl, closePageActions } from './composer-helpers';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { builtinThemes, themeStorageKey } from '../../shared/themeValues';
import { themeApiVersion } from '../../shared/themeValues';

test('Press is the default and every theme preserves desktop and mobile task controls', async ({ page, request }) => {
  await request.post('/api/v1/sync', { headers: { 'x-herts-request': '1' }, data: { id: crypto.randomUUID(), taskId: crypto.randomUUID(), kind: 'create', title: 'Check theme controls', at: Date.now() } });
  await page.goto('/#/settings');
  await expect(page.locator('input[name="appearance-theme"]:checked')).toHaveValue('press');
  for (const theme of builtinThemes) {
    await page.locator(`input[name="appearance-theme"][value="${theme.id}"]`).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id);
    expect(await page.locator('html').evaluate(element => getComputedStyle(element).colorScheme)).toBe(theme.mode);
    await page.goto('/#/tasks/inbox');
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole('textbox', { name: /^(Message Hermes|Add a task)$/, exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Drag Check theme controls', exact: true })).toBeVisible();
      await expect(page.locator('.mobile-lists [data-drop-list]')).toHaveCount(6);
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
  await page.locator(`input[name="appearance-theme"][value="${'nocturne'}"]`).check();
  await expect(other.locator('input[name="appearance-theme"]:checked')).toHaveValue('nocturne');
  await page.reload();
  await expect(page.locator('input[name="appearance-theme"]:checked')).toHaveValue('nocturne');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#191C22');
  const fresh = await browser.newContext();
  try {
    const freshPage = await fresh.newPage();await freshPage.goto('http://127.0.0.1:8790/#/settings');
    await expect(freshPage.locator('input[name="appearance-theme"]:checked')).toHaveValue('press');
  } finally { await fresh.close(); }
});

test('appearance works offline without requesting a theme catalogue', async ({ page, context }) => {
  const requests: string[] = [];
  await page.route('**/api/v1/themes', route => { requests.push(route.request().url()); return route.abort(); });
  await page.goto('/#/settings');
  await expect(page.locator('.theme-preview')).toHaveCount(6);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.getByRole('radio', { name: 'Use Nocturne theme' }).check();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'nocturne');
  await expect(page.locator('.appearance-settings [role=status]')).toHaveCount(0);
  await context.setOffline(false);
  expect(requests).toEqual([]);
});

test('an old custom selection falls back before rendering and cannot add fonts', async ({ page }) => {
  await page.addInitScript(({ key }) => {
    if (!localStorage.getItem('custom-fixture-seeded')) {
      localStorage.setItem(key, JSON.stringify({ id: 'old-custom', theme: { id: 'old-custom', fonts: [{ href: '/_themes/old.woff2' }] } }));
      localStorage.setItem('custom-fixture-seeded', '1');
    }
  }, { key: themeStorageKey });
  const fonts: string[] = [];
  page.on('request', request => { if (request.url().includes('/_themes/')) fonts.push(request.url()); });
  await page.goto('/#/settings');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'press');
  await expect(page.locator('.theme-preview')).toHaveCount(6);
  await expect(page.getByText('This theme is no longer available. Press is selected.')).toBeVisible();
  await expect(page.locator('.custom-themes, #herts-theme-fonts')).toHaveCount(0);
  await page.getByRole('radio', { name: 'Use Studio theme' }).check();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'studio');
  expect(fonts).toEqual([]);
});

test('Press keeps task, reading and conversation controls usable and its treatments reset on switching', async ({ page, context }) => {
  await page.goto('/#/settings');
  await page.locator(`input[name="appearance-theme"][value="${'press'}"]`).check();
  await page.goto('/#/tasks/inbox');
  await expect(page.locator('h1')).toHaveCSS('font-weight', '900');
  await expect(page.locator('.composer')).toHaveCSS('border-top-width', '1px');
  await page.getByRole('textbox', { name: /^(Message Hermes|Add a task)$/, exact: true }).fill('Review the Press theme');
  await expect(page.getByRole('button', { name: 'Save to Inbox', exact: true })).toHaveCSS('box-shadow', 'rgb(22, 21, 17) 3px 3px 0px 0px');
  await page.getByRole('button', { name: 'Save to Inbox', exact: true }).click();
  await page.getByRole('link', { name: 'Review the Press theme', exact: true }).click();
  await (await detailsControl(page, 'button', 'Snooze')).click();
  await expect(page.locator('dialog[open]:not(.detail-action-menu)')).toHaveCSS('border-top-width', '2px');
  await expect(page.locator('dialog[open]:not(.detail-action-menu)')).toHaveCSS('box-shadow', 'rgb(22, 21, 17) 4px 4px 0px 0px');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect((await detailsField(page, 'Task list'))).toHaveValue('inbox');
  await (await detailsControl(page, 'button', 'Complete task')).click();
  await expect((await detailsField(page, 'Task list'))).toHaveValue('done');
  // Exercise offline Save link without starting a Hermes conversation.
  await context.setOffline(true);
  for (const [index, title] of ['Designing for a quieter web', 'The value of keeping notes', 'A walk along the coast'].entries()) {
    await page.goto('/#/reading/add');
    await closePageActions(page); await page.getByLabel(/^(Message Hermes|Add a task)$/,  { exact: true }).fill(`https://example.com/press-preview-${index}`);
    await (await detailsField(page, 'Reading title')).fill(title);
    await page.getByRole('button', { name: 'Save link', exact: true }).click();
    await expect(page).toHaveURL(/#\/reading$/);
    await page.getByRole('link', { name: title, exact: true }).click();
    await expect((await detailsField(page, 'Reading title'))).toHaveValue(title);
  }
  await context.setOffline(false);
  await expect(page.locator('.save-state')).toContainText('Changes synced');
  await page.goto('/#/reading');
  await expect(page.getByRole('button', { name: 'Drag The value of keeping notes', exact: true })).toBeVisible();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator('.mobile-nav [aria-current="page"]')).toHaveCSS('background-color', 'rgb(254, 230, 0)');
    await expect(page.getByRole('link', { name: 'Add link', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/press-reading-mobile.png', fullPage: true });
  for (const title of ['Designing for a quieter web', 'The value of keeping notes', 'A walk along the coast']) {
    await page.getByRole('button', { name: `Mark read: ${title}`, exact: true }).click();
  }
  await page.goto('/#/conversation/existing');
  await expect(page.getByLabel(/^(Message Hermes|Add a task)$/,  { exact: true })).toBeVisible();
  await closePageActions(page); await page.getByLabel(/^(Message Hermes|Add a task)$/,  { exact: true }).fill('A saved Press draft');
  await expect(page.locator('.composer')).toHaveCSS('border-top-width', '1px');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'press');
  await expect(page.getByLabel(/^(Message Hermes|Add a task)$/,  { exact: true })).toHaveValue('A saved Press draft');
  await page.goto('/#/settings');
  await page.locator(`input[name="appearance-theme"][value="${'fieldwork'}"]`).check();
  await page.goto('/#/tasks/inbox');
  await expect(page.locator('.composer')).toHaveCSS('border-top-width', '1px');
  await expect(page.locator('.mobile-nav [aria-current="page"]')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.getByRole('textbox', { name: /^(Message Hermes|Add a task)$/, exact: true }).fill('Check original styling');
  await expect(page.getByRole('button', { name: 'Save to Inbox', exact: true })).toHaveCSS('box-shadow', 'none');
  await context.setOffline(false);
});

test('dark themes cover reading, conversation settings and snooze dialogs without changing task state', async ({ page }) => {
  await page.goto('/#/settings');
  await page.locator(`input[name="appearance-theme"][value="${'nocturne'}"]`).check();
  await page.goto('/#/tasks/inbox');
  await page.getByRole('textbox', { name: /^(Message Hermes|Add a task)$/, exact: true }).fill('Theme regression task');
  await page.getByRole('button', { name: 'Save to Inbox', exact: true }).click();
  await page.getByRole('link', { name: 'Theme regression task', exact: true }).click();
  await (await detailsControl(page, 'button', 'Snooze')).click();
  await expect(page.locator('dialog[open]:not(.detail-action-menu)')).toHaveCSS('background-color', 'rgb(34, 38, 46)');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect((await detailsField(page, 'Task list'))).toHaveValue('inbox');
  await page.goto('/#/conversation/existing');
  await page.getByRole('button', { name: /^Conversation settings:/ }).click();
  await expect(page.locator('dialog[open]:not(.detail-action-menu)')).toHaveCSS('background-color', 'rgb(34, 38, 46)');
  await page.getByRole('dialog', { name: 'Conversation settings', exact: true }).getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.getByLabel(/^(Message Hermes|Add a task)$/,  { exact: true })).toBeVisible();
  await page.goto('/#/reading/add');
  await expect(page.locator('.composer')).toHaveCSS('background-color', 'rgb(34, 38, 46)');
  await expect(page.getByLabel(/^(Message Hermes|Add a task)$/,  { exact: true })).toHaveCSS('color', 'rgb(236, 238, 243)');
});
