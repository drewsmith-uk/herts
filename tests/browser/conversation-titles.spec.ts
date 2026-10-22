import { saveTitle, detailsField, detailsControl, closePageActions } from './composer-helpers';
import { test, expect } from '@playwright/test';

test('multiple new conversations can share an opening message and titles can be edited without agent work', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = async (): Promise<string[]> => (await request.get('http://127.0.0.1:8791/calls')).json();
  const before = await calls();
  for (let i = 0; i < 2; i++) {
    await page.goto('/#/new');
    await expect((await detailsField(page, 'Conversation title'))).toHaveValue('New conversation');
    await closePageActions(page); await page.getByLabel(/^(Message Hermes|Add a task)$/).fill('Plan a new weekend away');
    await closePageActions(page); await page.getByRole('button', { name: /^(Send|Send to Hermes)$/, exact: true }).click();
    await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase','complete');
    await expect((await detailsField(page, 'Conversation title'))).toHaveValue(`Plan a new weekend away${i ? ' (2)' : ''}`);
  }
  const after = await calls();
  expect(after.slice(before.length).filter(method => method === 'session.create')).toHaveLength(2);
  expect(after.slice(before.length).filter(method => method === 'prompt.submit')).toHaveLength(2);
  const title = (await detailsField(page, 'Conversation title'));
  await detailsField(page, 'Conversation title'); await title.fill('Ideas for our weekend'); await saveTitle(page);
  await expect((await detailsField(page, 'Conversation title'))).toBeEnabled(); await page.reload();
  await detailsField(page, 'Conversation title'); await expect(title).toHaveValue('Ideas for our weekend');
  await page.goto('/#/conversations'); await page.getByRole('link', { name: /Ideas for our weekend/ }).click();
  await detailsField(page, 'Conversation title'); await title.fill('Updated weekend ideas'); await saveTitle(page);
  await expect((await detailsField(page, 'Conversation title'))).toBeEnabled(); await page.reload(); await detailsField(page, 'Conversation title'); await expect(title).toHaveValue('Updated weekend ideas');
  expect((await calls()).slice(after.length).filter(method => ['session.create', 'session.resume', 'prompt.submit'].includes(method))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('an edited draft title persists and a click on Send waits for its title save', async ({ page, request }) => {
  await page.goto('/#/new'); const title = (await detailsField(page, 'Conversation title'));
  await detailsField(page, 'Conversation title'); await title.fill('Draft conversation name'); await saveTitle(page); await expect((await detailsField(page, 'Conversation title'))).toBeEnabled();
  await page.reload(); await detailsField(page, 'Conversation title'); await expect(title).toHaveValue('Draft conversation name');
  await closePageActions(page); await page.getByLabel(/^(Message Hermes|Add a task)$/).fill('A message for my named conversation');
  await detailsField(page, 'Conversation title'); await title.fill('My chosen conversation name'); await saveTitle(page);
  await closePageActions(page); await page.getByRole('button', { name: /^(Send|Send to Hermes)$/, exact: true }).click();
  await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase','complete');
  await expect((await detailsField(page, 'Conversation title'))).toHaveValue('My chosen conversation name');
  const response = await request.get('/api/v1/conversations?includeLinked=true');
  expect((await response.json()).conversations.some((c: any) => c.title === 'My chosen conversation name')).toBe(true);
});

test('local title edits normalize whitespace and controls before creation and rename', async ({ page }) => {
  await page.goto('/#/new');
  for (const [input, expected] of [
    ['  First\n  draft\u200b\u202e title  ', 'First draft title'],
    ['  Renamed\t  draft\u2066 title  ', 'Renamed draft title'],
    ['\u200b\u202e', 'Renamed draft title'],
  ]) {
    await (await detailsField(page, 'Conversation title')).fill(input);
    await saveTitle(page);
    await page.reload();
    await expect(await detailsField(page, 'Conversation title')).toHaveValue(expected);
    await closePageActions(page);
  }
});

for (const width of [390, 1280]) test(`unfinished title edits survive reload and delayed submission at ${width}px`, async ({ page, context }) => {
  await page.setViewportSize({ width, height: 844 });
  await page.goto('/#/conversations');
  await page.getByLabel('Search conversations').fill(`Direct conversation standalone-${width}`);
  await page.getByRole('link', { name: new RegExp(`Direct conversation standalone-${width}`) }).click();
  await (await detailsField(page, 'Conversation title')).fill(`Saved title ${width}`);
  await saveTitle(page); await closePageActions(page);
  const route = page.url();
  const text = `Unfinished title ${width} with https://example.com/long-reference`;
  await (await detailsField(page, 'Conversation title')).fill(text);
  await page.waitForFunction(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('hermes-tasks'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const rows = await new Promise<any[]>((resolve, reject) => { const r = db.transaction('kv').objectStore('kv').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    db.close();
    return rows.some(row => row.key.startsWith('rename-draft:') && row.value.text.startsWith('Unfinished title'));
  });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true); await page.reload();
  await expect(await detailsField(page, 'Conversation title')).toHaveValue(text);
  await expect(page.getByRole('dialog', { name: 'Rename conversation' }).getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await page.screenshot({ path: `test-results/compat-title-recovery-${width}.png` });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Rename conversation' })).toBeHidden();
  await expect(await detailsField(page, 'Conversation title')).toHaveValue(`Saved title ${width}`);
  await closePageActions(page);
  await context.setOffline(false);
  await page.goto(route);
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/contexts/*/title', async route => { await hold; await route.continue(); });
  const field = await detailsField(page, 'Conversation title'); await field.fill(`Confirmed title ${width}`);
  const dialog = page.getByRole('dialog', { name: 'Rename conversation' });
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(field).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  release(); await expect(dialog).toBeHidden();
});

test('a delayed title acknowledgement retains a newer edit from another window', async ({ page, context }) => {
  await page.goto('/#/conversations');
  await page.getByLabel('Search conversations').fill('Direct conversation standalone-shared');
  await page.getByRole('link', { name: /Direct conversation standalone-shared/ }).click();
  const route = page.url(), other = await context.newPage();
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/contexts/*/title', async route => { const response = await route.fetch(); await hold; await route.fulfill({ response }); });
  await (await detailsField(page, 'Conversation title')).fill('Title waiting for acknowledgement');
  await page.getByRole('dialog', { name: 'Rename conversation' }).getByRole('button', { name: 'Save', exact: true }).click();
  await other.goto(route);
  await (await detailsField(other, 'Conversation title')).fill('Newer edit from another window');
  await other.waitForFunction(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('hermes-tasks'); r.onsuccess = () => resolve(r.result); });
    const rows = await new Promise<any[]>(resolve => { const r = db.transaction('kv').objectStore('kv').getAll(); r.onsuccess = () => resolve(r.result); });
    db.close(); return rows.some(row => row.key.startsWith('rename-draft:') && row.value.text === 'Newer edit from another window');
  });
  release(); await expect(page.getByRole('dialog', { name: 'Rename conversation' })).toBeHidden();
  await other.reload();
  await expect(await detailsField(other, 'Conversation title')).toHaveValue('Newer edit from another window');
  await other.close();
});
