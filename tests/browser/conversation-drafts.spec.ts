import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const agentCalls = async (request: APIRequestContext) => ((await (await request.get('http://127.0.0.1:8791/calls')).json()) as string[])
  .filter(method => ['session.create', 'session.resume', 'prompt.submit'].includes(method));

async function createDraft(page: Page, title: string, text: string) {
  await page.goto('/#/new');
  await expect(page).toHaveURL(/#\/draft\//);
  await page.getByLabel('Conversation title', { exact: true }).fill(title);
  await page.getByLabel('Message Hermes').fill(text);
  const id = page.url().split('/').at(-1)!;
  await expect.poll(() => page.evaluate(async ({ id, text, title }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('hermes-tasks'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const transaction = database.transaction(['drafts', 'kv']);
      const read = (store: string, key: string) => new Promise<any>((resolve, reject) => { const request = transaction.objectStore(store).get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const [draft, context] = await Promise.all([read('drafts', id), read('kv', `context:${id}`)]);
      return draft?.text === text && context?.value.title === title;
    } finally { database.close(); }
  }, { id, text, title })).toBe(true);
  return id;
}

for (const width of [320, 1280]) test(`drafts stay above slow Hermes results and reopen offline at ${width}px`, async ({ page, context, request }) => {
  await page.setViewportSize({ width, height: 844 });
  const before = await agentCalls(request);
  const title = `Weekend notes ${width}`, text = `Check the train times before booking ${width}.`;
  const id = await createDraft(page, title, text);
  await page.locator('input[type=file]').setInputFiles({ name: 'itinerary.txt', mimeType: 'text/plain', buffer: Buffer.from('Saved itinerary') });
  await expect(page.getByRole('button', { name: 'Remove itinerary.txt' })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);

  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/conversations?**', async route => { await held; await route.continue(); });
  try {
    await page.goto('/#/conversations');
    const drafts = page.getByRole('region', { name: 'Drafts 1' });
    const link = drafts.getByRole('link', { name: new RegExp(title) });
    await expect(link).toBeInViewport();
    await expect(link).toContainText(text);
    await expect(link).toContainText('1 attachment');
    await expect(page.getByText('Loading conversations…', { exact: true })).toBeVisible();
    await expect(page.locator('.conversation-row')).toHaveCount(0);
    const beforeLoad = (await link.boundingBox())!;
    release();
    await expect(page.locator('.conversation-row').first()).toBeVisible();
    await expect(link).toBeInViewport();
    expect((await link.boundingBox())!.y).toBeCloseTo(beforeLoad.y, 0);
    expect((await drafts.boundingBox())!.y + (await drafts.boundingBox())!.height).toBeLessThan((await page.locator('.conversation-list').boundingBox())!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `output/conversation-drafts/list-${width}.png` });

    await context.setOffline(true);
    await page.reload();
    await expect(link).toBeInViewport();
    await page.getByLabel('Search conversations').fill('train times');
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`#/draft/${id}$`));
    await expect(page.getByLabel('Message Hermes')).toHaveValue(text);
    await expect(page.getByRole('button', { name: 'Remove itinerary.txt' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
    expect(await agentCalls(request)).toEqual(before);
  } finally { release(); await context.setOffline(false); }
});

test('draft search and show-all reach every saved draft without linked-item filters hiding them', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const before = await agentCalls(request);
  const ids = [];
  for (let i = 1; i <= 4; i++) ids.push(await createDraft(page, `Unsent idea ${i}`, `Draft detail number ${i}`));
  await page.goto('/#/conversations');
  const drafts = page.getByRole('region', { name: 'Drafts 4' });
  await expect(drafts.getByRole('link')).toHaveCount(3);
  const more = page.getByRole('button', { name: 'Show all 4 drafts' });
  await expect(more).toBeInViewport();
  await page.screenshot({ path: 'output/conversation-drafts/multiple-390.png' });
  await more.click();
  await expect(drafts.getByRole('link')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Show fewer drafts' })).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('checkbox', { name: 'Show linked conversations' }).check();
  await page.getByRole('checkbox', { name: 'Show hidden items' }).check();
  await expect(drafts.getByRole('link')).toHaveCount(4);
  await page.getByRole('button', { name: 'Show fewer drafts' }).click();

  // Content search includes drafts outside the three-item preview.
  const shown = await drafts.getByRole('link').evaluateAll(links => links.map(link => link.getAttribute('href')));
  const hiddenIndex = ids.findIndex(id => !shown.includes(`#/draft/${id}`));
  await page.getByLabel('Search conversations').fill(`Draft detail number ${hiddenIndex + 1}`);
  const found = page.getByRole('region', { name: 'Drafts 1' });
  await expect(found.getByRole('link')).toHaveCount(1);
  await expect(found.getByRole('link')).toContainText(`Unsent idea ${hiddenIndex + 1}`);
  await expect(page.getByRole('heading', { name: 'No Hermes conversations found' })).toBeVisible();
  await page.getByLabel('Search conversations').fill('No matching title or text');
  await expect(page.getByText('No drafts match this search.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(drafts.getByRole('link')).toHaveCount(3);
  await page.getByLabel('Search conversations').fill(`Unsent idea ${hiddenIndex + 1}`);
  await found.getByRole('link').click();
  await expect(page.getByLabel('Message Hermes')).toHaveValue(`Draft detail number ${hiddenIndex + 1}`);
  expect(await agentCalls(request)).toEqual(before);
});

for (const [theme, width] of [['press', 320], ['nocturne', 390]] as const) test(`drafts remain usable when Hermes fails and previews update in ${theme}`, async ({ page, context, request }) => {
  await page.setViewportSize({ width, height: 844 });
  const before = await agentCalls(request);
  const id = await createDraft(page, 'Local research notes', 'Start with the outline.');
  await page.goto('/#/settings');
  await page.getByLabel('Theme', { exact: true }).selectOption(theme);
  await page.route('**/api/v1/conversations?**', route => route.fulfill({ status: 503, json: { error: 'Hermes is unavailable for this test.' } }));
  await page.goto('/#/conversations');
  const draft = page.getByRole('region', { name: 'Drafts 1' }).getByRole('link');
  await expect(draft).toBeInViewport();
  const error = page.getByRole('alert').filter({ hasText: 'Hermes is unavailable for this test.' });
  await expect(error).toBeVisible();
  expect((await draft.boundingBox())!.y).toBeLessThan((await error.boundingBox())!.y);

  const editor = await context.newPage();
  await editor.goto(`/#/draft/${id}`);
  await editor.getByLabel('Message Hermes').fill('Revised outline with the budget included.');
  await expect(draft).toContainText('Revised outline with the budget included.');
  await editor.close();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `output/conversation-drafts/${theme}-${width}.png` });
  await draft.click();
  await expect(page.getByLabel('Message Hermes')).toHaveValue('Revised outline with the budget included.');
  expect(await agentCalls(request)).toEqual(before);
});

test('a draft leaves the drafts section only after explicitly sending it to Hermes', async ({ page, request }) => {
  const before = await agentCalls(request);
  await createDraft(page, 'Ready for Hermes', 'Please answer this draft.');
  await page.goto('/#/conversations');
  await page.getByRole('region', { name: 'Drafts 1' }).getByRole('link').click();
  expect(await agentCalls(request)).toEqual(before);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase', 'complete');
  await page.goto('/#/conversations');
  await expect(page.getByRole('link', { name: /Ready for Hermes/ })).toBeVisible();
  await expect(page.locator('.conversation-drafts')).toHaveCount(0);
  expect((await agentCalls(request)).slice(before.length)).toEqual(['session.create', 'prompt.submit']);
});

async function localDraftState(page: Page, id: string) {
  return page.evaluate(async id => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('hermes-tasks'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try {
      const transaction = database.transaction(['kv', 'drafts', 'files', 'recordings']);
      const all = (store: string) => new Promise<any[]>((resolve, reject) => { const r = transaction.objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const [kv, drafts, files, recordings] = await Promise.all(['kv', 'drafts', 'files', 'recordings'].map(all));
      return { keys: kv.map(row => row.key), draft: drafts.find(row => row.id === id) || null, files: files.map(row => row.name).sort(), recordings: recordings.map(row => row.owner) };
    } finally { database.close(); }
  }, id);
}

for (const width of [320, 1280]) test(`deletes a chosen draft with confirmation and preserves other drafts at ${width}px`, async ({ page, context, request }) => {
  await page.setViewportSize({ width, height: 844 });
  const before = await agentCalls(request);
  const id = await createDraft(page, 'Discard these notes', 'Remove only this message.');
  await page.locator('input[type=file]').setInputFiles([
    { name: 'private-draft.txt', mimeType: 'text/plain', buffer: Buffer.from('Discard this file') },
    { name: 'shared-note.txt', mimeType: 'text/plain', buffer: Buffer.from('Used by another draft') },
  ]);
  await expect(page.getByRole('button', { name: 'Remove shared-note.txt' })).toBeVisible();
  const keepId = await createDraft(page, 'Keep these notes', 'Keep this message.');
  await page.locator('input[type=file]').setInputFiles({ name: 'keep.txt', mimeType: 'text/plain', buffer: Buffer.from('Keep this file') });
  await expect(page.getByRole('button', { name: 'Remove keep.txt' })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (width === 320) await context.setOffline(true);
  // Include a shared attachment and recoverable voice recording in the cleanup.
  await page.evaluate(async ({ id, keepId }) => {
    const database = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('hermes-tasks'); r.onsuccess = () => resolve(r.result); });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(['drafts', 'files', 'recordings', 'kv'], 'readwrite');
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
        const files = tx.objectStore('files').getAll();
        files.onsuccess = () => { const draft = tx.objectStore('drafts').get(keepId); draft.onsuccess = () => tx.objectStore('drafts').put({ ...draft.result, files: [...draft.result.files, files.result.find((f: any) => f.name === 'shared-note.txt').id] }); };
        tx.objectStore('recordings').put({ id: crypto.randomUUID(), owner: `chat:${id}`, chunks: [new Blob(['voice'])], type: 'audio/webm', at: Date.now(), complete: true });
        tx.objectStore('kv').put({ key: `settings-op:${id}`, value: { contextId: id, input: { id: crypto.randomUUID(), revision: 0, values: { model: 'chosen-model' } } } });
      });
    } finally { database.close(); }
  }, { id, keepId });
  await page.goto('/#/conversations');
  const remove = page.getByRole('button', { name: 'Delete draft: Discard these notes', exact: true });
  await expect(remove).toBeInViewport();
  await remove.click();
  const dialog = page.getByRole('dialog', { name: 'Delete draft?' });
  await expect(dialog).toContainText('Discard these notes');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(remove).toBeFocused();
  expect((await localDraftState(page, id)).draft.text).toBe('Remove only this message.');
  await remove.click();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Drafts 2' })).toBeVisible();
  await remove.click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `output/draft-deletion/confirm-${width}.png` });
  await dialog.getByRole('button', { name: 'Delete draft', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Drafts 1' })).toBeVisible();
  await expect(remove).toHaveCount(0);
  const deleted = await localDraftState(page, id);
  expect(deleted.draft).toBeNull();
  expect(deleted.keys).toContain(`context-draft-deleted:${id}`);
  for (const key of [`context:${id}`, `context-draft:${id}`, `settings-op:${id}`]) expect(deleted.keys).not.toContain(key);
  expect(deleted.files).toEqual(['keep.txt', 'shared-note.txt']);
  expect(deleted.recordings).not.toContain(`chat:${id}`);
  await page.reload();
  await expect(remove).toHaveCount(0);
  await page.getByRole('region', { name: 'Drafts 1' }).getByRole('link').click();
  await expect(page.getByLabel('Message Hermes')).toHaveValue('Keep this message.');
  await expect(page.getByRole('button', { name: 'Remove shared-note.txt' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove keep.txt' })).toBeVisible();
  await page.goto(`/#/draft/${id}`);
  await expect(page.getByRole('heading', { name: 'Draft unavailable' })).toBeVisible();
  await expect(page.getByLabel('Message Hermes')).toHaveCount(0);
  await context.setOffline(false); await page.reload();
  await expect(page.getByRole('heading', { name: 'Draft unavailable' })).toBeVisible();
  expect((await localDraftState(page, id)).draft).toBeNull();
  expect(await agentCalls(request)).toEqual(before);
});

test('deleting the last draft closes its editor in another tab and stale links stay deleted', async ({ page, context, request }) => {
  const before = await agentCalls(request);
  const id = await createDraft(page, 'Draft open elsewhere', 'A message that should stay deleted.');
  const editor = await context.newPage();
  await editor.goto(`/#/draft/${id}`);
  await expect(editor.getByLabel('Message Hermes')).toHaveValue('A message that should stay deleted.');
  await page.goto('/#/conversations');
  await page.getByLabel('Search conversations').fill('Draft open elsewhere');
  await page.getByRole('button', { name: 'Delete draft: Draft open elsewhere', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete draft', exact: true }).click();
  await expect(page.locator('.conversation-drafts')).toHaveCount(0);
  await expect(editor.getByRole('heading', { name: 'Draft unavailable' })).toBeVisible();
  await expect(editor.getByLabel('Message Hermes')).toHaveCount(0);
  await editor.reload();
  await expect(editor.getByRole('heading', { name: 'Draft unavailable' })).toBeVisible();
  await editor.close();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await page.reload();
  await expect(page.locator('.conversation-row').first()).toBeVisible();
  await expect(page.locator('.conversation-drafts')).toHaveCount(0);
  await page.getByRole('link', { name: 'New conversation', exact: true }).click();
  await expect(page.getByLabel('Message Hermes')).toBeEditable();
  expect(page.url()).not.toContain(id);
  expect(await agentCalls(request)).toEqual(before);
});

test('an unconfirmed send prevents deletion without discarding the draft', async ({ page, context }) => {
  const id = await createDraft(page, 'Check this send first', 'Preserve this unconfirmed message.');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.evaluate(async id => {
    const database = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('hermes-tasks'); r.onsuccess = () => resolve(r.result); });
    try { await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('submissions', 'readwrite'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
      const actionId = crypto.randomUUID(); tx.objectStore('submissions').put({ id: actionId, input: { id: actionId, contextId: id, kind: 'send', text: 'Preserve this unconfirmed message.', uploadIds: [] }, at: Date.now(), confirmed: false });
    }); } finally { database.close(); }
  }, id);
  await page.goto('/#/conversations');
  await page.getByRole('button', { name: 'Delete draft: Check this send first' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Delete draft', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('A send is still in progress or unconfirmed');
  expect((await localDraftState(page, id)).draft.text).toBe('Preserve this unconfirmed message.');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Drafts 1' })).toBeVisible();
});

test('cached failed send attempts do not bring a deleted local draft back', async ({ page, context }) => {
  const id = await createDraft(page, 'Earlier failed send', 'Delete this revised draft.');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.evaluate(async id => {
    const database = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('hermes-tasks'); r.onsuccess = () => resolve(r.result); });
    try { await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('kv', 'readwrite'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
      const state = tx.objectStore('kv').get('state'); state.onsuccess = () => {
        const value = state.result.value;
        value.snapshot.contexts.push({ id, title: 'Earlier failed send', link: null, aliases: [] });
        value.actions.push({ id: crypto.randomUUID(), taskId: id, kind: 'send', state: 'failed', phase: 'failed', text: 'Earlier rejected attempt', uploadIds: [], createdAt: Date.now(), updatedAt: Date.now(), receipt: 'rejected', error: 'Preparation failed.' });
        tx.objectStore('kv').put({ key: 'state', value });
      };
    }); } finally { database.close(); }
  }, id);
  await page.goto('/#/conversations'); await page.reload();
  await page.getByRole('button', { name: 'Delete draft: Earlier failed send' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete draft', exact: true }).click();
  await expect(page.locator('.conversation-drafts')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Conversations', exact: true })).toBeVisible();
  await expect(page.locator('.conversation-drafts')).toHaveCount(0);
  expect((await localDraftState(page, id)).draft).toBeNull();
  await page.goto(`/#/draft/${id}`);
  await expect(page.getByRole('heading', { name: 'Draft unavailable' })).toBeVisible();
});

test('a stale deletion confirmation protects a conversation sent from another tab', async ({ page, context, request }) => {
  const before = await agentCalls(request);
  const id = await createDraft(page, 'Send before deleting', 'Send this message from the other tab.');
  await page.goto('/#/conversations');
  await page.getByRole('button', { name: 'Delete draft: Send before deleting' }).click();
  const editor = await context.newPage();
  await editor.goto(`/#/draft/${id}`);
  await editor.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(editor.locator('.conversation-panel')).toHaveAttribute('data-phase', 'complete');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Delete draft', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('This draft is now a Hermes conversation');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('link', { name: /Send before deleting/ })).toBeVisible();
  expect((await localDraftState(page, id)).keys).not.toContain(`context-draft-deleted:${id}`);
  expect((await agentCalls(request)).slice(before.length)).toEqual(['session.create', 'prompt.submit']);
});
