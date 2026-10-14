import { expect, type APIRequestContext, type Page } from '@playwright/test';
export async function pinnedPlugin(request: APIRequestContext, action: 'enable' | 'disable' | 'reset') {
  const { catalogue } = await (await request.get('/api/v1/plugins')).json();
  expect((await request.post('/api/v1/plugins/pinned/manage', { headers: { 'x-herts-request': '1' }, data: { action, revision: catalogue.revision, ...(action === 'reset' ? { confirmation: 'Pinned' } : {}) } })).ok()).toBe(true);
}
export async function pinnedReady(page: Page) {
  await page.goto('/#/plugins/pinned');
  await expect(page.getByRole('heading', { name: /^Pinned/ })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect.poll(() => page.evaluate(async () => {
    try { await (globalThis as any).__HERTS_PLUGIN_RUNTIME__.sdk.pluginNotifications('pinned').ready(); return true; } catch { return false; }
  })).toBe(true);
}
export async function seedPin(page: Page, title = 'Synthetic pinned conversation', key = crypto.randomUUID(), body = 'Pinned') {
  return page.evaluate(async ({ title, key, body }) => (globalThis as any).__HERTS_PLUGIN_RUNTIME__.sdk.pluginNotifications('pinned').set({ key, title, body, route: '/conversation/existing', restoreOnDismiss: true, metadata: { identities: [key] } }, null), { title, key, body });
}
export async function savedPins(page: Page) {
  return page.evaluate(async () => (globalThis as any).__HERTS_PLUGIN_RUNTIME__.sdk.pluginNotifications('pinned').list());
}
export async function notices(page: Page) {
  return page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).filter(n => n.data?.kind === 'device-plugin').map(n => ({ title: n.title, body: n.body, data: n.data })));
}
export async function dismissPins(page: Page) {
  const worker = page.context().serviceWorkers().find(worker => worker.url().endsWith('/sw.js'))!;
  await worker.evaluate(async () => {
    const scope = self as any, work: Promise<unknown>[] = [];
    const notifications = await scope.registration.getNotifications();
    for (const notification of notifications.filter((n: any) => n.data?.kind === 'device-plugin')) {
      notification.close();
      const event = new Event('notificationclose');
      Object.defineProperties(event, { notification: { value: notification }, waitUntil: { value: (promise: Promise<unknown>) => work.push(promise) } });
      scope.dispatchEvent(event);
    }
    await Promise.all(work);
  });
}
