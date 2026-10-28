import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const headers = { 'x-herts-request': '1' };
test('a task notification opens its destination while the full state response is stalled', async ({ page, request }) => {
  const taskId = crypto.randomUUID(), at = Date.now();
  await request.post('/api/v1/sync', { headers, data: { id: crypto.randomUUID(), taskId, kind: 'create', title: 'Priority task notification', at } });
  await request.post('/api/v1/sync', { headers, data: { id: crypto.randomUUID(), taskId, kind: 'snooze', baseStatus: 'inbox', baseSnoozeId: null, snoozedUntil: at + 60000, at } });
  const wake = await (await request.post('/__test/wake-snoozed', { headers, data: { at: at + 60000 } })).json();
  const notice = wake.notices.find((notice: any) => notice.task_id === taskId);
  const held = await holdState(page);
  try {
    await page.goto(`/?notice=${encodeURIComponent(notice.id)}`);
    await expect(page).toHaveURL(new RegExp(`#/task/${taskId}$`));
    await expect(page.getByRole('heading', { name: 'Priority task notification', exact: true })).toBeVisible();
    const editor = page.getByLabel('Message Hermes', { exact: true });
    await editor.fill('Draft in the notification destination.');
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  } finally { held.release(); }
});
async function message(request: APIRequestContext, id: string, text: string) {
  expect((await request.post('/__test/conversation-message', { headers, data: { id, title: 'Priority conversation', text } })).ok()).toBe(true);
}
async function holdState(page: Page, staleConnection = false) {
  let release!: () => void, reads = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/state', async route => {
    const read = ++reads;
    const response = await route.fetch();
    const data = await response.json();
    if (staleConnection && read === 1) data.gateway.online = false;
    await gate;
    await route.fulfill({ json: data }).catch(() => {});
  });
  return { release, reads: () => reads };
}

for (const newer of ['connection', 'state', 'removed binding']) test(`a delayed notification preserves newer ${newer} results`, async ({ page, request }) => {
  const id = `priority-notice-${newer.replaceAll(' ', '-')}`;
  await message(request, id, 'Keep newer connection and conversation status.');
  const context = (await (await request.post(`/api/v1/conversations/${id}/context`, { headers, data: {} })).json()).context;
  await page.goto('/#/settings');
  await expect.poll(() => page.evaluate(() => {
    const state = (window as any).__HERTS_PLUGIN_RUNTIME__?.sdk.getCore();
    return !!state?.defaultsReady && state.online && !state.stateRefreshPending;
  })).toBe(true);
  const current = await (await request.get('/api/v1/state')).json();
  const binding = { storedId: id, runtimeId: 'synthetic-runtime', generation: 'old-generation', epoch: 'fixture-epoch', seq: 1, known: true, ready: true, monitored: true };
  const destination = { ...current, snapshot: { ...current.snapshot }, bindings: { [context.id]: binding }, gateway: { ...current.gateway, online: true } };
  current.gateway.online = false;
  current.snapshot.revision++;
  current.bindings = newer === 'removed binding' ? {} : { [context.id]: { ...binding, generation: 'new-generation', seq: 2 } };
  await page.route('**/api/v1/connection', route => route.fulfill({ json: { gateway: current.gateway, pushKey: current.pushKey } }));
  await page.route('**/api/v1/state', route => route.fulfill({ json: current }));
  let started = false, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/notifications/priority-ordering', async route => {
    started = true;
    await gate;
    await route.fulfill({ json: { route: '/settings', destination } }).catch(() => {});
  });
  try {
    await page.evaluate(() => { location.hash = '/notice/priority-ordering'; });
    await expect.poll(() => started).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as any).__HERTS_PLUGIN_RUNTIME__.sdk.getCore().stateRefreshPending)).toBe(false);
    await page.evaluate(async newer => {
      if (newer === 'connection') window.dispatchEvent(new Event('online'));
      else await (window as any).__HERTS_PLUGIN_RUNTIME__.sdk.refresh();
    }, newer);
    await expect.poll(() => page.evaluate(() => (window as any).__HERTS_PLUGIN_RUNTIME__.sdk.getCore().gateway.online)).toBe(false);
    if (newer !== 'connection') await expect.poll(() => page.evaluate(contextId => {
      const state = (window as any).__HERTS_PLUGIN_RUNTIME__.sdk.getCore();
      return { revision: state.remote.revision, pending: state.stateRefreshPending, generation: state.bindings[contextId]?.generation || null };
    }, context.id)).toEqual({
      revision: current.snapshot.revision, pending: false, generation: newer === 'state' ? 'new-generation' : null,
    });
    await page.evaluate(contextId => {
      const sdk = (window as any).__HERTS_PLUGIN_RUNTIME__.sdk;
      (window as any).notificationObservations = [];
      (window as any).stopNotificationObservations = sdk.subscribeCore(() => {
        const state = sdk.getCore();
        (window as any).notificationObservations.push({ online: state.gateway.online, generation: state.bindings[contextId]?.generation || null });
      });
    }, context.id);
    release();
    await expect(page).toHaveURL(/#\/settings$/);
    const observations = await page.evaluate(() => {
      (window as any).stopNotificationObservations();
      return (window as any).notificationObservations as { online: boolean; generation: string | null }[];
    });
    expect(observations.length).toBeGreaterThan(0);
    expect(observations.every(value => !value.online)).toBe(true);
    if (newer !== 'connection')
      expect(observations.every(value => value.generation === (newer === 'state' ? 'new-generation' : null))).toBe(true);
  } finally { release(); }
});

for (const width of [390, 1280]) test(`a cold notification opens current history and message controls before full sync at ${width}px`, async ({ page, request }) => {
  await page.setViewportSize({ width, height: 700 });
  const id = `priority-cold-${width}`;
  await message(request, id, 'Current reply before background sync finishes.');
  await page.route('**/api/v1/notifications/priority-fixture', route => route.fulfill({ json: { route: `/conversation/${id}` } }));
  const held = await holdState(page);
  try {
    await page.goto('/?notice=priority-fixture');
    await expect(page.locator('.history')).toContainText('Current reply before background sync finishes.');
    const editor = page.getByLabel('Message Hermes', { exact: true });
    await editor.fill('Keep this draft while the rest of the app syncs.');
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
    await expect.poll(held.reads).toBeGreaterThan(0);
    await page.screenshot({ path: test.info().outputPath(`priority-${width}.png`), fullPage: true });
    held.release();
    await expect.poll(() => page.evaluate(() => (window as any).__HERTS_PLUGIN_RUNTIME__.sdk.getCore().stateRefreshPending)).toBe(false);
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue('Keep this draft while the rest of the app syncs.');
    await page.reload();
    await expect(page.getByLabel('Message Hermes', { exact: true })).toHaveValue('Keep this draft while the rest of the app syncs.');
  } finally { held.release(); }
});

test('returning to a cached conversation refreshes history and saved edits before a stalled full sync', async ({ page, context, request }) => {
  const id = 'priority-return';
  const url = 'https://example.com/priority-reconnect';
  await message(request, id, `Earlier cached reply.\n\n[Offline article](${url})`);
  await page.goto(`/#/conversation/${id}`);
  await expect(page.locator('.history')).toContainText('Earlier cached reply.');
  const bookmark = page.getByRole('button', { name: `Save to reading list: ${url}`, exact: true });
  await expect(bookmark).toBeVisible();
  await page.getByLabel('Message Hermes', { exact: true }).fill('Retain the unsent draft.');
  await context.setOffline(true);
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await bookmark.click();
  await message(request, id, 'New reply while the phone was away.');
  const held = await holdState(page);
  try {
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await expect(page.locator('.history')).toContainText('New reply while the phone was away.');
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
    await expect(page.getByLabel('Message Hermes', { exact: true })).toHaveValue('Retain the unsent draft.');
    await expect.poll(async () => {
      const data = await (await request.get('/api/v1/state')).json();
      return data.snapshot.reading.items.some((item: any) => item.url === url);
    }).toBe(true);
  } finally { held.release(); }
});

test('a failed activity read preserves history and drafts and recovers through Retry', async ({ page, request }) => {
  const id = 'priority-retry';
  await message(request, id, 'History stays readable during a status failure.');
  await page.addInitScript(() => {
    document.addEventListener('click', event => {
      if (event.target instanceof HTMLElement && event.target.closest('button')?.textContent === 'Retry')
        (window as any).activityRetryRequested = true;
    }, true);
  });
  await page.route('**/api/v1/contexts/*/activity', async route => {
    if (await page.evaluate(() => !!(window as any).activityRetryRequested)) await route.continue();
    else await route.fulfill({ status: 503, json: { error: 'Synthetic connection failure' } });
  });
  await page.goto(`/#/conversation/${id}`);
  await expect(page.locator('.history')).toContainText('History stays readable during a status failure.');
  const editor = page.getByLabel('Message Hermes', { exact: true });
  await editor.fill('Keep this draft through the failure.');
  await expect(page.getByText('Conversation status is unavailable. Reconnect or select Retry.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await expect(editor).toHaveValue('Keep this draft through the failure.');
});

test('a late full sync cannot replace newer conversation activity or its saved receipt', async ({ page, request }) => {
  const id = 'priority-late-sync';
  await message(request, id, 'A synthetic conversation for delayed reads.');
  await page.goto(`/#/conversation/${id}`);
  await expect(page.locator('.history')).toContainText('A synthetic conversation for delayed reads.');
  const context = (await (await request.post(`/api/v1/conversations/${id}/context`, { headers, data: {} })).json()).context;
  const held = await holdState(page, true), actionId = crypto.randomUUID();
  try {
    await page.evaluate(() => { void (window as any).__HERTS_PLUGIN_RUNTIME__.sdk.refresh(); });
    await expect.poll(held.reads).toBeGreaterThan(0);
    let completed = false;
    await page.route('**/api/v1/contexts/*/activity', async route => {
      const data = await (await route.fetch()).json();
      data.actions = [{ id: actionId, taskId: context.id, contextId: context.id, kind: 'send', text: 'Synthetic submitted message', uploadIds: [],
        createdAt: 100, updatedAt: completed ? 300 : 200, state: completed ? 'finished' : 'running', receipt: 'accepted',
        phase: completed ? 'complete' : 'working', sendStage: 'submitted', ...(completed ? { terminal: 'complete' } : {}) }];
      if (data.activity) {
        const { id, kind, state, receipt, phase, createdAt, updatedAt } = data.actions[0];
        const main = { id, kind, state, receipt, phase, createdAt, updatedAt };
        data.activity = { ...data.activity, actions: data.actions, summary: { ...data.activity.summary,
          version: data.activity.summary.version + (completed ? 2 : 1), main, latestSend: main, hasSubmission: true } };
        delete data.actions;
      }
      data.binding = { storedId: id, runtimeId: 'synthetic-runtime', generation: 'current-generation', epoch: 'fixture-epoch', seq: completed ? 3 : 2, known: true, ready: completed, monitored: true };
      await route.fulfill({ json: data });
    });
    await page.evaluate(() => window.dispatchEvent(new Event('herts-activity')));
    const receipt = () => page.evaluate(id => (window as any).__HERTS_PLUGIN_RUNTIME__.sdk.getCore().actions.find((action: any) => action.id === id), actionId);
    await expect.poll(async () => (await receipt())?.state).toBe('running');
    completed = true;
    await page.evaluate(() => window.dispatchEvent(new Event('herts-activity')));
    await expect.poll(async () => (await receipt())?.state).toBe('finished');
    await page.getByLabel('Message Hermes', { exact: true }).fill('Keep the newer draft.');
    held.release();
    await expect.poll(() => page.evaluate(() => (window as any).__HERTS_PLUGIN_RUNTIME__.sdk.getCore().stateRefreshPending)).toBe(false);
    expect(await receipt()).toMatchObject({ state: 'finished', receipt: 'accepted', terminal: 'complete' });
    expect(await page.evaluate(() => (window as any).__HERTS_PLUGIN_RUNTIME__.sdk.getCore().gateway.online)).toBe(true);
    await expect.poll(() => page.evaluate(async id => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open('hermes-tasks'); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
      });
      try {
        const row = await new Promise<any>((resolve, reject) => {
          const read = database.transaction('activityCache').objectStore('activityCache').get(`action:${id}`); read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error);
        });
        return row?.value.action.state;
      } finally { database.close(); }
    }, actionId)).toBe('finished');
    await expect(page.getByLabel('Message Hermes', { exact: true })).toHaveValue('Keep the newer draft.');
  } finally { held.release(); }
});
