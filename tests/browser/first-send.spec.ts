import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

const editor = (page: Page) => page.getByRole('textbox', { name: 'Message Hermes', exact: true });
const send = (page: Page) => page.getByRole('button', { name: 'Send', exact: true });
const execution = async (request: APIRequestContext) => ((await (await request.get('http://127.0.0.1:8791/calls')).json()) as string[])
  .filter(method => ['session.create', 'session.resume', 'prompt.submit'].includes(method));
async function creation(request: APIRequestContext, hold: boolean, fail = false) {
  expect((await request.post('/__test/session-creation', { headers: { 'x-herts-request': '1' }, data: { hold, fail } })).ok()).toBe(true);
}
async function savedDraft(page: Page) {
  return page.evaluate(async () => {
    const id = location.hash.split('/').at(-1)!;
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('hermes-tasks'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try { return await new Promise<{ text: string; files: string[] }>((resolve, reject) => {
      const request = database.transaction('drafts').objectStore('drafts').get(id);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    }); } finally { database.close(); }
  });
}

test.afterEach(async ({ request }) => { await creation(request, false); });

test('first send stays visible through delayed preparation, acknowledgement and history', async ({ page, request }) => {
  const before = await execution(request);
  await creation(request, true);
  await page.goto('/#/new');
  const text = 'Keep the itinerary visible while the conversation opens.';
  await editor(page).fill(text);
  await page.locator('input[type=file]').setInputFiles({ name: 'itinerary.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic itinerary') });
  await expect(page.getByRole('button', { name: 'Remove itinerary.txt' })).toBeVisible();
  let releaseContext!: () => void, releaseReceipt!: () => void, releaseHistory!: () => void;
  const contextGate = new Promise<void>(resolve => { releaseContext = resolve; });
  const receiptGate = new Promise<void>(resolve => { releaseReceipt = resolve; });
  const historyGate = new Promise<void>(resolve => { releaseHistory = resolve; });
  let contextStarted = false;
  await page.route('**/api/v1/contexts', async route => { contextStarted = true; await contextGate; await route.continue(); });
  await page.route('**/api/v1/actions', async route => { const response = await route.fetch(); await receiptGate; await route.fulfill({ response }); });
  await page.route('**/api/v1/conversations/*/history?*', async route => { await historyGate; await route.continue(); });
  try {
    await send(page).click();
    const message = page.locator('.outgoing-message');
    await expect(message).toContainText(text);
    await expect(message).toContainText('1 attachment');
    await expect(message.getByRole('status')).toHaveText('Sending…');
    await expect.poll(() => contextStarted).toBe(true);
    await expect(editor(page)).toHaveValue('');
    await expect(editor(page)).toBeDisabled();
    expect((await savedDraft(page)).text).toBe(text);
    expect((await savedDraft(page)).files).toHaveLength(1);
    await page.locator('.composer').dispatchEvent('submit');
    expect(await execution(request)).toEqual(before);
    releaseContext();
    await expect.poll(async () => (await execution(request)).slice(before.length)).toEqual(['session.create']);
    await expect(message).toContainText(text);
    await expect(page.getByRole('button', { name: 'Check again', exact: true })).toHaveCount(0);
    releaseReceipt();
    await expect(editor(page)).toBeEnabled();
    await expect(editor(page)).toHaveValue('');
    await expect(message).toContainText('preparing conversation');
    await page.reload();
    await expect(message).toContainText(text);
    await expect(message).toContainText('1 attachment');
    await expect(editor(page)).toHaveValue('');
    await creation(request, false);
    await expect(message.getByRole('status')).toHaveText('Sent to Hermes');
    releaseHistory();
    await expect(page.locator('[data-history-message].from-user')).toContainText(text);
    await expect(message).toHaveCount(0);
    expect((await execution(request)).slice(before.length)).toEqual(['session.create', 'prompt.submit']);
  } finally { releaseContext(); releaseReceipt(); releaseHistory(); }
});

test('a rejected first send restores text and attachments for editing and retry', async ({ page, request }) => {
  const before = await execution(request);
  await page.goto('/#/new');
  await editor(page).fill('Keep this draft after a rejected send.');
  await page.locator('input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic notes') });
  await expect(page.getByRole('button', { name: 'Remove notes.txt' })).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/actions', async route => { await gate; await route.fulfill({ status: 409, json: { error: 'Message not sent. Review your draft and try again.' } }); });
  try {
    await send(page).click();
    await expect(page.locator('.outgoing-message')).toContainText('Keep this draft after a rejected send.');
    release();
    await expect(page.getByRole('alert')).toContainText('Message not sent');
    await expect(editor(page)).toHaveValue('Keep this draft after a rejected send.');
    await expect(page.getByRole('button', { name: 'Remove notes.txt' })).toBeVisible();
    expect(await execution(request)).toEqual(before);
    await editor(page).fill('Revised message after reviewing the failure.');
    await page.unroute('**/api/v1/actions');
    await send(page).click();
    await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase', 'complete');
    await expect(page.locator('[data-history-message].from-user')).toContainText('Revised message after reviewing the failure.');
    expect((await execution(request)).slice(before.length)).toEqual(['session.create', 'prompt.submit']);
  } finally { release(); }
});

test('failed conversation creation keeps the first message available for recovery', async ({ page, request }) => {
  const before = await execution(request);
  await creation(request, true);
  await page.goto('/#/new');
  await editor(page).fill('Recover this message if conversation creation fails.');
  await send(page).click();
  await expect.poll(async () => (await execution(request)).slice(before.length)).toEqual(['session.create']);
  await creation(request, false, true);
  await expect(page.locator('.outgoing-message')).toContainText('Recover this message if conversation creation fails.');
  await expect(page.locator('.submission-status')).toHaveText('Not sent');
  await page.getByText('Saved message · not sent', { exact: false }).click();
  await page.getByRole('button', { name: 'Use this message', exact: true }).click();
  await expect(editor(page)).toHaveValue('Recover this message if conversation creation fails.');
  await editor(page).fill('Retry this reviewed message.');
  await send(page).click();
  await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase', 'complete');
  expect((await execution(request)).slice(before.length)).toEqual(['session.create', 'session.create', 'prompt.submit']);
});

test('an unconfirmed first send keeps its message offline without repeating the request', async ({ page, context, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const before = await execution(request);
  let attempts = 0;
  await page.route('**/api/v1/actions', async route => { attempts++; await route.abort(); });
  await page.goto('/#/new');
  const text = 'Check receipt before sending this message again.';
  await editor(page).fill(text);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await send(page).click();
  await expect(page.getByRole('button', { name: 'Check again', exact: true })).toBeVisible();
  await expect(page.locator('.outgoing-message')).toContainText(text);
  await expect(page.locator('.composer-note')).toHaveCount(0);
  await editor(page).focus();
  await expect(send(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Check again', exact: true }).click();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.outgoing-message')).toContainText(text);
  await expect(page.getByRole('button', { name: 'Check again', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check again', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'output/first-send/unconfirmed-offline-390.png' });
  await expect(editor(page)).toHaveValue(text);
  expect((await savedDraft(page)).text).toBe(text);
  await editor(page).focus();
  await expect(send(page)).toBeDisabled();
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Check again', exact: true })).toBeVisible();
  expect(attempts).toBe(1);
  expect(await execution(request)).toEqual(before);
});

test('a delayed first-send reply preserves navigation and another draft', async ({ page, request }) => {
  const before = await execution(request);
  await page.goto('/#/new');
  await editor(page).fill('Finish this send after I leave its conversation.');
  let release!: () => void, received = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/actions', async route => {
    const response = await route.fetch(); received = true; await gate; await route.fulfill({ response });
  });
  try {
    await send(page).click();
    await expect.poll(() => received).toBe(true);
    const previousUrl = page.url();
    await page.getByRole('link', { name: 'Back to Conversations', exact: true }).click();
    await page.getByRole('link', { name: 'New conversation', exact: true }).click();
    await editor(page).fill('Keep this separate draft while the earlier receipt arrives.');
    await expect(page).toHaveURL(/#\/draft\//);
    const nextUrl = page.url();
    expect(nextUrl).not.toBe(previousUrl);
    release();
    await expect.poll(async () => (await execution(request)).slice(before.length)).toEqual(['session.create', 'prompt.submit']);
    await expect.poll(async () => page.evaluate(async previousUrl => {
      const id = previousUrl.split('/').at(-1)!;
      const database = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('hermes-tasks'); r.onsuccess = () => resolve(r.result); });
      try { return await new Promise(resolve => { const r = database.transaction('drafts').objectStore('drafts').get(id); r.onsuccess = () => resolve(r.result?.text); }); }
      finally { database.close(); }
    }, previousUrl)).toBe('');
    await expect(page).toHaveURL(nextUrl);
    await expect(editor(page)).toHaveValue('Keep this separate draft while the earlier receipt arrives.');
  } finally { release(); }
});

test('confirmation checks preserve edits and recover automatically without another send', async ({ page, context, request }) => {
  const before = await execution(request);
  const text = 'Recover this accepted message after its reply is lost.';
  let reveal = false, checking = false, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/state', async route => {
    if (reveal) { checking = true; await gate; }
    const response = await route.fetch(), data = await response.json();
    if (!reveal) data.actions = data.actions.filter((action: { text: string }) => action.text !== text);
    await route.fulfill({ response, json: data });
  });
  let sends = 0;
  await page.route('**/api/v1/actions', async route => { sends++; await route.fetch(); await route.abort(); });
  await page.goto('/#/new');
  await editor(page).fill(text);
  await send(page).click();
  const message = page.locator('.outgoing-message');
  await expect(message.getByRole('button', { name: 'Check again', exact: true })).toBeVisible();
  await expect(page.locator('[data-history-message].from-user')).toContainText(text);
  await expect(message).toContainText(text);
  await editor(page).fill('Keep my next draft while the previous message is confirmed.');
  await context.setOffline(true);
  await expect(message.getByRole('button', { name: 'Check again', exact: true })).toBeDisabled();
  reveal = true;
  try {
    await context.setOffline(false);
    await expect.poll(() => checking).toBe(true);
    await expect(message.getByRole('status')).toHaveText('Checking…');
    await expect(send(page)).toBeDisabled();
    release();
    await expect(page.getByRole('button', { name: 'Check again', exact: true })).toHaveCount(0);
    await expect(message).toHaveCount(0);
    await expect(editor(page)).toHaveValue('Keep my next draft while the previous message is confirmed.');
    expect(sends).toBe(1);
    expect((await execution(request)).slice(before.length)).toEqual(['session.create', 'prompt.submit']);
  } finally { release(); }
});

test('a repeated message stays pending while its new attachment uploads', async ({ page, request }) => {
  const before = await execution(request);
  await page.route('**/api/v1/conversations/*/history?*', async route => {
    const response = await route.fetch(), history = await response.json();
    for (const message of history.messages) message.timestamp = Date.now() / 1000 + 60;
    await route.fulfill({ response, json: history });
  });
  await page.goto('/#/new');
  const text = 'Review the plan again.';
  await editor(page).fill(text); await send(page).click();
  await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase', 'complete');
  await expect(page.locator('[data-history-message].from-user')).toContainText(text);
  await expect(page.locator('.outgoing-message')).toHaveCount(0);
  await editor(page).fill(text);
  await page.locator('input[type=file]').setInputFiles({ name: 'revised-plan.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic revision') });
  await expect(page.getByRole('button', { name: 'Remove revised-plan.txt' })).toBeVisible();
  let release!: () => void, uploading = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/uploads', async route => { uploading = true; await gate; await route.continue(); });
  try {
    await send(page).click();
    await expect.poll(() => uploading).toBe(true);
    await expect(page.locator('.outgoing-message')).toContainText(text);
    await expect(page.locator('.outgoing-message')).toContainText('1 attachment');
    await expect(page.locator('.submission-status')).toHaveText('Sending…');
    await expect(editor(page)).toHaveValue('');
    release();
    await expect.poll(async () => (await execution(request)).slice(before.length).filter(method => method === 'prompt.submit').length).toBe(2);
    await expect(page.locator('[data-history-message].from-user')).toHaveCount(2);
    await expect(page.locator('.outgoing-message')).toHaveCount(0);
  } finally { release(); }
});
