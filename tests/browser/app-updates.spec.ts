import { test, expect, type Page } from '@playwright/test';

const toast = (page: Page) => page.getByRole('region', { name: 'App update', exact: true });
const settings = (page: Page) => page.getByRole('region', { name: 'App updates', exact: true });
const version = (page: Page) => page.locator('meta[name="herts-build"]').getAttribute('content');
const calls = async (page: Page) => (await (await page.request.get('http://127.0.0.1:8791/calls')).json()).filter((m: string) => ['session.create', 'session.resume', 'prompt.submit', 'session.interrupt'].includes(m));

async function oldPage(page: Page, path = '/') {
  // Load the real new client as an older release, with a real legacy worker.
  // The waiting worker precaches the actual new HTML, so its offline reload
  // also exercises the deployed cache rather than a mocked serviceWorker API.
  await page.goto('/manifest.webmanifest');
  await page.evaluate(async () => { await navigator.serviceWorker.register('/__test/old-sw.js', { scope: '/' }); await navigator.serviceWorker.ready; });
  await page.context().addCookies([{ name: 'fixture-old-page', value: '1', url: 'http://127.0.0.1:8790/' }]);
  await page.goto(path);
  await expect(toast(page)).toBeVisible();
  await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting)).toBe(true);
}

async function stored(page: Page, table: string) {
  return page.evaluate(async table => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('hermes-tasks'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try { return await new Promise<any[]>((resolve, reject) => { const r = db.transaction(table).objectStore(table).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
    finally { db.close(); }
  }, table);
}

test('a first installation and an already-current page never offer or force an update', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.getByRole('textbox', { name: 'New task title' }).fill('Keep writing on this release');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(toast(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'New task title' })).toHaveValue('Keep writing on this release');
  await expect(toast(page)).toHaveCount(0);
});

test('Settings checks the deployed version on demand and confirms when it is current', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const before = await calls(page);
  await page.goto('/#/settings');
  await expect(settings(page)).toContainText('App version:');
  await settings(page).getByRole('button', { name: 'Check for updates', exact: true }).click();
  await expect(settings(page).getByRole('status')).toHaveText('Herts is up to date.');
  await expect(settings(page).getByRole('button', { name: 'Update now' })).toHaveCount(0);
  await expect(toast(page)).toHaveCount(0);
  await page.screenshot({ path: 'test-results/phone-update-settings.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await calls(page)).toEqual(before);
});

test('a dismissed update remains available in Settings and a manual check restores the toast', async ({ page }) => {
  await oldPage(page, '/#/settings');
  await toast(page).getByRole('button', { name: 'Later' }).click();
  await expect(toast(page)).toHaveCount(0);
  await expect(settings(page).getByRole('button', { name: 'Update now' })).toBeVisible();
  await settings(page).getByRole('button', { name: 'Check for updates' }).click();
  await expect(settings(page).getByRole('status')).toHaveText('An update is ready to install.');
  await expect(toast(page)).toBeVisible();
  await toast(page).getByRole('button', { name: 'Later' }).click();
  await settings(page).getByRole('button', { name: 'Update now' }).click();
  await expect.poll(() => version(page)).not.toBe('tasks-shell-fixture-previous');
  await expect(settings(page)).toBeVisible();
  await expect(toast(page)).toHaveCount(0);
});

test('an offline update check is unconfirmed and can be retried after reconnecting', async ({ page, context }) => {
  await page.goto('/#/settings');
  await settings(page).getByRole('button', { name: 'Check for updates' }).click();
  await expect(settings(page).getByRole('status')).toHaveText('Herts is up to date.');
  await context.setOffline(true);
  await settings(page).getByRole('button', { name: 'Check for updates' }).click();
  await expect(settings(page).getByRole('alert')).toHaveText('You are offline. Connect to check for updates.');
  await expect(settings(page)).not.toContainText('Herts is up to date.');
  await expect(toast(page)).toHaveCount(0);
  await context.setOffline(false);
  await settings(page).getByRole('button', { name: 'Check for updates' }).click();
  await expect(settings(page).getByRole('status')).toHaveText('Herts is up to date.');
  await expect(settings(page).getByRole('alert')).toHaveCount(0);
});

test('manual checks wait for installation and report a failed download without claiming to be current', async ({ page }) => {
  await page.goto('/#/settings');
  await settings(page).getByRole('button', { name: 'Check for updates' }).click();
  await expect(settings(page).getByRole('status')).toHaveText('Herts is up to date.');
  await page.evaluate(() => {
    const original = ServiceWorkerRegistration.prototype.update;
    (window as any).restoreUpdate = () => { ServiceWorkerRegistration.prototype.update = original; };
    ServiceWorkerRegistration.prototype.update = async function () {
      const worker = Object.assign(new EventTarget(), { state: 'installing' });
      Object.defineProperty(this, 'installing', { configurable: true, get: () => worker.state === 'redundant' ? null : worker });
      (window as any).failDownload = () => { worker.state = 'redundant'; worker.dispatchEvent(new Event('statechange')); };
      return this;
    };
  });
  await settings(page).getByRole('button', { name: 'Check for updates' }).click();
  await expect(settings(page).getByRole('status')).toHaveText('Checking for updates…');
  await expect(settings(page).getByRole('button', { name: 'Check for updates' })).toBeDisabled();
  await page.evaluate(() => (window as any).failDownload());
  await expect(settings(page).getByRole('alert')).toContainText('could not be downloaded');
  await expect(settings(page)).not.toContainText('Herts is up to date.');
  await expect(toast(page)).toHaveCount(0);
  await page.evaluate(() => (window as any).restoreUpdate());
  await settings(page).getByRole('button', { name: 'Check for updates' }).click();
  await expect(settings(page).getByRole('status')).toHaveText('Herts is up to date.');
});

test('Later leaves the app, draft and agent untouched and stays dismissed while browsing', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const before = await calls(page);
  await oldPage(page);
  await page.getByRole('textbox', { name: 'New task title' }).fill('Keep this capture');
  await page.screenshot({ path: 'test-results/phone-update-toast.png' });
  const box = await toast(page).boundingBox(), nav = await page.getByRole('navigation', { name: 'Main navigation' }).boundingBox();
  expect(box!.y + box!.height).toBeLessThan(nav!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await toast(page).getByRole('button', { name: 'Later' }).click();
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')); });
  await expect(page.getByRole('textbox', { name: 'New task title' })).toHaveValue('Keep this capture');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(toast(page)).toHaveCount(0);
  expect(await version(page)).toBe('tasks-shell-fixture-previous');
  expect(await calls(page)).toEqual(before);
});

test('Update now reloads once, keeps the current screen, offline task changes and capture draft', async ({ page, context }) => {
  const before = await calls(page);
  await oldPage(page);
  await page.route('**/api/v1/plugins/tasks/commands', route => route.abort());
  await page.getByRole('textbox', { name: 'New task title' }).fill('Pending update fixture');
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Pending update fixture', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'New task title' }).fill('Unfinished capture');
  const pending = await stored(page, 'pluginPending'), url = page.url();
  expect(pending).toHaveLength(1);
  await context.setOffline(true);
  let loads = 0; page.on('load', () => loads++);
  await toast(page).getByRole('button', { name: 'Update now' }).click();
  await expect.poll(() => version(page)).not.toBe('tasks-shell-fixture-previous');
  await expect(page.getByRole('textbox', { name: 'New task title' })).toHaveValue('Unfinished capture');
  await expect(page.getByRole('link', { name: 'Pending update fixture', exact: true })).toBeVisible();
  expect(await stored(page, 'pluginPending')).toEqual(pending);
  expect(page.url()).toBe(url);
  expect(loads).toBe(1);
  await expect(toast(page)).toHaveCount(0);
  await context.setOffline(false);
  await page.unroute('**/api/v1/plugins/tasks/commands');
  expect(await calls(page)).toEqual(before);
});

test('draft text and attachments survive; updating one window does not reload another', async ({ page, context, request }) => {
  const taskId = crypto.randomUUID();
  await request.post('/api/v1/sync', { headers: { 'x-tasks-request': '1' }, data: { id: crypto.randomUUID(), taskId, kind: 'create', title: 'Update draft fixture', at: Date.now() } });
  await oldPage(page, `/#/task/${taskId}`);
  await page.getByRole('textbox', { name: 'Message Hermes' }).fill('Draft preserved through update');
  await page.locator('input[type=file]').setInputFiles({ name: 'fixture.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic attachment') });
  await expect(page.locator('.attachment-list')).toContainText('fixture.txt');
  const files = (await stored(page, 'files')).map(f => f.id);
  await expect.poll(async () => (await stored(page, 'drafts')).find(d => d.id === taskId)?.files).toEqual(files);
  const other = await context.newPage();
  // Keep the other window on the old HTML; it shares the same waiting worker.
  await context.addCookies([{ name: 'fixture-old-page', value: '1', url: 'http://127.0.0.1:8790/' }]);
  await other.goto('/'); await expect(toast(other)).toBeVisible();
  await other.getByRole('textbox', { name: 'New task title' }).fill('Other window draft');
  const before = await calls(page);
  await toast(page).getByRole('button', { name: 'Update now' }).click();
  await expect.poll(() => version(page)).not.toBe('tasks-shell-fixture-previous');
  await expect(page.getByRole('textbox', { name: 'Message Hermes' })).toHaveValue('Draft preserved through update');
  expect((await stored(page, 'drafts')).find(d => d.id === taskId)?.files).toEqual(files);
  await expect(page.locator('.attachment-list')).toContainText('fixture.txt');
  expect((await stored(page, 'files')).map(f => f.id)).toEqual(files);
  expect(await version(other)).toBe('tasks-shell-fixture-previous');
  await expect(other.getByRole('textbox', { name: 'New task title' })).toHaveValue('Other window draft');
  await expect(toast(other)).toBeVisible();
  await toast(other).getByRole('button', { name: 'Update now' }).click();
  await expect.poll(() => version(other)).not.toBe('tasks-shell-fixture-previous');
  await expect(other.getByRole('textbox', { name: 'New task title' })).toHaveValue('Other window draft');
  expect(await calls(page)).toEqual(before);
});

test('recording prevents a reload; saved audio survives a later update', async ({ page }) => {
  await oldPage(page);
  await page.getByRole('button', { name: 'Dictate', exact: true }).click();
  await expect(page.getByText('Recording…', { exact: true })).toBeVisible();
  await toast(page).getByRole('button', { name: 'Update now' }).click();
  await expect(toast(page).getByRole('alert')).toHaveText('Finish or cancel dictation before updating.');
  expect(await version(page)).toBe('tasks-shell-fixture-previous');
  await page.getByRole('button', { name: 'Cancel dictation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Transcribe saved recording', exact: true })).toBeVisible();
  const ids = (await stored(page, 'recordings')).map(r => r.id);
  await toast(page).getByRole('button', { name: 'Update now' }).click();
  await expect.poll(() => version(page)).not.toBe('tasks-shell-fixture-previous');
  await expect(page.getByRole('button', { name: 'Transcribe saved recording', exact: true })).toBeVisible();
  expect((await stored(page, 'recordings')).map(r => r.id)).toEqual(ids);
});

test('storage failure leaves the draft and current release usable, with a retry', async ({ page }) => {
  await oldPage(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      if (this.name === 'pluginLocal' && String(args[0]?.key).includes(':draft:')) throw new DOMException('Fixture storage failure', 'QuotaExceededError');
      return put.apply(this, args);
    };
    (window as any).restoreStorage = () => { IDBObjectStore.prototype.put = put; };
  });
  await page.getByRole('textbox', { name: 'New task title' }).fill('Do not lose this draft');
  await toast(page).getByRole('button', { name: 'Update now' }).click();
  await expect(toast(page).getByRole('alert')).toContainText('could not be saved');
  expect(await version(page)).toBe('tasks-shell-fixture-previous');
  await expect(page.getByRole('textbox', { name: 'New task title' })).toBeEnabled();
  await expect(page.getByRole('textbox', { name: 'New task title' })).toHaveValue('Do not lose this draft');
  await page.evaluate(() => (window as any).restoreStorage());
  await toast(page).getByRole('button', { name: 'Update now' }).click();
  await expect.poll(() => version(page)).not.toBe('tasks-shell-fixture-previous');
  await expect(page.getByRole('textbox', { name: 'New task title' })).toHaveValue('Do not lose this draft');
});

test('a failed initial update check retries on reconnection without reloading', async ({ page }) => {
  await page.addInitScript(() => {
    const register = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    let failed = false;
    navigator.serviceWorker.register = (...args) => { if (!failed) { failed = true; return Promise.reject(new Error('Fixture disconnected')); } return register(...args); };
  });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New task title' }).fill('Keep the offline draft');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.active)).toBe(true);
  await expect(toast(page)).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'New task title' })).toHaveValue('Keep the offline draft');
});

test('a failed worker installation keeps the working release and never offers a broken update', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.getByRole('textbox', { name: 'New task title' }).fill('Still usable after failed install');
  const current = await version(page);
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.register('/__test/failed-sw.js', { scope: '/' });
    const worker = reg.installing;
    if (worker && worker.state !== 'redundant') await new Promise<void>(resolve => { worker.addEventListener('statechange', () => { if (worker.state === 'redundant') resolve(); }); });
  });
  await expect(toast(page)).toHaveCount(0);
  expect(await version(page)).toBe(current);
  await expect(page.getByRole('textbox', { name: 'New task title' })).toHaveValue('Still usable after failed install');
});

test('accepted work survives updating without another send or interrupt', async ({ page, request }) => {
  const taskId = crypto.randomUUID();
  await request.post('/api/v1/sync', { headers: { 'x-tasks-request': '1' }, data: { id: crypto.randomUUID(), taskId, kind: 'create', title: 'Update during work fixture', at: Date.now() } });
  await oldPage(page, `/#/task/${taskId}`);
  await page.getByRole('textbox', { name: 'Message Hermes' }).fill('ask approval');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve once', exact: true })).toBeVisible();
  const before = await calls(page), submissions = await stored(page, 'submissions');
  await toast(page).getByRole('button', { name: 'Update now' }).click();
  await expect.poll(() => version(page)).not.toBe('tasks-shell-fixture-previous');
  await expect(page.getByRole('button', { name: 'Approve once', exact: true })).toBeVisible();
  expect((await stored(page, 'submissions')).map(s => s.id)).toEqual(submissions.map(s => s.id));
  expect(await calls(page)).toEqual(before);
});

test('an unconfirmed submission remains recoverable and is never retried by updating', async ({ page, request }) => {
  const taskId = crypto.randomUUID();
  await request.post('/api/v1/sync', { headers: { 'x-tasks-request': '1' }, data: { id: crypto.randomUUID(), taskId, kind: 'create', title: 'Unconfirmed update fixture', at: Date.now() } });
  await oldPage(page, `/#/task/${taskId}`);
  await page.route('**/api/v1/actions', route => route.abort());
  await page.getByRole('textbox', { name: 'Message Hermes' }).fill('Keep this unconfirmed message');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('A submitted request has not been confirmed.', { exact: false })).toBeVisible();
  const before = await calls(page), submissions = await stored(page, 'submissions');
  expect(submissions).toHaveLength(1); expect(submissions[0].confirmed).toBe(false);
  await page.unroute('**/api/v1/actions');
  let sends = 0; page.on('request', req => { if (req.url().endsWith('/api/v1/actions') && req.method() === 'POST') sends++; });
  await toast(page).getByRole('button', { name: 'Update now' }).click();
  await expect.poll(() => version(page)).not.toBe('tasks-shell-fixture-previous');
  await expect(page.getByRole('textbox', { name: 'Message Hermes' })).toHaveValue('Keep this unconfirmed message');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  expect(await stored(page, 'submissions')).toEqual(submissions);
  expect(sends).toBe(0); expect(await calls(page)).toEqual(before);
});

test('updating cancels the voice send countdown while keeping its transcribed draft', async ({ page, request }) => {
  const taskId = crypto.randomUUID();
  await request.post('/api/v1/sync', { headers: { 'x-tasks-request': '1' }, data: { id: crypto.randomUUID(), taskId, kind: 'create', title: 'Countdown update fixture', at: Date.now() } });
  await oldPage(page, `/#/task/${taskId}`);
  const before = await calls(page);
  await page.getByRole('button', { name: 'Dictate', exact: true }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Stop recording and transcribe', exact: true }).click();
  await expect(page.locator('.countdown')).toBeVisible();
  await toast(page).getByRole('button', { name: 'Update now' }).click();
  await expect.poll(() => version(page)).not.toBe('tasks-shell-fixture-previous');
  await expect(page.getByRole('textbox', { name: 'Message Hermes' })).toHaveValue('Please draft a packing list.');
  await expect(page.locator('.countdown')).toHaveCount(0);
  await page.waitForTimeout(5500);
  expect(await calls(page)).toEqual(before);
});

for (const kind of ['task', 'reading'] as const) {
  test(`updating commits the focused ${kind} title and preserves it offline`, async ({ page, context, request }) => {
    const id = crypto.randomUUID(), headers = { 'x-tasks-request': '1' };
    if (kind === 'task') await request.post('/api/v1/sync', { headers, data: { id: crypto.randomUUID(), taskId: id, kind: 'create', title: 'Title update fixture', at: Date.now() } });
    else await request.post('/api/v1/reading/sync', { headers, data: { id: crypto.randomUUID(), itemId: id, contextId: crypto.randomUUID(), kind: 'create', title: 'Title update fixture', url: `https://example.com/${id}`, at: Date.now() } });
    await oldPage(page, `/#/${kind === 'task' ? 'task' : 'reading-item'}/${id}`);
    const field = page.getByRole('textbox', { name: kind === 'task' ? 'Task title' : 'Reading title', exact: true });
    await context.setOffline(true);
    await field.fill('Title edited immediately before updating');
    await toast(page).getByRole('button', { name: 'Update now' }).click();
    await expect.poll(() => version(page)).not.toBe('tasks-shell-fixture-previous');
    await expect(field).toHaveValue('Title edited immediately before updating');
  });
}

test('a reading capture draft survives updating without adding it or sending it to Hermes', async ({ page }) => {
  const before = await calls(page);
  await oldPage(page, '/#/reading/add');
  await page.getByRole('textbox', { name: 'Article link' }).fill('https://example.com/reading-draft');
  await page.getByRole('textbox', { name: 'Reading title', exact: true }).fill('An unfinished reading draft');
  await toast(page).getByRole('button', { name: 'Update now' }).click();
  await expect.poll(() => version(page)).not.toBe('tasks-shell-fixture-previous');
  await expect(page.getByRole('textbox', { name: 'Article link' })).toHaveValue('https://example.com/reading-draft');
  await expect(page.getByRole('textbox', { name: 'Reading title', exact: true })).toHaveValue('An unfinished reading draft');
  expect(await calls(page)).toEqual(before);
});
