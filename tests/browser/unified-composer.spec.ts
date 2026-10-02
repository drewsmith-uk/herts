import { test, expect, type Page } from '@playwright/test';

const execution = async (request: any) => (await (await request.get('http://127.0.0.1:8791/calls')).json() as string[]).filter(m => ['session.create', 'session.resume', 'prompt.submit'].includes(m));
async function openEditor(page: Page) {
  const open = page.getByRole('button', { name: /^(Message Hermes|Continue draft)…$/ });
  if (await open.isVisible()) await open.click();
  await expect(page.getByLabel('Message Hermes', { exact: true })).toBeEditable();
}
for (const width of [390, 1280]) {
  test(`one reviewed composer saves task, link and conversation without sending at ${width}px`, async ({ page, request, context }) => {
    await page.setViewportSize({ width, height: 844 });
    const before = await execution(request);
    await page.goto('/'); await openEditor(page);
    const message = `Review task ${width}`;
    await page.getByLabel('Message Hermes', { exact: true }).fill(message);
    await page.getByRole('button', { name: 'Save to Inbox', exact: true }).click();
    await expect(page.getByRole('link', { name: message, exact: true })).toBeVisible();
    await page.getByRole('link', { name: message, exact: true }).click();
    await expect(page.getByLabel('Message Hermes', { exact: true })).toHaveValue(message);
    await expect(page.getByRole('button', { name: 'Dictate', exact: true })).toBeVisible();
    await page.goto('/#/reading/add'); await openEditor(page);
    await page.getByLabel('Message Hermes', { exact: true }).fill(`Review this before sending https://example.com/review-${width}`);
    await page.getByRole('button', { name: 'Save link', exact: true }).click();
    await expect(page).toHaveURL(/#\/reading$/);
    await page.getByRole('link', { name: new RegExp(`example.com/review-${width}`) }).first().click();
    await expect(page.getByLabel('Message Hermes', { exact: true })).toHaveValue(`Review this before sending https://example.com/review-${width}`);
    await page.goto('/#/new'); await openEditor(page);
    await page.getByLabel('Message Hermes', { exact: true }).fill(`Conversation draft ${width}`);
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.locator('.conversation-drafts')).toContainText(`Conversation draft ${width}`);
    await page.locator('.conversation-drafts .draft-open').filter({ hasText: `Conversation draft ${width}` }).click();
    await expect(page.getByLabel('Message Hermes', { exact: true })).toHaveValue(`Conversation draft ${width}`);
    expect(await execution(request)).toEqual(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`voice produces an editable draft, with no automatic send at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/#/new'); await openEditor(page);
    const before = await execution(request);
    await page.getByRole('button', { name: 'Dictate', exact: true }).click();
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: 'Stop recording and transcribe' }).click();
    await expect(page.getByLabel('Message Hermes', { exact: true })).toHaveValue('Please draft a packing list.');
    await page.waitForTimeout(5500);
    expect(await execution(request)).toEqual(before);
    await expect(page.locator('.countdown')).toHaveCount(0);
    await page.getByLabel('Message Hermes', { exact: true }).fill(`Edited transcript ${width}`);
    await page.getByRole('button', { name: 'Send', exact: true }).dblclick();
    await expect.poll(async () => (await execution(request)).slice(before.length).filter(m => m === 'prompt.submit').length).toBe(1);
    await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase', 'complete');
  });

  test(`history stays mounted, retains older pages and anchors refresh at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 844 });
    const conversation = `unified-history-${width}`;
    let release!: () => void;
    const opened = new Promise<void>(resolve => { release = resolve; });
    await page.route(`**/api/v1/conversations/${conversation}/context`, async route => { await opened; await route.continue(); });
    await page.goto(`/#/conversation/${conversation}`);
    await expect(page.locator(`[data-history-message="${conversation}:450"]`)).toBeInViewport();
    const history = await page.locator('.history').elementHandle();
    release(); await expect(page.getByLabel('Message Hermes')).toBeEditable();
    expect(await history!.evaluate(el => el === document.querySelector('.history'))).toBe(true);
    const viewport = page.locator('.conversation-scroll');
    const header = await page.locator('.conversation-page-header').boundingBox();
    await viewport.evaluate(el => { el.scrollTop = 0; });
    const anchor = page.locator(`[data-history-message="${conversation}:251"]`);
    const top = await anchor.evaluate(el => el.getBoundingClientRect().top);
    await page.getByRole('button', { name: 'Load older messages', exact: true }).click();
    await expect(page.locator('.message')).toHaveCount(400);
    await expect.poll(async () => Math.abs(await anchor.evaluate(el => el.getBoundingClientRect().top) - top)).toBeLessThan(5);
    await page.getByRole('button', { name: 'Refresh conversation history' }).click();
    await expect(page.locator('.message')).toHaveCount(400);
    await expect.poll(async () => Math.abs(await anchor.evaluate(el => el.getBoundingClientRect().top) - top)).toBeLessThan(5);
    expect(await page.locator('.conversation-page-header').boundingBox()).toEqual(header);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await page.screenshot({ path: `test-results/unified-history-${width}.png` });
  });
}

test('opening an empty editor creates no listed draft, while shared edits are sent verbatim', async ({ page, request }) => {
  await page.goto('/#/new'); await openEditor(page);
  await page.getByRole('link', { name: 'Back to Conversations', exact: true }).click();
  await expect(page.locator('.conversation-drafts')).toHaveCount(0);
  await page.goto('/share?title=Shared%20review&text=Please%20review%20https%3A%2F%2Fexample.com%2Fshared-review');
  await page.getByRole('button', { name: 'Reading', exact: true }).click();
  const edited = 'My edited instruction https://example.com/shared-review';
  await expect(page.getByLabel('Message Hermes', { exact: true })).toHaveValue('Please review https://example.com/shared-review');
  await page.getByLabel('Message Hermes', { exact: true }).fill(edited);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase', 'complete');
  const state = await (await request.get('/api/v1/state')).json();
  expect(state.actions.some((action: any) => action.kind === 'send' && action.text === edited)).toBe(true);
});

test('offline saving keeps Send explicit and preserves message plus attachment on reload', async ({ page, context, request }) => {
  await page.goto('/#/new'); await openEditor(page); await page.evaluate(() => navigator.serviceWorker.ready);
  await page.getByLabel('Message Hermes', { exact: true }).fill('Offline reviewed message');
  await page.locator('input[type=file]').setInputFiles({ name: 'review.txt', mimeType: 'text/plain', buffer: Buffer.from('review attachment') });
  await expect(page.locator('.attachment')).toContainText('review.txt');
  const before = await execution(request);
  await context.setOffline(true);
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.locator('.draft-open').filter({ hasText: 'Offline reviewed message' }).click();
  await page.reload();
  await expect(page.getByLabel('Message Hermes', { exact: true })).toHaveValue('Offline reviewed message');
  await expect(page.locator('.attachment')).toContainText('review.txt');
  await context.setOffline(false);
  await expect(page.locator('.save-state')).toContainText('Changes synced');
  expect(await execution(request)).toEqual(before);
});

test('legacy task text, attachments and saved recordings migrate together without sending', async ({ page, request }) => {
  await page.goto('/'); await expect(page.getByLabel('Message Hermes')).toBeEditable();
  const before = await execution(request);
  await page.evaluate(async () => {
    const r = indexedDB.open('hermes-tasks');
    const db = await new Promise<IDBDatabase>(resolve => { r.onsuccess = () => resolve(r.result); });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['pluginLocal', 'files', 'recordings', 'kv'], 'readwrite');
      const catalogue = tx.objectStore('kv').get('plugins');
      catalogue.onsuccess = () => {
        const generation = catalogue.result.value.catalogue.entries.find((e: any) => e.manifest.id === 'tasks').generation;
        const fileId = crypto.randomUUID(), recordingId = crypto.randomUUID();
        tx.objectStore('files').put({ id: fileId, name: 'legacy.txt', type: 'text/plain', blob: new Blob(['Legacy attachment']), at: Date.now() });
        tx.objectStore('pluginLocal').put({ key: `tasks:${generation}:draft:capture:00000000-0000-4000-8000-000000000001`, value: { id: 'capture:00000000-0000-4000-8000-000000000001', text: 'Legacy capture for review', files: [fileId] } });
        tx.objectStore('recordings').put({ id: recordingId, owner: `plugin:tasks:${generation}:capture:00000000-0000-4000-8000-000000000001`, chunks: [new Blob(['synthetic audio'])], type: 'audio/webm', complete: true, at: Date.now() });
      };
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    }); db.close();
  });
  await page.reload();
  await expect(page.getByLabel('Message Hermes')).toHaveValue('Legacy capture for review');
  await expect(page.locator('.attachment')).toContainText('legacy.txt');
  await expect(page.getByRole('button', { name: 'Transcribe saved recording', exact: true })).toBeVisible();
  expect(await execution(request)).toEqual(before);
});

test('a phone keyboard leaves the message and Send usable, and collapsing keeps the draft', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/conversation/existing');
  const text = Array.from({ length: 20 }, (_, i) => `Reviewed line ${i}`).join('\n');
  await page.getByLabel('Message Hermes').fill(text);
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 480 });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect(page.locator('body')).toHaveClass(/keyboard-open/);
  const composer = page.getByLabel('Message Hermes'), send = page.getByRole('button', { name: 'Send', exact: true });
  expect((await composer.boundingBox())!.height).toBeLessThanOrEqual(121);
  expect((await send.boundingBox())!.y + (await send.boundingBox())!.height).toBeLessThanOrEqual(480);
  await expect(page.locator('.mobile-nav')).toBeHidden();
  expect(await page.locator('.conversation-scroll').evaluate(el => el.clientHeight)).toBeGreaterThanOrEqual(64);
  await page.evaluate(() => { Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 844 }); window.visualViewport!.dispatchEvent(new Event('resize')); });
  await page.getByRole('button', { name: 'Collapse message box' }).click();
  await expect(page.locator('.composer-docked')).toHaveClass(/is-collapsed/);
  await expect(composer).toHaveValue(text);
  await page.reload(); await expect(composer).toHaveValue(text);
});

test('a confirmed send with a lost acknowledgement clears only its submitted draft', async ({ page, request }) => {
  await page.goto('/#/new'); await expect(page.getByLabel('Message Hermes')).toBeEditable();
  const before = await execution(request);
  await page.route('**/api/v1/actions', async route => { await route.fetch(); await route.abort(); });
  await page.getByLabel('Message Hermes').fill('Reviewed message with a lost acknowledgement');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase', 'complete');
  await expect(page.getByLabel('Message Hermes')).toHaveValue('');
  await page.reload(); await expect(page.getByLabel('Message Hermes')).toHaveValue('');
  expect((await execution(request)).slice(before.length).filter(method => method === 'prompt.submit')).toHaveLength(1);
});

test('typing keeps focus and uses the completed message as the conversation title', async ({ page, request }) => {
  await page.goto('/#/new');
  const editor = page.getByLabel('Message Hermes');
  await expect(editor).toBeEditable();
  await editor.pressSequentially('Typing remains uninterrupted', { delay: 25 });
  await expect(editor).toBeFocused(); await expect(editor).toHaveValue('Typing remains uninterrupted');
  await expect(page).toHaveURL(/#\/draft\//);
  await page.goto('/#/new');
  await expect(editor).toHaveValue('');
  await editor.fill('A separate unsent idea');
  await page.goto('/#/conversations');
  await expect(page.locator('.draft-open')).toHaveCount(2);
  await page.locator('.draft-open').filter({ hasText: 'Typing remains uninterrupted' }).click();
  await editor.focus(); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase', 'complete');
  const state = await (await request.get('/api/v1/state')).json();
  expect(state.snapshot.contexts.some((c: any) => c.link && c.title === 'Typing remains uninterrupted')).toBe(true);
});

for (const width of [390, 1280]) test(`refresh preserves a reader's first page after a burst of replies at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  let count = 450;
  await page.route('**/api/v1/conversations/long-history/history**', route => {
    const offset = Number(new URL(route.request().url()).searchParams.get('offset') || 0), start = Math.max(0, count - offset - 200), end = Math.max(0, count - offset);
    return route.fulfill({ json: { sessionId: 'long-history', order: 'latest', offset, hasMore: start > 0, fetchedAt: Date.now(), messages: Array.from({ length: end - start }, (_, n) => ({ id: start + n + 1, role: n % 2 ? 'assistant' : 'user', content: `Stable message ${start + n + 1}` })) } });
  });
  await page.goto('/#/conversation/long-history');
  await expect(page.locator('[data-history-message="long-history:450"]')).toBeInViewport();
  const viewport = page.locator('.conversation-scroll');
  await viewport.evaluate(el => { el.scrollTop = 0; });
  const anchor = page.locator('[data-history-message="long-history:251"]');
  await expect(anchor).toBeInViewport();
  const top = await anchor.evaluate(el => el.getBoundingClientRect().top);
  count += 401;
  await page.getByRole('button', { name: 'Refresh conversation history' }).click();
  await expect(page.locator('.message').last()).toContainText('Stable message 851');
  await expect.poll(async () => Math.abs(await anchor.evaluate(el => el.getBoundingClientRect().top) - top)).toBeLessThan(5);
});
