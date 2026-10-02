import { expect, test } from '@playwright/test';

test('licence notices are available when the installed app is offline', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.goto('/THIRD_PARTY_NOTICES.txt');
  await expect(page.locator('body')).toContainText('Third-party notices for this Herts build');
  await expect(page.locator('body')).toContainText('react@');
});
