import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const state = async (request: APIRequestContext) => (await request.get('/api/v1/state')).json();
const calls = async (request: APIRequestContext) => ((await (await request.get('http://127.0.0.1:8791/calls')).json()) as string[]).filter(method => ['session.create', 'session.resume', 'prompt.submit', 'approval.respond', 'session.interrupt'].includes(method));
async function savedDraft(page: Page, id: string, text: string) {
  await expect.poll(() => page.evaluate(async ({ id, text }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('hermes-tasks'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try { return await new Promise<boolean>((resolve, reject) => { const r = db.transaction('drafts').objectStore('drafts').get(id); r.onsuccess = () => resolve(r.result?.text === text); r.onerror = () => reject(r.error); }); }
    finally { db.close(); }
  }, { id, text })).toBe(true);
}

for (const width of [390, 1280]) test(`continues a conversation directly with approvals and stop controls on ${width}px`, async ({ page, request }) => {
  await page.setViewportSize({ width, height: 844 });
  const before = await state(request), beforeCalls = await calls(request), id = `standalone-${width}`;
  await page.goto('/#/conversations');
  await page.getByLabel('Search conversations').fill(`Direct conversation ${id}`);
  await page.getByRole('link', { name: new RegExp(`Direct conversation ${id}`) }).click();
  await expect(page.getByLabel('Message Hermes')).toBeEditable();
  await expect(page.getByLabel('Conversation title', { exact: true })).toHaveValue(`Direct conversation ${id}`);
  await expect(page.getByLabel('Conversation title', { exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0);
  expect(await calls(request)).toEqual(beforeCalls);
  await page.getByLabel('Message Hermes').fill(`Please ask approval from ${width}.`);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.conversation-status')).toContainText('Needs your input');
  await expect(page.locator('.history .message.from-user')).toContainText(`Please ask approval from ${width}.`);
  await expect(page.getByRole('button', { name: 'Approve once', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Deny', exact: true })).toBeEnabled();
  const url = page.url(); await page.goto('/#/conversations'); await page.goto(url);
  await page.getByRole('button', { name: width === 390 ? 'Deny' : 'Approve once', exact: true }).click();
  await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase','complete');
  expect((await calls(request)).slice(beforeCalls.length)).toEqual(['session.resume', 'prompt.submit', 'approval.respond']);
  await page.getByLabel('Message Hermes').fill('Standalone wait for stop');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.conversation-status')).toContainText('Working');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase','stopped');
  const after = await state(request), context = after.snapshot.contexts.find((c: any) => c.aliases.includes(id));
  expect(after.snapshot.tasks).toEqual(before.snapshot.tasks);
  expect(after.snapshot.reading.items).toEqual(before.snapshot.reading.items);
  expect(after.actions.filter((a: any) => a.contextId === context.id && a.kind === 'send')).toHaveLength(2);
  const list = await (await request.get(`/api/v1/conversations?q=${id}`)).json();
  expect(list.conversations).toHaveLength(1); expect(list.conversations[0].linkedTaskId).toBeUndefined();
  expect((await calls(request)).slice(beforeCalls.length)).toEqual(['session.resume', 'prompt.submit', 'approval.respond', 'prompt.submit', 'session.interrupt']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/standalone-conversation-${width}.png`, fullPage: true });
});

test('shares an offline draft, attachment and active work with later reading and task views', async ({ page, context, request }) => {
  const id = 'standalone-shared', before = await calls(request);
  await page.goto(`/#/conversation/${id}`); await expect(page.getByLabel('Message Hermes')).toBeEditable();
  const reference = (await state(request)).snapshot.contexts.find((c: any) => c.aliases.includes(id));
  await page.evaluate(() => navigator.serviceWorker.ready); await page.reload();
  await context.setOffline(true);
  await page.getByLabel('Message Hermes').fill('Saved standalone draft');
  await page.locator('input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Saved attachment') });
  await expect(page.getByRole('button', { name: 'Remove notes.txt' })).toBeVisible();
  await savedDraft(page, reference.id, 'Saved standalone draft'); await page.reload();
  await expect(page.getByLabel('Message Hermes')).toHaveValue('Saved standalone draft');
  await expect(page.getByRole('button', { name: 'Remove notes.txt' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await context.setOffline(false); await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  expect(await calls(request)).toEqual(before);
  await page.getByRole('button', { name: `Save to reading list: https://example.com/${id}`, exact: true }).click();
  await page.getByRole('button', { name: `Open reading item: https://example.com/${id}`, exact: true }).click();
  const readingUrl = page.url();
  await expect(page.getByLabel('Message Hermes')).toHaveValue('Saved standalone draft');
  await expect(page.getByRole('button', { name: 'Remove notes.txt' })).toBeVisible();
  await page.getByLabel('Message Hermes').fill('Please ask approval for this shared conversation.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve once', exact: true })).toBeVisible();
  await page.goto(`/#/conversation/${id}`);
  await expect(page.getByRole('button', { name: 'Approve once', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Make a task', exact: true }).click();
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  const taskUrl = page.url();
  await expect(page.getByRole('button', { name: 'Approve once', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Approve once', exact: true }).click();
  await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase','complete');
  await page.getByLabel('Message Hermes').fill('Same draft in all three views');
  await savedDraft(page, reference.id, 'Same draft in all three views');
  for (const url of [readingUrl, `/#/conversation/${id}`, taskUrl]) {
    await page.goto(url); await expect(page.getByLabel('Message Hermes')).toHaveValue('Same draft in all three views');
    await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase','complete');
  }
  const after = await state(request);
  expect(after.snapshot.contexts.filter((c: any) => c.aliases.includes(id))).toHaveLength(1);
  expect(after.snapshot.tasks.find((t: any) => t.contextId === reference.id)).toBeTruthy();
  expect(after.snapshot.reading.items.find((i: any) => i.url === `https://example.com/${id}`).contextId).toBe(reference.id);
  expect((await calls(request)).slice(before.length)).toEqual(['session.resume', 'prompt.submit', 'approval.respond']);
});

test('recovers a lost conversation-reference response and opens its notification without agent work', async ({ page, request, browser }) => {
  const id = 'standalone-recovery', before = await calls(request);
  await page.route(`**/api/v1/conversations/${id}/context`, async route => { await route.fetch(); await route.abort(); });
  await page.goto(`/#/conversation/${id}`);
  // The ordinary state refresh recovers the idempotent reference even though
  // its HTTP acknowledgement was lost; nothing is sent to Hermes.
  await expect(page.getByLabel('Message Hermes')).toBeEditable();
  const otherContext = await browser.newContext(), other = await otherContext.newPage();
  try {
    await other.goto(`/#/conversation/${id}`); await expect(other.getByLabel('Message Hermes')).toBeEditable();
    const snapshot = (await state(request)).snapshot;
    expect(snapshot.contexts.filter((c: any) => c.aliases.includes(id))).toHaveLength(1);
    expect(snapshot.tasks.some((t: any) => t.link?.key === id)).toBe(false);
    expect(await calls(request)).toEqual(before);
    await other.getByLabel('Message Hermes').fill('Finish this standalone notification check.');
    await other.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(other.locator('.conversation-panel')).toHaveAttribute('data-phase','complete');
    const result = await state(request), ref = result.snapshot.contexts.find((c: any) => c.aliases.includes(id));
    const action = result.actions.find((a: any) => a.contextId === ref.id && a.kind === 'send');
    const notice = `${action.id}:complete`;
    const notification = await request.get(`/api/v1/notifications/${encodeURIComponent(notice)}`);
    expect(notification.ok()).toBe(true); expect((await notification.json()).route).toBe(`/conversation/${id}`);
    const sent = await calls(request);
    await page.goto(`/?notice=${encodeURIComponent(notice)}`);
    await expect(page).toHaveURL(new RegExp(`#/conversation/${id}$`));
    await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase','complete');
    expect(await calls(request)).toEqual(sent);
  } finally { await otherContext.close(); }
});

test('shows saved history and a retry when a new conversation reference is unavailable', async ({ page, request }) => {
  const before = await calls(request);
  await page.route('**/api/v1/conversations/standalone-unavailable/context', route => route.fulfill({ status: 503, json: { error: 'Hermes is temporarily unavailable.' } }));
  await page.goto('/#/conversation/standalone-unavailable');
  await expect(page.getByText('Hermes is temporarily unavailable.', { exact: true })).toBeVisible();
  await expect(page.locator('.message').last()).toContainText('History message 450.');
  await expect(page.getByLabel('Message Hermes')).toHaveCount(0);
  await page.unroute('**/api/v1/conversations/standalone-unavailable/context');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByLabel('Message Hermes')).toBeEditable();
  expect(await calls(request)).toEqual(before);
});
