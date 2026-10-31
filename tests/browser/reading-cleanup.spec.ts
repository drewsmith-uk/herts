import { test, expect } from '@playwright/test';

for (const mode of ['off', 'tracking', 'all']) test(`shared Reading links use ${mode} cleanup for saving and sending`, async ({ page, request }) => {
  const original = `https://example.com/cleanup-${mode}?id=1&utm_source=feed#part`;
  const expected = mode === 'off' ? original : mode === 'tracking' ? `https://example.com/cleanup-${mode}?id=1#part` : `https://example.com/cleanup-${mode}#part`;
  await page.goto(`/share?text=${encodeURIComponent('Read ' + original)}`);
  await page.getByRole('button', { name: 'Reading', exact: true }).click();
  const choice = page.getByLabel('URL cleanup', { exact: true });
  await expect(choice).toHaveValue('off');
  await choice.selectOption(mode);
  await expect(page.getByLabel('Message Hermes', { exact: true })).toHaveValue('Read ' + original);
  await page.reload();
  await page.getByRole('button', { name: 'Reading', exact: true }).click();
  await expect(choice).toHaveValue(mode);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase', 'complete');
  const state = await (await request.get('/api/v1/state')).json();
  const item = state.snapshot.reading.items.find((i: any) => i.url === expected);
  expect(item).toBeTruthy();
  expect(state.actions.filter((a: any) => a.taskId === item.contextId).map((a: any) => a.text)).toEqual(['Read ' + expected]);
});

test('settings initialize new drafts and overrides survive offline saving', async ({ page, request, context }) => {
  await page.goto('/#/settings/plugins');
  await page.getByLabel('URL cleanup', { exact: true }).selectOption('all');
  await expect(page.locator('.save-state')).toContainText('Changes synced');
  await page.goto('/#/reading/add');
  const choice = page.getByLabel('URL cleanup', { exact: true });
  await expect(choice).toHaveValue('all');
  await page.getByLabel('Message Hermes', { exact: true }).fill('https://example.com/offline-cleanup?id=1&utm_source=x#part');
  await choice.selectOption('tracking');
  await page.goto('/#/settings/plugins');
  await page.getByLabel('URL cleanup', { exact: true }).selectOption('off');
  await expect(page.locator('.save-state')).toContainText('Changes synced');
  await page.goto('/#/reading/add');
  await expect(choice).toHaveValue('tracking');
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Save only', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Reading list/ })).toBeVisible();
  await context.setOffline(false);
  await expect.poll(async () => {
    const state = await (await request.get('/api/v1/state')).json();
    return state.snapshot.reading.items.some((i: any) => i.url === 'https://example.com/offline-cleanup?id=1#part');
  }).toBe(true);
});

test('selected links remain selected when cleanup merges duplicate URLs', async ({ page, request }) => {
  await page.goto('/#/reading/add');
  await page.getByLabel('Message Hermes', { exact: true }).fill('https://example.com/duplicate?utm_source=a\nhttps://example.com/duplicate?utm_source=b');
  await page.getByRole('radio').last().check();
  await page.getByLabel('URL cleanup', { exact: true }).selectOption('tracking');
  await page.getByRole('button', { name: 'Save only', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Reading list/ })).toBeVisible();
  await expect.poll(async () => {
    const state = await (await request.get('/api/v1/state')).json();
    return state.snapshot.reading.items.filter((i: any) => i.url === 'https://example.com/duplicate').length;
  }).toBe(1);
});

test('cleanup survives a delayed send and a lost receipt without duplicate messages', async ({ page, request }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const sending = new Promise<void>(resolve => { started = resolve; });
  let attempts = 0;
  await page.route('**/api/v1/actions', async route => {
    attempts++;
    expect(route.request().postDataJSON().text).toBe('https://example.com/cleanup-receipt?id=1');
    started(); await held; await route.fetch(); await route.abort('failed');
  });
  await page.goto('/#/reading/add');
  await page.getByLabel('Message Hermes', { exact: true }).fill('https://example.com/cleanup-receipt?id=1&utm_source=x');
  await page.getByLabel('URL cleanup', { exact: true }).selectOption('tracking');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await sending;
  await expect(page.getByLabel('URL cleanup', { exact: true })).toBeDisabled();
  release();
  await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase', 'complete');
  await page.reload();
  await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase', 'complete');
  expect(attempts).toBe(1);
  const state = await (await request.get('/api/v1/state')).json();
  const item = state.snapshot.reading.items.find((i: any) => i.url === 'https://example.com/cleanup-receipt?id=1');
  expect(state.actions.filter((a: any) => a.taskId === item.contextId).map((a: any) => a.text)).toEqual([item.url]);
});

for (const mode of ['tracking', 'all']) test(`Markdown formatting survives ${mode} cleanup when saving and sending`, async ({ page, request }) => {
  const url = `https://example.com/markdown-${mode}?utm_source=x`;
  const clean = `https://example.com/markdown-${mode}`;
  const message = (link: string) => `Read **${link}** and \`${link}\` next.`;
  await page.goto('/#/reading/add');
  await page.getByLabel('Message Hermes', { exact: true }).fill(message(url));
  await page.getByLabel('URL cleanup', { exact: true }).selectOption(mode);
  await expect(page.getByRole('radio')).toHaveCount(0);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase', 'complete');
  const state = await (await request.get('/api/v1/state')).json();
  const item = state.snapshot.reading.items.find((i: any) => i.url === clean);
  expect(item).toBeTruthy();
  expect(state.actions.filter((a: any) => a.taskId === item.contextId).map((a: any) => a.text)).toEqual([message(clean)]);
  await expect(page.locator('.message.from-user strong')).toHaveText(clean);
  await expect(page.locator('.message.from-user code')).toHaveText(clean);
});
