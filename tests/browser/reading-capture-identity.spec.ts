import { detailsField, detailsControl } from './composer-helpers';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const agentCalls = async (request: APIRequestContext) => ((await (await request.get('http://127.0.0.1:8791/calls')).json()) as string[]).filter(method => ['session.create', 'session.resume', 'prompt.submit'].includes(method));
const snapshot = async (request: APIRequestContext) => (await request.get('/api/v1/state')).json();

test('a different URL in the title cannot save or send the wrong reading item', async ({ page, request }) => {
  const link = 'https://example.com/actual-post', wrongTitle = 'https://example.com/different-post';
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/reading/add');
  await expect(page.getByLabel('Message Hermes', { exact: true })).toBeEditable();
  const before = await snapshot(request), calls = await agentCalls(request);
  await page.getByLabel('Message Hermes', { exact: true }).fill(link);
  await (await detailsField(page, 'Reading title')).fill(wrongTitle);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('The title is a different link.');
  await expect(page).toHaveURL(/#\/reading\/add$/);
  await expect(page.getByLabel('Message Hermes', { exact: true })).toHaveValue(link);
  await expect((await detailsField(page, 'Reading title'))).toHaveValue(wrongTitle);
  expect((await snapshot(request)).snapshot.reading.items).toEqual(before.snapshot.reading.items);
  expect(await agentCalls(request)).toEqual(calls);
  await page.screenshot({ path: 'output/reading-identity/mismatched-title-390.png' });
  await (await detailsField(page, 'Reading title')).fill('');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase', 'complete');
  await expect((await detailsField(page, 'Reading title'))).toHaveValue('Fixture article');
  await expect((await detailsControl(page, 'link', 'Open original'))).toHaveAttribute('href', link);
  const state = await snapshot(request), item = state.snapshot.reading.items.find((i: any) => i.url === link);
  expect(item.title).toBe('Fixture article');
  expect(state.actions.filter((a: any) => a.taskId === item.contextId).map((a: any) => a.text)).toEqual([link]);
  expect((await agentCalls(request)).slice(calls.length)).toEqual(['session.create', 'prompt.submit']);
});

test('matching URL titles and descriptive titles remain valid', async ({ page, request }) => {
  for (const [link, title] of [
    ['https://example.com/same-post?q=1#part', 'https://EXAMPLE.com:443/same-post?q=1#part'],
    ['https://example.com/named-post', 'Notes about the new research'],
  ]) {
    await page.goto('/#/reading/add');
    await page.getByLabel('Message Hermes', { exact: true }).fill(link);
    await (await detailsField(page, 'Reading title')).fill(title);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase', 'complete');
    await expect((await detailsField(page, 'Reading title'))).toHaveValue(title);
    const state = await snapshot(request), item = state.snapshot.reading.items.find((i: any) => i.url === link);
    expect(item.title).toBe(title);
    expect(state.actions.filter((a: any) => a.taskId === item.contextId).map((a: any) => a.text)).toEqual([link]);
  }
});

async function deliver(page: Page, id: string) {
  const worker = page.context().serviceWorkers().find(w => w.url().endsWith('/sw.js'))!;
  expect(await worker.evaluate(async id => {
    const client = (await (self as any).clients.matchAll({ type: 'window', includeUncontrolled: true }))[0];
    return new Promise<boolean>((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); reject(new Error('Notification was not acknowledged')); }, 3000);
      channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data?.accepted === true); };
      client.postMessage({ type: 'OPEN_NOTIFICATION', id }, [channel.port2]);
    });
  }, id)).toBe(true);
}

test('successive shared links keep separate titles, messages and notification destinations', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const links = ['https://example.com/first-shared-post', 'https://example.com/second-shared-post'];
  const captures: { item: any; notice: string }[] = [];
  for (const [index, link] of links.entries()) {
    const sharedTitle = index === 0 ? link : 'Second shared post';
    await page.goto(`/share?title=${encodeURIComponent(sharedTitle)}&text=${encodeURIComponent(link)}`);
    await page.getByRole('button', { name: 'Reading', exact: true }).click();
    await expect(page.getByLabel('Message Hermes', { exact: true })).toHaveValue(link);
    await expect((await detailsField(page, 'Reading title'))).toHaveValue(index === 0 ? '' : sharedTitle);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase', 'complete');
    await expect(page.locator('.offline-controls')).toContainText('Available offline');
    const state = await snapshot(request), item = state.snapshot.reading.items.find((i: any) => i.url === link);
    const action = state.actions.find((a: any) => a.taskId === item.contextId);
    expect(item.title).toBe(index === 0 ? 'Fixture article' : sharedTitle); expect(action.text).toBe(link);
    captures.push({ item, notice: `${action.id}:complete` });
  }
  expect(captures[0].item.contextId).not.toBe(captures[1].item.contextId);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const before = await agentCalls(request);
  for (const { item, notice } of captures) {
    expect((await (await request.get(`/api/v1/notifications/${notice}`)).json()).route).toBe(`/reading-item/${item.id}`);
    await deliver(page, notice);
    await expect((await detailsField(page, 'Reading title'))).toHaveValue(item.title);
    await expect((await detailsControl(page, 'link', 'Open original'))).toHaveAttribute('href', item.url);
    await expect(page.locator('.message.from-user .markdown a')).toHaveAttribute('href', item.url);
    await expect(page.getByRole('button', { name: `Open reading item: ${item.url}`, exact: true })).toBeVisible();
  }
  const first = captures[0];
  await page.goto(`/?notice=${encodeURIComponent(first.notice)}`);
  await expect((await detailsField(page, 'Reading title'))).toHaveValue(first.item.title);
  await expect(page.locator('.message.from-user .markdown a')).toHaveAttribute('href', first.item.url);
  expect(await agentCalls(request)).toEqual(before);
});
