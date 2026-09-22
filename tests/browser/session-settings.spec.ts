import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
const state = async (request: APIRequestContext) => (await request.get('/api/v1/state', { headers: { 'x-herts-plugin-api': '1' } })).json();
const writes = async (request: APIRequestContext): Promise<{ method: string; params: any }[]> => ((await (await request.get('http://127.0.0.1:8791/call-details')).json()) as any[]).filter(c => ['session.create', 'session.resume', 'config.set', 'session.cwd.set', 'prompt.submit'].includes(c.method));
const model = (id: string) => JSON.stringify({ id, provider: 'configured' });
async function open(page: Page) { await page.getByRole('button', { name: 'Conversation settings', exact: true }).click(); await expect(page.getByRole('dialog')).toBeVisible(); }
async function setDefaults(request: APIRequestContext, values = {}) { const revision = (await state(request)).snapshot.sessionSettings.defaults.revision; expect((await request.post('/api/v1/session-defaults', { headers: { 'x-herts-request': '1' }, data: { id: crypto.randomUUID(), revision, values } })).ok()).toBe(true); }
test.afterEach(async ({ request }) => { await setDefaults(request); });

for (const width of [390, 1280]) test(`stages actual conversation settings without work until Send at ${width}px`, async ({ page, request }) => {
  await page.setViewportSize({ width, height: 844 });
  await setDefaults(request, { model: { provider: 'configured', id: 'profile-model' }, effort: 'minimal' });
  const before = await writes(request);
  await page.goto(`/#/conversation/settings-${width}`);
  await expect(page.getByRole('button', { name: 'Choose conversation model' })).toContainText('existing-model');
  await expect(page.getByRole('button', { name: 'Choose reasoning effort' })).toContainText('High');
  await open(page);
  await expect(page.getByLabel('Conversation model', { exact: true })).toHaveValue(model('existing-model'));
  await expect(page.getByLabel('Working folder', { exact: true })).toHaveValue('/projects/existing');
  await page.getByLabel('Conversation model', { exact: true }).selectOption(model('chosen-model'));
  await page.getByLabel('Reasoning effort', { exact: true }).selectOption('ultra');
  await page.getByLabel('Fast mode', { exact: true }).selectOption('true');
  await page.getByRole('button', { name: 'Browse folders', exact: true }).click();
  await page.getByRole('button', { name: 'Parent folder', exact: true }).click();
  await expect(page.getByText('private.txt', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'work', exact: true }).click();
  await page.getByRole('button', { name: 'Use this folder', exact: true }).click();
  await page.screenshot({ path: `test-results/session-settings-${width}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.session-settings-note').first()).toContainText('Applies on next Send');
  expect(await writes(request)).toEqual(before);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Choose conversation model' })).toContainText('chosen-model');
  await expect(page.getByRole('button', { name: 'Choose reasoning effort' })).toContainText('Ultra');
  expect(await writes(request)).toEqual(before);
  await page.getByLabel('Message Hermes').fill(`Send using selected settings ${width}`);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.execution-title')).toContainText('complete');
  const sent = (await writes(request)).slice(before.length);
  expect(sent.at(-1)?.method).toBe('prompt.submit');
  expect(sent.filter(c => c.method === 'config.set').map(c => c.params.key)).toEqual(['model', 'reasoning', 'fast']);
  expect(sent.find(c => c.method === 'config.set' && c.params.key === 'model')?.params.value).toContain('--session');
  expect(sent.find(c => c.method === 'session.cwd.set')?.params.cwd).toBe('/projects/work');
  await expect(page.locator('.session-settings-note').first()).not.toContainText('Applies on next Send');
  await page.getByLabel('Message Hermes').fill(`Another message ${width}`); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(async () => (await writes(request)).slice(before.length + sent.length).map(c => c.method)).toEqual(['prompt.submit']);
  await expect(page.locator('.execution-title')).toContainText('complete');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('General Settings defaults apply to new conversations with a per-conversation override', async ({ page, request }) => {
  const before = await writes(request);
  await page.goto('/#/settings'); await page.getByRole('button', { name: 'Edit conversation defaults' }).click();
  await page.getByLabel('Conversation model', { exact: true }).selectOption(model('chosen-model'));
  await page.getByLabel('Reasoning effort', { exact: true }).selectOption('ultra');
  await page.getByLabel('Working folder', { exact: true }).fill('/projects/work');
  await page.getByRole('button', { name: 'Save defaults', exact: true }).click();
  expect(await writes(request)).toEqual(before);
  await page.reload(); await expect(page.locator('.settings-card').filter({ has: page.getByRole('heading', { name: 'New conversation defaults' }) })).toContainText('chosen-model');
  await page.goto('/#/new');
  await expect(page.getByRole('button', { name: 'Choose conversation model' })).toContainText('chosen-model');
  await open(page); await page.getByLabel('Reasoning effort', { exact: true }).selectOption('low'); await page.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('Message Hermes').fill('Use my new conversation defaults'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.execution-title')).toContainText('complete');
  const sent = (await writes(request)).slice(before.length); expect(sent.find(c => c.method === 'session.create')?.params).toMatchObject({ model: 'chosen-model', provider: 'configured', reasoning_effort: 'low', cwd: '/projects/work' });
});

test('pending choices follow the same conversation through Reading and Tasks', async ({ page, request }) => {
  const before = await writes(request);
  await page.goto('/#/conversation/settings-shared'); await open(page);
  await page.getByLabel('Reasoning effort', { exact: true }).selectOption('low'); await page.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save to reading list: https://example.com/settings-shared', exact: true }).click();
  await page.getByRole('button', { name: 'Open reading item: https://example.com/settings-shared', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Choose reasoning effort' })).toContainText('Low');
  await page.goto('/#/conversation/settings-shared'); await page.getByRole('button', { name: 'Make a task', exact: true }).click();
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page).toHaveURL(/#\/task\//);
  await expect(page.getByRole('button', { name: 'Choose reasoning effort' })).toContainText('Low');
  await expect(page.locator('.session-settings-note').first()).toContainText('Applies on next Send');
  expect(await writes(request)).toEqual(before);
});

test('offline choices survive reload and sync before the deliberate Send', async ({ page, context, request }) => {
  const before = await writes(request);
  await page.goto('/#/conversation/settings-offline'); await expect(page.getByRole('button', { name: 'Conversation settings', exact: true })).toBeEnabled();
  await page.evaluate(() => navigator.serviceWorker.ready); await page.reload();
  await expect(page.getByRole('button', { name: 'Choose conversation model' })).toContainText('existing-model');
  await context.setOffline(true); await open(page); await page.getByLabel('Reasoning effort', { exact: true }).selectOption('low');
  await page.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload(); await expect(page.getByRole('button', { name: 'Choose reasoning effort' })).toContainText('Low');
  await context.setOffline(false); await page.getByLabel('Message Hermes').fill('Use settings saved offline'); await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  expect(await writes(request)).toEqual(before); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.execution-title')).toContainText('complete');
  expect((await writes(request)).slice(before.length).filter(c => c.method === 'config.set').map(c => c.params.value)).toEqual(['low']);
});

test('Hermes model confirmation retains the message and requires explicit acceptance', async ({ page, request }) => {
  const before = await writes(request);
  await page.goto('/#/conversation/settings-confirm'); await open(page);
  await page.getByLabel('Conversation model', { exact: true }).selectOption(model('confirm-model')); await page.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('Message Hermes').fill('Wait for model confirmation'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Switch and send saved message', exact: true })).toBeVisible();
  expect((await writes(request)).slice(before.length).filter(c => c.method === 'prompt.submit')).toEqual([]);
  await page.reload(); await page.getByRole('button', { name: 'Switch and send saved message', exact: true }).click();
  await expect(page.locator('.execution-title')).toContainText('complete');
  expect((await writes(request)).slice(before.length).filter(c => c.method === 'prompt.submit')).toHaveLength(1);
});


test('a concurrent settings edit requires review instead of overwriting the other device', async ({ page, request }) => {
  await page.goto('/#/new'); await open(page);
  // The standalone draft is registered only on Send; use defaults for a real
  // two-device conflict without starting any Hermes conversation.
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.goto('/#/settings'); await page.getByRole('button', { name: 'Edit conversation defaults' }).click();
  await page.getByLabel('Reasoning effort', { exact: true }).selectOption('low');
  await setDefaults(request, { effort: 'high' });
  await page.getByRole('button', { name: 'Save defaults', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('changed on another device');
  expect((await state(request)).snapshot.sessionSettings.defaults.values).toEqual({ effort: 'high' });
  await page.getByRole('button', { name: 'Refresh current settings', exact: true }).click();
  await page.getByRole('button', { name: 'Save defaults', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await state(request)).snapshot.sessionSettings.defaults.values).toEqual({ effort: 'low' });
});
