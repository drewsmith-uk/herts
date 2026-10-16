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
