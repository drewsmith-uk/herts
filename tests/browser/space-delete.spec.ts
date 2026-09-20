import { test, expect, type APIRequestContext } from '@playwright/test';
const original = '00000000-0000-4000-8000-000000000001';
const headers = { 'x-herts-request': '1' };
const state = async (request: APIRequestContext) => (await (await request.get('/api/v1/state')).json()).snapshot;
async function createSpace(request: APIRequestContext, name: string) {
  const spaceId = crypto.randomUUID();
  const input = { id: crypto.randomUUID(), spaceId, name, kind: 'create', at: Date.now() };
  const response = await request.post('/api/v1/plugins/tasks/commands', { headers, data: { id: input.id, generation: 0, command: 'space', input } });
  expect(response.ok()).toBe(true); return spaceId;
}

test('an empty added space can be deleted with confirmation and a default fallback', async ({ page, request }) => {
  const id = await createSpace(request, 'Accidental space');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/settings/plugins');
  await page.getByLabel('Default space', { exact: true }).selectOption(id);
  await expect.poll(async () => (await state(request)).defaultSpaceId).toBe(id);
  await page.getByRole('button', { name: 'Delete Accidental space space', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete “Accidental space”?' });
  await expect(dialog).toContainText('Your default space will become');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Name of Accidental space space', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete Accidental space space', exact: true }).click();
  await dialog.getByRole('button', { name: 'Delete space', exact: true }).click();
  await expect.poll(async () => (await state(request)).spaces.some((space: any) => space.id === id)).toBe(false);
  await page.reload(); await expect(page.getByLabel('Default space', { exact: true })).toHaveValue(original);
  await page.goto(`/#/spaces/${id}/inbox`); await page.getByRole('link', { name: /^Go to .* Inbox$/ }).click();
  await expect(page.getByLabel('New task title', { exact: true })).toBeEditable();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a task arriving from another device prevents deletion and can be kept', async ({ page, context, request }) => {
  const id = await createSpace(request, 'Deletion race space');
  await page.goto('/#/settings/plugins'); await page.evaluate(() => navigator.serviceWorker.ready);
  await page.getByRole('button', { name: 'Delete Deletion race space space', exact: true }).click();
  await context.setOffline(true);
  await page.getByRole('dialog').getByRole('button', { name: 'Delete space', exact: true }).click();
  const response = await request.post('/api/v1/sync', { headers, data: { id: crypto.randomUUID(), taskId: crypto.randomUUID(), spaceId: id, kind: 'create', title: 'Added while another device was offline', at: Date.now() } });
  expect(response.ok()).toBe(true);
  await context.setOffline(false);
  await expect(page.getByText('The space could not be deleted', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Keep space', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete Deletion race space space', exact: true })).toBeDisabled();
  expect((await state(request)).tasks.some((task: any) => task.spaceId === id)).toBe(true);
});

test('a task captured offline in a deleted space can be recovered into the default Inbox', async ({ page, context, request }) => {
  const id = await createSpace(request, 'Removed while offline');
  await page.goto(`/#/spaces/${id}/inbox`); await page.evaluate(() => navigator.serviceWorker.ready);
  await expect(page.getByLabel('New task title', { exact: true })).toBeEditable();
  await context.setOffline(true);
  await page.getByLabel('New task title', { exact: true }).fill('Keep my offline task');
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Keep my offline task', exact: true })).toBeVisible();
  const input = { id: crypto.randomUUID(), spaceId: id, kind: 'delete', baseName: 'Removed while offline', baseDefaultSpaceId: (await state(request)).defaultSpaceId, at: Date.now() };
  expect((await request.post('/api/v1/plugins/tasks/commands', { headers, data: { id: input.id, generation: 0, command: 'space', input } })).ok()).toBe(true);
  await context.setOffline(false);
  await expect(page.getByText(/The space was deleted. Keeping this change saves it/)).toBeVisible();
  await page.getByRole('button', { name: 'Keep my change', exact: true }).click();
  await expect.poll(async () => (await state(request)).tasks.some((task: any) => task.title === 'Keep my offline task' && task.spaceId === original)).toBe(true);
  await page.getByRole('link', { name: /^Go to .* Inbox$/ }).click();
  await expect(page.getByRole('link', { name: 'Keep my offline task', exact: true })).toBeVisible();
});
