import { expect, type Page } from '@playwright/test';

async function dismissEditor(page: Page) {
  const editor = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Cancel', exact: true }) });
  const cancel = editor.getByRole('button', { name: 'Cancel', exact: true });
  const state = await cancel.evaluateAll(nodes => nodes.map(node => ({ disabled: (node as HTMLButtonElement).disabled })));
  if (state.length !== 1) return;
  if (state[0].disabled) await expect(editor).toBeHidden();
  else await cancel.click();
}

/** Follow the same explicit disclosure step a reader uses before editing metadata. */
export async function detailsField(page: Page, name: string) {
  await expect(page.locator('.conversation-page-header, .entry-details').first()).toBeAttached();
  const field = /^Task (list|space)$/.test(name) ? page.getByRole('combobox', { name, exact: true }) : page.getByLabel(name, { exact: true });
  const names: Record<string, string> = { 'Task title': 'Rename task', 'Conversation title': 'Rename conversation', 'Reading title': 'Rename article', 'Task list': 'Move to list', 'Task space': 'Move to space' };
  if (names[name] && await page.locator('.conversation-page-header').count()) {
    await expect(page.locator('.conversation-page-header').getByRole('button', { name: names[name], exact: !/^Task (list|space)$/.test(name), includeHidden: true })).toBeAttached();
  }
  if (!await field.isVisible()) {
    await dismissEditor(page);
    const toggle = page.locator('.conversation-page-header').getByRole('button', { name: 'Actions', exact: true });
    if (await toggle.isVisible()) {
      if (!await page.getByRole('dialog', { name: 'Page actions', exact: true }).isVisible()) await toggle.click();
      if (names[name]) await page.getByRole('button', { name: names[name], exact: !name.match(/^Task (list|space)$/) }).click();
    } else await page.locator('.entry-details summary').click();
  }
  return field;
}
export async function detailsControl(page: Page, role: 'button' | 'link', name: string) {
  await dismissEditor(page);
  await expect(page.locator('.conversation-page-header')).toBeAttached();
  const headerControl = page.locator('.conversation-page-header').getByRole(role, { name, exact: true, includeHidden: true });
  const control = await headerControl.count() ? headerControl : page.getByRole(role, { name, exact: true, includeHidden: true });
  await expect(control).toBeAttached();
  if (!await control.isVisible()) await page.locator('.conversation-page-header').getByRole('button', { name: 'Actions', exact: true }).click();
  return control;
}

export async function pageAction(page: Page, role: 'button' | 'link', name: string | RegExp) {
  await dismissEditor(page);
  await expect(page.locator('.conversation-page-header')).toBeAttached();
  const headerControl = page.locator('.conversation-page-header').getByRole(role, { name, exact: true, includeHidden: true });
  const control = await headerControl.count() ? headerControl : page.getByRole(role, { name, exact: true, includeHidden: true });
  await expect(control).toBeAttached();
  if (!await control.isVisible()) await page.locator('.conversation-page-header').getByRole('button', { name: 'Actions', exact: true }).click();
  return control;
}
export async function closePageActions(page: Page) {
  await dismissEditor(page);
  const dialog = page.getByRole('dialog', { name: 'Page actions', exact: true });
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
}

export async function saveTitle(page: Page) {
  const dialog = page.getByRole('dialog').filter({ has: page.locator('textarea.rename-title') });
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
}
export async function openSettingsGroups(page: Page) {
  await expect(page.locator('.settings-group').first()).toBeVisible();
  for (const group of await page.locator('.settings-group').all()) if (!await group.evaluate(node => (node as HTMLDetailsElement).open)) await group.locator('summary').first().click();
}
