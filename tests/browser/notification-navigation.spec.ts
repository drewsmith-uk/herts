import { detailsField, detailsControl } from './composer-helpers';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const headers = { 'x-tasks-request': '1' };
const agentCalls = async (request: APIRequestContext) => (await (await request.get('http://127.0.0.1:8791/calls')).json() as string[]).filter(m => ['session.create', 'session.resume', 'prompt.submit', 'session.interrupt'].includes(m));
async function reminder(request: APIRequestContext, title: string) {
  const taskId = crypto.randomUUID(), at = Date.now();
  expect((await request.post('/api/v1/sync', { headers, data: { id: crypto.randomUUID(), taskId, kind: 'create', title, at } })).ok()).toBe(true);
  expect((await request.post('/api/v1/sync', { headers, data: { id: crypto.randomUUID(), taskId, kind: 'snooze', baseStatus: 'inbox', baseSnoozeId: null, snoozedUntil: at + 60_000, at } })).ok()).toBe(true);
  const result = await (await request.post('/__test/wake-snoozed', { headers, data: { at: at + 60_000 } })).json();
  return { taskId, id: result.notices.find((n: any) => n.task_id === taskId).id as string };
}
async function ready(page: Page) {
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: 'Notifications on this device' })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}
// Exercise a real transferred MessagePort from the installed worker. Native
// notification-click activation/focus ordering is covered by the worker tests.
async function deliver(page: Page, data: { id?: string; kind?: string }) {
  const worker = page.context().serviceWorkers().find(w => w.url().endsWith('/sw.js'))!;
  expect(worker).toBeTruthy();
  expect(await worker.evaluate(async data => {
    const client = (await (self as any).clients.matchAll({ type: 'window', includeUncontrolled: true }))[0];
    return new Promise<boolean>((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); reject(new Error('No notification acknowledgement')); }, 3000);
      channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data?.accepted === true); };
      client.postMessage({ type: 'OPEN_NOTIFICATION', ...data }, [channel.port2]);
    });
  }, data)).toBe(true);
}

test('the old screen is replaced before the worker receives readiness, even while the destination lookup is pending', async ({ page, request }) => {
  const notice = await reminder(request, 'Prepared reminder');
  await page.addInitScript(() => {
    (window as any).notificationViews = [];
    // Observe the DOM at the exact acknowledgement, before later rendering can
    // conceal a stale-screen flash. This listener is installed before the app's.
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type !== 'OPEN_NOTIFICATION' || !event.ports[0]) return;
      const port = event.ports[0], send = port.postMessage.bind(port);
      port.postMessage = ((data: unknown) => {
        (window as any).notificationViews.push({
          hash: location.hash,
          oldTitle: document.querySelector<HTMLTextAreaElement>('[aria-label="Task title"]')?.value || null,
          opening: document.querySelector('.page-content')?.textContent?.includes('Opening notification…') || false
        });
        send(data);
      }) as typeof port.postMessage;
    });
  });
  await ready(page);
  await deliver(page, { id: notice.id });
  await expect((await detailsField(page, 'Task title'))).toHaveValue('Prepared reminder');
  await page.evaluate(() => { (window as any).notificationViews = []; });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/v1/notifications/${encodeURIComponent(notice.id)}`, async route => { await gate; await route.continue(); });
  try {
    await deliver(page, { id: notice.id });
    expect(await page.evaluate(() => (window as any).notificationViews)).toEqual([
      { hash: `#/notice/${encodeURIComponent(notice.id)}`, oldTitle: null, opening: true }
    ]);
    release(); await expect((await detailsField(page, 'Task title'))).toHaveValue('Prepared reminder');
  } finally { release(); }
});

test('a warm notification switches to its task and test Settings without a document reload or Hermes work', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const first = await reminder(request, 'In-place reminder one'), second = await reminder(request, 'In-place reminder two'), before = await agentCalls(request);
  await ready(page);
  const documentStarted = await page.evaluate(() => performance.timeOrigin), documents: string[] = [];
  page.on('request', request => { if (request.resourceType() === 'document') documents.push(request.url()); });
  await deliver(page, { id: first.id });
  await expect((await detailsField(page, 'Task title'))).toHaveValue('In-place reminder one');
  await deliver(page, { id: second.id });
  await expect(page).toHaveURL(new RegExp(`#/task/${second.taskId}$`));
  await expect((await detailsField(page, 'Task title'))).toHaveValue('In-place reminder two');
  await deliver(page, { kind: 'test' });
  await expect(page.getByRole('heading', { name: 'Notifications on this device' })).toBeVisible();
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentStarted); expect(documents).toEqual([]);
  expect(await agentCalls(request)).toEqual(before);
});

test('a slow notification lookup cannot override a newer tap or manual navigation', async ({ page, request }) => {
  const first = await reminder(request, 'Delayed reminder'), second = await reminder(request, 'Latest reminder');
  await ready(page);
  for (const destination of ['newer', 'manual']) {
    let release!: () => void, finished!: () => void, started = false;
    const gate = new Promise<void>(resolve => { release = resolve; }), done = new Promise<void>(resolve => { finished = resolve; });
    await page.route(`**/api/v1/notifications/${encodeURIComponent(first.id)}`, async route => {
      const response = await route.fetch(); started = true; await gate; await route.fulfill({ response }); finished();
    });
    try {
      await deliver(page, { id: first.id }); await expect.poll(() => started).toBe(true);
      await expect(page.getByText('Opening notification…', { exact: true })).toBeVisible();
      if (destination === 'newer') {
        await deliver(page, { id: second.id }); await expect(page).toHaveURL(new RegExp(`#/task/${second.taskId}$`));
      } else {
        await page.getByRole('link', { name: 'Settings', exact: true }).click(); await expect(page).toHaveURL(/#\/settings$/);
      }
      release(); await done; await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expect(page).toHaveURL(destination === 'newer' ? new RegExp(`#/task/${second.taskId}$`) : /#\/settings$/);
    } finally { release(); await page.unroute(`**/api/v1/notifications/${encodeURIComponent(first.id)}`); }
  }
});

test('notification intent survives offline reload and cold launches wait for the target instead of showing Inbox', async ({ page, context, request }) => {
  const notice = await reminder(request, 'Recovered reminder'); await ready(page);
  await context.setOffline(true);
  try {
    await deliver(page, { id: notice.id }); await expect(page).toHaveURL(new RegExp(`#/notice/${encodeURIComponent(notice.id)}$`));
    await expect(page.getByText('Waiting for a connection to open this notification…')).toBeVisible();
    await page.reload(); await expect(page.getByText('Waiting for a connection to open this notification…')).toBeVisible();
  } finally { await context.setOffline(false); }
  await expect((await detailsField(page, 'Task title'))).toHaveValue('Recovered reminder');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/v1/notifications/${encodeURIComponent(notice.id)}`, async route => { await gate; await route.continue(); });
  try {
    await page.goto(`/?notice=${encodeURIComponent(notice.id)}`);
    await expect(page.getByText('Opening notification…', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Message Hermes', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Notifications on this device' })).toHaveCount(0);
    release(); await expect((await detailsField(page, 'Task title'))).toHaveValue('Recovered reminder');
    expect(new URL(page.url()).search).toBe('');
  } finally { release(); }
});
