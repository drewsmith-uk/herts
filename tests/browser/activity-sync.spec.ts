import { test, expect, type APIRequestContext } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
const headers = { 'x-herts-request': '1' };
async function conversation(request: APIRequestContext, count = 1, recovery = false) {
  const id = `activity-${crypto.randomUUID()}`;
  await request.post('/__test/conversation-message', { headers, data: { id, title: 'Incremental conversation', text: 'Current conversation history is ready.' } });
  const { context } = await (await request.post(`/api/v1/conversations/${id}/context`, { headers, data: {} })).json();
  const fixture = await (await request.post('/__test/activity-fixture', { headers, data: { contextId: context.id, count, recovery } })).json();
  return { ...fixture, context, url: `/#/conversation/${id}` };
}

test('a notification opens current history while activity sync remains stalled', async ({ page, request }) => {
  const fixture = await conversation(request, 1000);
  let release!: () => void, started = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/activity-sync*', async route => { started = true; await gate; await route.continue().catch(() => {}); });
  try {
    await page.goto(`/?notice=${fixture.notice}`);
    await expect(page.locator('.history')).toContainText('Current conversation history is ready.');
    await page.getByLabel('Message Hermes', { exact: true }).fill('Keep the foreground draft usable.');
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
    await expect.poll(() => started).toBe(true);
    const actions = await page.evaluate(() => (window as any).__HERTS_PLUGIN_RUNTIME__.sdk.getCore().actions);
    expect(actions.filter((a: any) => a.taskId === fixture.context.id)).toHaveLength(1);
  } finally { release(); }
});

test('retired details stay retired after an older tab writes its legacy cache', async ({ page, request }) => {
  const fixture = await conversation(request);
  await page.goto(fixture.url);
  await expect.poll(() => page.evaluate(id => (window as any).__HERTS_PLUGIN_RUNTIME__.sdk.getCore().actions.some((a: any) => a.id === id), fixture.ids[0])).toBe(true);
  await page.getByLabel('Message Hermes', { exact: true }).fill('Preserve this independent draft.');
  const old = await page.evaluate(async () => {
    const sdk = (window as any).__HERTS_PLUGIN_RUNTIME__.sdk;
    return { snapshot: sdk.getCore().remote, actions: sdk.getCore().actions };
  });
  const replacement = await (await request.post('/__test/activity-fixture', { headers, data: { contextId: fixture.context.id } })).json();
  await expect.poll(() => page.evaluate(id => (window as any).__HERTS_PLUGIN_RUNTIME__.sdk.getCore().actions.some((a: any) => a.id === id), replacement.ids[0])).toBe(true);
  await expect.poll(() => page.evaluate(id => (window as any).__HERTS_PLUGIN_RUNTIME__.sdk.getCore().actions.some((a: any) => a.id === id), fixture.ids[0])).toBe(false);
  await page.evaluate(async value => {
    await (window as any).__HERTS_PLUGIN_RUNTIME__.sdk.conversationDrafts.db.table('kv').put({ key: 'state', value });
  }, old);
  await page.reload();
  await expect(page.getByLabel('Message Hermes', { exact: true })).toHaveValue('Preserve this independent draft.');
  expect(await page.evaluate(id => (window as any).__HERTS_PLUGIN_RUNTIME__.sdk.getCore().actions.some((a: any) => a.id === id), fixture.ids[0])).toBe(false);
});

test('expired sync cursors rebase without removing the open draft or cached history', async ({ page, request }) => {
  const fixture = await conversation(request);
  await page.goto(fixture.url);
  await expect(page.locator('.history')).toContainText('Current conversation history is ready.');
  await page.getByLabel('Message Hermes', { exact: true }).fill('Keep this draft during a rebase.');
  await expect.poll(() => page.evaluate(async () => (await (window as any).__HERTS_PLUGIN_RUNTIME__.sdk.conversationDrafts.db.table('activityCache').get('position'))?.value.cursor)).toBeTruthy();
  await request.post('/__test/expire-activity', { headers, data: {} });
  let rebases = 0;
  page.on('response', response => { if (response.url().includes('/activity-sync') && response.status() === 409) rebases++; });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => rebases).toBeGreaterThan(0);
  await expect(page.getByLabel('Message Hermes', { exact: true })).toHaveValue('Keep this draft during a rebase.');
  await expect(page.locator('.history')).toContainText('Current conversation history is ready.');
  await expect.poll(() => page.evaluate(async () => (await (window as any).__HERTS_PLUGIN_RUNTIME__.sdk.conversationDrafts.db.table('activityCache').get('position'))?.value.rebase || null)).toBeNull();
});

test('an unrelated queued edit does not block a conversation send or repeat its mutation', async ({ page, request }) => {
  const fixture = await conversation(request), taskId = crypto.randomUUID();
  await request.post('/api/v1/sync', { headers, data: { id: crypto.randomUUID(), taskId, kind: 'create', title: 'Unrelated task', at: Date.now() } });
  await page.goto(fixture.url);
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__HERTS_PLUGIN_RUNTIME__.sdk.getCore().plugins.entries.some((entry: any) => entry.manifest.id === 'tasks' && entry.enabled))).toBe(true);
  let release!: () => void, writes = 0, sends = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/plugins/tasks/commands', async route => { writes++; await gate; await route.continue().catch(() => {}); });
  page.on('request', req => { if (new URL(req.url()).pathname === '/api/v1/actions' && req.method() === 'POST') sends++; });
  try {
    await page.evaluate(async taskId => {
      await (window as any).__HERTS_PLUGIN_RUNTIME__.sdk.mutatePlugin('tasks', 'task',
        { id: crypto.randomUUID(), taskId, kind: 'title', title: 'Queued unrelated edit', baseTitle: 'Unrelated task', at: Date.now() }, taskId);
    }, taskId);
    await expect.poll(() => writes).toBe(1);
    await page.getByLabel('Message Hermes', { exact: true }).fill('Synthetic foreground send.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => sends).toBe(1);
    expect(writes).toBe(1);
  } finally { release(); }
});

test('the version four cache migrates with the backend unavailable and preserves draft owners', async ({ page, request }) => {
  const fixture = await conversation(request, 1000);
  const legacy = await (await request.get('/api/v1/state')).json();
  await page.goto('/#/settings');
  await expect.poll(() => page.evaluate(() => !!(window as any).__HERTS_PLUGIN_RUNTIME__?.sdk.getCore().defaultsReady)).toBe(true);
  const saved = await page.evaluate(async () => {
    const sdk = (window as any).__HERTS_PLUGIN_RUNTIME__.sdk;
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open('hermes-tasks'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    try {
      const schema = Array.from(database.objectStoreNames).filter(name => name !== 'activityCache').map(name => {
        const store = database.transaction(name).objectStore(name);
        return { name, keyPath: store.keyPath, autoIncrement: store.autoIncrement, indexes: Array.from(store.indexNames).map(name => {
          const index = store.index(name); return { name, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry };
        }) };
      });
      return { schema, plugins: (await sdk.conversationDrafts.db.table('kv').get('plugins'))?.value };
    } finally { database.close(); }
  });
  await page.route('**/migration-blank', route => route.fulfill({ contentType: 'text/html', body: '<html><body>Migration fixture</body></html>' }));
  await page.goto('/migration-blank');
  const fileId = crypto.randomUUID();
  await page.evaluate(async ({ schema, plugins, legacy, contextId, fileId }) => {
    await new Promise<void>((resolve, reject) => { const req = indexedDB.deleteDatabase('hermes-tasks'); req.onsuccess = () => resolve(); req.onerror = () => reject(req.error); req.onblocked = () => reject(new Error('The prior fixture window is still open.')); });
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('hermes-tasks', 40);
      req.onupgradeneeded = () => { for (const item of schema) {
        const store = req.result.createObjectStore(item.name, { keyPath: item.keyPath, autoIncrement: item.autoIncrement });
        for (const index of item.indexes) store.createIndex(index.name, index.keyPath, { unique: index.unique, multiEntry: index.multiEntry });
      } };
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(['kv', 'drafts', 'files', 'recordings'], 'readwrite');
        tx.objectStore('kv').put({ key: 'state', value: { snapshot: legacy.snapshot, actions: legacy.actions } });
        tx.objectStore('kv').put({ key: 'plugins', value: plugins });
        tx.objectStore('kv').put({ key: 'context-draft-deleted:preserved-marker', value: true });
        tx.objectStore('drafts').put({ id: contextId, text: 'Offline migration keeps my draft.', files: [fileId] });
        tx.objectStore('files').put({ id: fileId, name: 'kept.txt', type: 'text/plain', blob: new Blob(['Independent attachment']) });
        tx.objectStore('recordings').put({ id: 'preserved-recording', owner: `chat:${contextId}`, chunks: [new Blob(['Recording fixture'])], type: 'audio/webm', at: Date.now(), complete: false });
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
      });
    } finally { database.close(); }
  }, { ...saved, legacy, contextId: fixture.context.id, fileId });
  await page.route('**/api/v1/**', route => route.abort());
  await page.goto(fixture.url);
  await expect(page.getByLabel('Message Hermes', { exact: true })).toHaveValue('Offline migration keeps my draft.');
  await expect(page.getByRole('button', { name: 'Remove kept.txt', exact: true })).toBeVisible();
  const result = await page.evaluate(async contextId => {
    const sdk = (window as any).__HERTS_PLUGIN_RUNTIME__.sdk, db = sdk.conversationDrafts.db;
    return { count: sdk.getCore().actions.filter((a: any) => a.taskId === contextId).length,
      recording: !!await db.table('recordings').get('preserved-recording'), deleted: !!await db.table('kv').get('context-draft-deleted:preserved-marker') };
  }, fixture.context.id);
  expect(result).toEqual({ count: 1, recording: true, deleted: true });
});

test('details retain the open conversation and twenty recent conversations without removing drafts', async ({ page, request }) => {
  test.setTimeout(120000);
  const fixtures = [];
  for (let i = 0; i < 22; i++) fixtures.push(await conversation(request));
  await page.goto(fixtures[0].url);
  await page.getByLabel('Message Hermes', { exact: true }).fill('Keep the oldest independent draft.');
  for (const fixture of fixtures) {
    await page.goto(fixture.url);
    await expect.poll(() => page.evaluate(id => (window as any).__HERTS_PLUGIN_RUNTIME__?.sdk.getCore().actions.some((action: any) => action.id === id), fixture.ids[0])).toBe(true);
  }
  const result = await page.evaluate(async ({ first, last }) => {
    const sdk = (window as any).__HERTS_PLUGIN_RUNTIME__.sdk, db = sdk.conversationDrafts.db;
    return { recent: await db.table('activityCache').where('kind').equals('recent').count(),
      first: sdk.getCore().actions.some((a: any) => a.taskId === first), last: sdk.getCore().actions.some((a: any) => a.taskId === last),
      draft: (await db.table('drafts').get(first))?.text };
  }, { first: fixtures[0].context.id, last: fixtures.at(-1)!.context.id });
  expect(result).toEqual({ recent: 21, first: false, last: true, draft: 'Keep the oldest independent draft.' });
});

test('an interrupted rebase resumes its saved cursor and retains all replacement summaries', async ({ page, request }) => {
  const fixture = await conversation(request);
  const { contextIds } = await (await request.post('/__test/activity-fixture', { headers, data: { contextId: fixture.context.id, count: 0, contexts: 250 } })).json();
  let held = false, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/activity-sync?*', async route => {
    if (!held) { held = true; await gate; }
    await route.continue().catch(() => {});
  });
  try {
    await page.goto(fixture.url);
    await page.getByLabel('Message Hermes', { exact: true }).fill('Keep this draft through interrupted paging.');
    await expect.poll(() => held).toBe(true);
    const position = await page.evaluate(async () => (await (window as any).__HERTS_PLUGIN_RUNTIME__.sdk.conversationDrafts.db.table('activityCache').get('position'))?.value);
    expect(position.cursor).toBeTruthy(); expect(position.rebase).toBeTruthy();
    await page.reload();
    await expect(page.getByLabel('Message Hermes', { exact: true })).toHaveValue('Keep this draft through interrupted paging.');
    await expect.poll(() => page.evaluate(ids => {
      const summaries = (window as any).__HERTS_PLUGIN_RUNTIME__.sdk.getCore().activitySummaries;
      return ids.every((id: string) => !!summaries[id]);
    }, contextIds)).toBe(true);
    await expect.poll(() => page.evaluate(async () => (await (window as any).__HERTS_PLUGIN_RUNTIME__.sdk.conversationDrafts.db.table('activityCache').get('position'))?.value.rebase || null)).toBeNull();
  } finally { release(); }
});

test('the browser can use legacy responses when incremental sync is disabled', async ({ page, request }) => {
  const fixture = await conversation(request, 100);
  await page.route('**/api/v1/**', async route => {
    if (new URL(route.request().url()).pathname.endsWith('/events')) return route.continue();
    const outgoing = { ...route.request().headers() }; delete outgoing['x-herts-activity-sync'];
    const response = await route.fetch({ headers: outgoing });
    if (!(response.headers()['content-type'] || '').includes('application/json')) return route.fulfill({ response });
    const data = await response.json();
    if ('activitySync' in data) data.activitySync = false;
    if (data.destination) data.destination.activitySync = false;
    await route.fulfill({ response, json: data });
  });
  await page.goto(fixture.url);
  await expect(page.locator('.history')).toContainText('Current conversation history is ready.');
  await page.getByLabel('Message Hermes', { exact: true }).fill('Keep the fallback draft.');
  await expect.poll(() => page.evaluate(id => (window as any).__HERTS_PLUGIN_RUNTIME__.sdk.getCore().actions.filter((a: any) => a.taskId === id).length, fixture.context.id)).toBe(1);
  await page.reload();
  await expect(page.getByLabel('Message Hermes', { exact: true })).toHaveValue('Keep the fallback draft.');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
});
