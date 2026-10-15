import { expect, type Page } from '@playwright/test';

export async function openConnectionDetails(page: Page) {
  const previous = page.url();
  const row = page.getByRole('button', { name: /^Connection status:/ });
  if (!await row.isVisible()) {
    const more = page.locator('.mobile-nav').getByRole('button', { name: 'More', exact: true });
    if (await more.isVisible()) await more.click();
    else await page.locator('a[href="#/settings"]:visible').first().click();
  }
  await row.click();
  await expect(page.getByRole('dialog', { name: 'Connection and sync', exact: true })).toBeVisible();
  return async () => {
    await page.keyboard.press('Escape');
    await expect(row).toBeFocused();
    if (await page.getByRole('dialog', { name: 'More', exact: true }).isVisible()) await page.keyboard.press('Escape');
    if (page.url() !== previous) await page.goto(previous);
  };
}
