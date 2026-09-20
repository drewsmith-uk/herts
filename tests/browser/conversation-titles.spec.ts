import { test, expect } from '@playwright/test';

test('multiple new conversations can share an opening message and titles can be edited without agent work', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = async (): Promise<string[]> => (await request.get('http://127.0.0.1:8791/calls')).json();
  const before = await calls();
  for (let i = 0; i < 2; i++) {
    await page.goto('/#/new');
    await expect(page.getByLabel('Conversation title', { exact: true })).toHaveValue('New conversation');
    await page.getByLabel('Message Hermes').fill('Plan a new weekend away');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.execution-title')).toContainText('complete');
    await expect(page.getByLabel('Conversation title', { exact: true })).toHaveValue(`Plan a new weekend away${i ? ' (2)' : ''}`);
  }
  const after = await calls();
  expect(after.slice(before.length).filter(method => method === 'session.create')).toHaveLength(2);
  expect(after.slice(before.length).filter(method => method === 'prompt.submit')).toHaveLength(2);
  const title = page.getByLabel('Conversation title', { exact: true });
  await title.fill('Ideas for our weekend'); await title.press('Tab');
  await expect(title).toBeEnabled(); await page.reload();
  await expect(title).toHaveValue('Ideas for our weekend');
  await page.goto('/#/conversations'); await page.getByRole('link', { name: /Ideas for our weekend/ }).click();
  await title.fill('Updated weekend ideas'); await title.press('Tab');
  await expect(title).toBeEnabled(); await page.reload(); await expect(title).toHaveValue('Updated weekend ideas');
  expect((await calls()).slice(after.length).filter(method => ['session.create', 'session.resume', 'prompt.submit'].includes(method))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('an edited draft title persists and a click on Send waits for its title save', async ({ page, request }) => {
  await page.goto('/#/new'); const title = page.getByLabel('Conversation title', { exact: true });
  await title.fill('Draft conversation name'); await title.press('Tab'); await expect(title).toBeEnabled();
  await page.reload(); await expect(title).toHaveValue('Draft conversation name');
  await page.getByLabel('Message Hermes').fill('A message for my named conversation');
  await title.fill('My chosen conversation name');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.execution-title')).toContainText('complete');
  await expect(title).toHaveValue('My chosen conversation name');
  const response = await request.get('/api/v1/conversations?includeLinked=true');
  expect((await response.json()).conversations.some((c: any) => c.title === 'My chosen conversation name')).toBe(true);
});
