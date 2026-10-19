import { test, expect } from '@playwright/test';
import { themeStorageKey } from '../../shared/themeValues';

test('old selections resolve to Press before rendering and remain Press offline', async ({ page, context }) => {
  await page.addInitScript(key => {
    if (!localStorage.getItem('appearance-seeded')) {
      localStorage.setItem(key, JSON.stringify({ id: 'nocturne' }));
      localStorage.setItem('appearance-seeded', '1');
    }
  }, themeStorageKey);
  await page.goto('/#/settings');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'press');
  await expect(page.locator('.appearance-settings,.theme-preview')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('16px Inter'))).toBe(true);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'press');
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('16px Inter'))).toBe(true);
  await context.setOffline(false);
  const other = await context.newPage();
  await other.goto('/#/settings');
  await other.evaluate(key => localStorage.setItem(key, JSON.stringify({ id: 'studio' })), themeStorageKey);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'press');
});

test('Press survives unavailable appearance storage', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('herts:appearance')) throw new DOMException('Unavailable', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.goto('/#/settings');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'press');
  await expect(page.locator('.appearance-settings')).toHaveCount(0);
});
