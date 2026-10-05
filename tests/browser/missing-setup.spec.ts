import { test, expect, type APIRequestContext } from '@playwright/test';

const headers = { 'x-herts-request': '1' };
const workCalls = async (request: APIRequestContext) => (await (await request.get('http://127.0.0.1:8791/calls')).json() as string[]).filter(m => ['session.create', 'session.resume', 'prompt.submit'].includes(m));

for (const view of ['reading', 'standalone']) test(`resends in a legacy ${view} conversation without a separate recovery step`, async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const id = `missing-setup-${view}`;
  const fixture = await (await request.post('/__test/missing-setup', { headers, data: { id } })).json();
  let path = `/conversation/${id}`;
  if (view === 'reading') {
    const itemId = crypto.randomUUID();
    const response = await request.post('/api/v1/reading/sync', { headers, data: { id: crypto.randomUUID(), kind: 'create', itemId, contextId: crypto.randomUUID(), conversationId: id, title: 'Saved reading conversation', url: 'https://example.com/legacy-recovery', at: Date.now() } });
    expect(response.ok()).toBeTruthy(); path = `/reading-item/${itemId}`;
  }
  const before = await workCalls(request);
  await page.goto(`/#${path}`);
  await page.getByLabel('Message Hermes').fill('Keep my current draft');
  await expect(page.getByRole('button', { name: 'Reconnect here', exact: true })).toHaveCount(0);
  expect(await workCalls(request)).toEqual(before);
  await page.reload();
  await expect(page.getByLabel('Message Hermes')).toHaveValue('Keep my current draft');
  await page.getByLabel('Message Hermes').focus();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(async () => (await workCalls(request)).slice(before.length)).toEqual(['session.create', 'prompt.submit']);
  await expect(page.getByText('Hermes request failed (404).', { exact: true })).toHaveCount(0);
  if (view === 'reading') await expect(page).toHaveURL(new RegExp(`${path}$`));
  else await expect(page).toHaveURL(new RegExp(`/conversation/${fixture.contextId}$`));
  const after = await (await request.get('/api/v1/state')).json();
  expect(after.snapshot.contexts.find((c: any) => c.id === fixture.contextId).link).toBeTruthy();
  expect(after.actions.find((a: any) => a.id === fixture.actionId).text).toBe('The original saved message');
  await page.reload();
  await expect(page.getByLabel('Message Hermes')).toBeVisible();
  expect((await workCalls(request)).slice(before.length)).toEqual(['session.create', 'prompt.submit']);
});

test('does not replace a conversation with an uncertain submission on Send', async ({ page, request }) => {
  const id = 'missing-setup-submitted';
  const fixture = await (await request.post('/__test/missing-setup', { headers, data: { id, submitted: true } })).json();
  const before = await workCalls(request);
  await page.goto(`/#/conversation/${id}`);
  await expect(page.getByText('The linked Hermes session could not be found.', { exact: false }).first()).toBeVisible();
  await page.getByLabel('Message Hermes').fill('A different message');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(async () => {
    const state = await (await request.get('/api/v1/state')).json();
    return state.actions.find((a: any) => a.taskId === fixture.contextId && a.id !== fixture.actionId)?.receipt;
  }).toBe('rejected');
  expect(await workCalls(request)).toEqual(before);
  await expect(page.getByRole('button', { name: 'Reconnect here', exact: true })).toHaveCount(0);
});
