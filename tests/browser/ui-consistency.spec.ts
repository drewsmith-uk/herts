import { test, expect } from '@playwright/test';
import { builtinThemes, themeStorageKey } from '../../shared/themeValues';

test('an older app gets an actionable plugin update message and can still open app updates', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, '__HERTS_PLUGIN_RUNTIME__', {
      configurable: true,
      set(runtime) {
        Object.defineProperty(globalThis, '__HERTS_PLUGIN_RUNTIME__', { configurable: true, writable: true, value: { ...runtime, sdk: { ...runtime.sdk, PageHeader: undefined } } });
      },
    });
  });
  await page.goto('/#/settings/plugins');
  await expect(page.getByText('Update Herts in Settings → App updates to use this version of Tasks.', { exact: true })).toBeVisible();
  await expect(page.getByText('Update Herts in Settings → App updates to use this version of Reading.', { exact: true })).toBeVisible();
  await page.goto('/#/settings');
  await expect(page.getByRole('button', { name: 'Check for updates', exact: true })).toBeVisible();
});

for (const theme of builtinThemes) {
  test(`${theme.name}: page controls fit narrow phones and shared dialogs remain usable`, async ({ page, request }) => {
    test.setTimeout(180_000);
    await page.addInitScript(({ key, theme }) => localStorage.setItem(key, JSON.stringify({ id: theme.id, theme })), { key: themeStorageKey, theme });
    const title = `${theme.name}: Review the shared project plan and prepare a clear outline for the next meeting`;
    const taskId = crypto.randomUUID();
    expect((await request.post('/api/v1/sync', { headers: { 'x-herts-request': '1' }, data: { id: crypto.randomUUID(), taskId, kind: 'create', title, at: Date.now() } })).ok()).toBe(true);
    expect((await request.post('/api/v1/reading/sync', { headers: { 'x-herts-request': '1' }, data: { id: crypto.randomUUID(), itemId: crypto.randomUUID(), contextId: crypto.randomUUID(), kind: 'create', title, url: 'https://example.com/ui-consistency', at: Date.now() } })).ok()).toBe(true);

    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ['/tasks/inbox', '/conversations', '/reading', '/settings', '/settings/plugins']) {
        await page.goto(`/#${path}`);
        await expect(page.locator('.page-header h1')).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id);
        if (path === '/tasks/inbox') await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
        if (path === '/reading') await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
        if (path === '/conversations') await expect(page.locator('.conversation-row').first()).toBeVisible();
        if (path === '/settings/plugins') await expect(page.getByRole('heading', { name: 'Task spaces', exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme.id} ${path} at ${width}px`).toBe(true);
        const controls = await page.locator('.page-header-actions a, .page-header-actions button, .section-nav>a').evaluateAll(nodes => nodes.map(node => {
          const { x, width, height } = node.getBoundingClientRect(); return { x, width, height };
        }));
        for (const bounds of controls) {
          expect(bounds.height).toBeGreaterThanOrEqual(44);
          expect(bounds.x).toBeGreaterThanOrEqual(0);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
        }
        if (['fieldwork', 'press'].includes(theme.id) && [390, 1280].includes(width)) {
          await page.screenshot({ path: `test-results/ui-${theme.id}-${path.slice(1).replaceAll('/', '-')}-${width}.png`, fullPage: path.startsWith('/settings') });
        }
      }
    }
    await page.setViewportSize({ width: 320, height: 900 });
    for (const path of ['/tasks/inbox', '/reading']) {
      await page.goto(`/#${path}`);
      await page.getByRole('button', { name: 'Edit list', exact: true }).click();
      const reorderButtons = await page.locator('.reorder-controls button').evaluateAll(nodes => nodes.map(node => {
        const { width, height } = node.getBoundingClientRect(); return { width, height };
      }));
      expect(reorderButtons.length).toBeGreaterThan(0);
      for (const bounds of reorderButtons) {
        expect(bounds.width).toBeGreaterThanOrEqual(44);
        expect(bounds.height).toBeGreaterThanOrEqual(44);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.goto('/#/settings');
    await page.getByRole('button', { name: 'Edit conversation defaults', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const fields = await dialog.locator('input, select').evaluateAll(nodes => nodes.map(node => {
      const style = getComputedStyle(node), bounds = node.getBoundingClientRect();
      return { font: style.fontSize, radius: style.borderRadius, expectedRadius: getComputedStyle(document.documentElement).getPropertyValue('--radius-control').trim(), height: bounds.height, right: bounds.right };
    }));
    for (const field of fields) {
      expect(field.font).toBe('16px');
      expect(field.radius).toBe(field.expectedRadius);
      expect(field.height).toBeGreaterThanOrEqual(44);
      expect(field.right).toBeLessThanOrEqual(320);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit conversation defaults', exact: true })).toBeFocused();
  });
}
