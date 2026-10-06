import { test, expect, type APIRequestContext } from '@playwright/test';

const headers = { 'x-herts-request': '1' };
const readState = async (request: APIRequestContext) => (await request.get('/api/v1/state', { headers: { 'x-herts-plugin-api': '1' } })).json();
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
  const defaultsRevision = (await readState(request)).snapshot.sessionSettings.defaults.revision;
  const sent = page.waitForRequest(r => r.url().endsWith('/api/v1/actions') && r.method() === 'POST');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  expect((await sent).postDataJSON().defaultsRevision).toBe(defaultsRevision);
  await expect.poll(async () => (await workCalls(request)).slice(before.length)).toEqual(['session.create', 'prompt.submit']);
  await expect(page.getByText('Hermes request failed (404).', { exact: true })).toHaveCount(0);
  if (view === 'reading') await expect(page).toHaveURL(new RegExp(`${path}$`));
  else await expect(page).toHaveURL(new RegExp(`/conversation/${fixture.contextId}$`));
  const after = await readState(request);
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
    const state = await readState(request);
    return state.actions.find((a: any) => a.taskId === fixture.contextId && a.id !== fixture.actionId)?.receipt;
  }).toBe('rejected');
  expect(await workCalls(request)).toEqual(before);
  await expect(page.getByRole('button', { name: 'Reconnect here', exact: true })).toHaveCount(0);
});

test('keeps the saved message and link when another device changes defaults before recovery', async ({ page, request }) => {
  const id = 'missing-setup-defaults-race';
  const fixture = await (await request.post('/__test/missing-setup', { headers, data: { id } })).json();
  const initial = await readState(request);
  const defaults = initial.snapshot.sessionSettings.defaults;
  const before = await workCalls(request);
  await page.route('**/api/v1/actions', async route => {
    expect(route.request().postDataJSON().defaultsRevision).toBe(defaults.revision);
    // Simulate another device after this client has prepared its Send request.
    const changed = await request.post('/api/v1/session-defaults', { headers, data: { id: crypto.randomUUID(), revision: defaults.revision, values: { ...defaults.values, fast: !defaults.values.fast } } });
    expect(changed.ok()).toBe(true);
    await route.continue();
  });
  try {
    await page.goto(`/#/conversation/${id}`);
    await page.getByLabel('Message Hermes').fill('Keep this unsent message');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(async () => {
      const state = await readState(request);
      return state.actions.find((a: any) => a.taskId === fixture.contextId && a.id !== fixture.actionId)?.receipt;
    }).toBe('rejected');
    await expect(page.getByText('New conversation defaults changed. Review them before sending.', { exact: false }).first()).toBeVisible();
    const after = await readState(request);
    expect(after.actions.find((a: any) => a.taskId === fixture.contextId && a.id !== fixture.actionId).text).toBe('Keep this unsent message');
    expect(after.snapshot.contexts.find((c: any) => c.id === fixture.contextId).link).toEqual(initial.snapshot.contexts.find((c: any) => c.id === fixture.contextId).link);
    expect(await workCalls(request)).toEqual(before);
  } finally {
    await page.unrouteAll({ behavior: 'wait' });
    const current = (await readState(request)).snapshot.sessionSettings.defaults;
    expect((await request.post('/api/v1/session-defaults', { headers, data: { id: crypto.randomUUID(), revision: current.revision, values: defaults.values } })).ok()).toBe(true);
  }
});
