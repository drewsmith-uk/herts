import { test, expect, type Locator } from '@playwright/test';
import { builtinThemes, themeStorageKey } from '../../shared/themeValues';
import { detailsField } from './composer-helpers';

async function expectFocusFits(control: Locator) {
  await control.page().keyboard.press('Tab');
  // focus() does not wait for controls to become visible or enabled.
  await expect(control).toBeVisible();
  await expect(control).toBeEnabled();
  await control.focus();
  await expect(control).toBeFocused();
  const result = await control.evaluate(node => {
    // Shared search fields draw their focus ring around the whole control.
    const ringOwner=node.closest('.search-field') || node;
    const style = getComputedStyle(ringOwner), rect = ringOwner.getBoundingClientRect();
    const outset = Math.max(0, parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset));
    const ring = { left: rect.left - outset, right: rect.right + outset, top: rect.top - outset, bottom: rect.bottom + outset };
    const clipped: string[] = [];
    // A fixed conversation shell gives body no height; viewport bounds cover the roots.
    if (ring.left < -1 || ring.right > innerWidth + 1 || ring.top < -1 || ring.bottom > innerHeight + 1) clipped.push('viewport');
    for (let parent = ringOwner.parentElement; parent && parent !== document.body && parent !== document.documentElement; parent = parent.parentElement) {
      const css = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      const left = bounds.left + parent.clientLeft, top = bounds.top + parent.clientTop;
      if (/(auto|scroll|hidden|clip)/.test(css.overflowX) && (ring.left < left - 1 || ring.right > left + parent.clientWidth + 1)) clipped.push(`${parent.tagName}.${parent.className} (horizontal)`);
      if (/(auto|scroll|hidden|clip)/.test(css.overflowY) && (ring.top < top - 1 || ring.bottom > top + parent.clientHeight + 1)) clipped.push(`${parent.tagName}.${parent.className} (vertical)`);
    }
    return { control: node.getAttribute('aria-label') || node.textContent, visible: node.matches(':focus-visible'), outline: style.outlineStyle, clipped, ring };
  });
  expect(result.visible).toBe(true);
  expect(result.outline).not.toBe('none');
  expect(result.clipped, JSON.stringify(result)).toEqual([]);
}

for (const theme of builtinThemes) test(`${theme.name}: title and scrollable control highlights fit`, async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.addInitScript(({ key, theme }) => localStorage.setItem(key, JSON.stringify({ id: theme.id, theme })), { key: themeStorageKey, theme });
  const taskId = crypto.randomUUID(), itemId = crypto.randomUUID();
  const title = 'A long title that wraps across lines on a narrow screen https://example.com/' + 'article'.repeat(30);
  expect((await request.post('/api/v1/sync', { headers: { 'x-herts-request': '1' }, data: { id: crypto.randomUUID(), taskId, kind: 'create', title, at: Date.now() } })).ok()).toBe(true);
  expect((await request.post('/api/v1/reading/sync', { headers: { 'x-herts-request': '1' }, data: { id: crypto.randomUUID(), itemId, contextId: crypto.randomUUID(), kind: 'create', title, url: 'https://example.com/' + itemId, at: Date.now() } })).ok()).toBe(true);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const [path, label] of [[`/task/${taskId}`, 'Task title'], [`/reading-item/${itemId}`, 'Reading title'], ['/conversation/existing', 'Conversation title']]) {
      await page.goto('/#' + path);
      await page.keyboard.press('Tab');
      const field = await detailsField(page, label);
      await field.focus();
      if (theme.id === 'press' && width === 390 && label === 'Task title') await page.screenshot({ path: 'test-results/title-focus.png' });
      await expectFocusFits(field);
      await expect(page.getByLabel('Message Hermes', { exact: true })).toBeEditable();
      await page.getByLabel('Message Hermes', { exact: true }).focus();
      await expectFocusFits(page.getByRole('button', { name: /^Conversation settings:/ }));
      if (await page.getByRole('button', { name: 'Collapse message box', exact: true }).isVisible()) await expectFocusFits(page.getByRole('button', { name: 'Collapse message box', exact: true }));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    for (const [path, label] of [['/tasks/inbox', 'New task title'], ['/reading/add', 'Reading title']]) {
      await page.goto('/#' + path);
      // focus() does not wait for the draft to load. A disabled editor ignores
      // focus and leaves the phone's optional fields inside a closed composer.
      await expect(page.getByLabel('Message Hermes', { exact: true })).toBeEditable();
      await page.getByLabel('Message Hermes', { exact: true }).focus();
      await expectFocusFits(await detailsField(page, label));
    }
    await page.goto('/#/settings');
    await page.keyboard.press('Tab');
    await page.getByRole('button', { name: 'Edit conversation defaults', exact: true }).click();
    const dialog = page.getByRole('dialog');
    for (const control of await dialog.locator('input:not([type=hidden]), select').all()) await expectFocusFits(control);
    await page.getByRole('button', { name: 'Browse folders', exact: true }).click();
    await expect(dialog.locator('.session-folder-browser li button').first()).toBeVisible();
    for (const control of await dialog.locator('.session-folder-browser li button').all()) await expectFocusFits(control);
    await page.keyboard.press('Escape');
    if (width < 700) for (const link of await page.locator('.mobile-nav > a').all()) await expectFocusFits(link);
  }
});

test('focus checks wait for delayed conversation settings', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  let release!: () => void;
  const settings = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/session-settings?*', async route => {
    await settings;
    await route.continue();
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await page.goto('/#/conversation/existing');
    await page.getByLabel('Message Hermes', { exact: true }).click();
    const control = page.getByRole('button', { name: /^Conversation settings:/ });
    await expect(control).toBeVisible();
    await expect(control).toBeDisabled();
    timer = setTimeout(release, 500);
    await expectFocusFits(control);
  } finally {
    clearTimeout(timer);
    release();
  }
});
