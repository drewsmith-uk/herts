import { expect, type Page } from '@playwright/test';

/** Follow the same explicit disclosure step a reader uses before editing metadata. */
export async function detailsField(page: Page, name: string) {
  const field = page.getByLabel(name, { exact: true });
  await expect(field).toBeAttached();
  if (!await field.isVisible()) {
    const toggle = page.getByRole('button', { name: 'Show page details', exact: true });
    if (await toggle.isVisible()) await toggle.click();
    else await page.locator('.entry-details summary').click();
  }
  return field;
}
export async function detailsControl(page: Page, role: 'button' | 'link', name: string) {
  const control = page.getByRole(role, { name, exact: true, includeHidden: true });
  await expect(control).toBeAttached();
  if (!await control.isVisible()) await page.getByRole('button', { name: 'Show page details', exact: true }).click();
  return control;
}
