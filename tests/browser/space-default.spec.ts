import { test, expect } from '@playwright/test';
const original = '00000000-0000-4000-8000-000000000001';
const headers = { 'x-herts-request': '1' };
test('removing the original space preserves the new default and legacy navigation', async ({ page, request }) => {
  const spaceId = crypto.randomUUID();
  async function command(input: object) {
    const operation = { id: crypto.randomUUID(), at: Date.now(), ...input };
    return request.post('/api/v1/plugins/tasks/commands', { headers, data: { id: operation.id, generation: 0, command: 'space', input: operation } });
  }
  expect((await command({ spaceId, kind: 'create', name: 'New default' })).ok()).toBe(true);
  expect((await command({ spaceId, kind: 'default', baseDefaultSpaceId: original })).ok()).toBe(true);
  await page.goto('/#/settings/plugins');
  await expect(page.getByRole('button', { name: 'Delete New default space', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete Personal space', exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete “Personal”?' }).getByRole('button', { name: 'Delete space', exact: true }).click();
  await expect(page.getByLabel('Name of Personal space', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('input[name=default-space]:checked')).toHaveValue(spaceId);
  await page.goto('/#/tasks/inbox');
  await page.getByRole('textbox', { name: /^(Message Hermes|Add a task)$/ }).fill('Capture after original removal');
  await page.getByRole('button', { name: 'Save only', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Capture after original removal', exact: true })).toBeVisible();
  const snapshot = (await (await request.get('/api/v1/state')).json()).snapshot;
  expect(snapshot.spaces.map((s: { id: string }) => s.id)).toEqual([spaceId]);
  expect(snapshot.tasks.find((t: { title: string }) => t.title === 'Capture after original removal').spaceId).toBe(spaceId);
  expect((await command({ spaceId, kind: 'delete', baseName: 'New default', baseDefaultSpaceId: original })).status()).toBe(409);
});
