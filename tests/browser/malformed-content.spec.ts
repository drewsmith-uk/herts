import { test, expect } from '@playwright/test';

for (const width of [390, 1280]) test(`malformed links and file references leave navigation and messages usable at ${width}px`, async ({ page, request }) => {
  await page.setViewportSize({ width, height: 844 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const before = await (await request.get('http://127.0.0.1:8791/calls')).json();
  for (const route of ['/conversation/%', '/conversation/%E0%A4%A', '/conversation/%00', '/conversation/']) {
    await page.goto('/#' + route);
    await expect(page.getByRole('heading', { name: 'Invalid conversation link' })).toBeVisible();
    await page.getByRole('link', { name: 'Go to Conversations', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Conversations', exact: true })).toBeVisible();
  }
  const id = `malformed-${crypto.randomUUID()}`;
  for (const text of ['Before the damaged attachment.', 'A bad [reference](file:///tmp/%E0%A4%A.txt) and [valid attachment](file:///tmp/report%20one.pdf).', 'After the damaged attachment.'])
    expect((await request.post('/__test/conversation-message', { headers: { 'x-herts-request': '1' }, data: { id, title: 'Attachment recovery', text } })).ok()).toBe(true);
  await page.goto('/#/conversation/' + id);
  await expect(page.getByText('After the damaged attachment.', { exact: true })).toBeVisible();
  await expect(page.locator('.message-file').getByText('report one.pdf', { exact: true })).toBeVisible();
  await page.getByLabel('Message Hermes', { exact: true }).fill('An unsent draft remains editable.');
  await page.reload();
  await expect(page.getByLabel('Message Hermes', { exact: true })).toHaveValue('An unsent draft remains editable.');
  await expect(page.getByText('Before the damaged attachment.', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  const after = await (await request.get('http://127.0.0.1:8791/calls')).json();
  expect(after.slice(before.length).filter((method: string) => ['session.create', 'session.resume', 'prompt.submit', 'session.interrupt'].includes(method))).toEqual([]);
});
