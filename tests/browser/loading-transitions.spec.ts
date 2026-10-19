import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

for (const width of [390, 1280]) test(`task filters preserve the composer and draft at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await page.goto('/#/tasks/inbox');
  const editor = page.getByRole('textbox', { name: 'Add a task', exact: true });
  await editor.fill('Keep this unsaved task while changing lists');
  await page.getByLabel('New task title', { exact: true }).fill('Draft title');
  await editor.evaluate(element => { (window as any).originalEditor = element; });
  for (const route of ['/tasks/next', '/tasks/done', '/tasks/inbox']) {
    await page.evaluate(route => { location.hash = route; }, route);
    await expect(page.locator('.mobile-lists .active')).toContainText(route.endsWith('next') ? 'Next' : route.endsWith('done') ? 'Done' : 'Inbox');
    await expect(editor).toHaveValue('Keep this unsaved task while changing lists');
    expect(await editor.evaluate(element => element === (window as any).originalEditor)).toBe(true);
    await expect(page.getByLabel('New task title', { exact: true })).toHaveValue('Draft title');
  }
  await page.context().setOffline(true);
  await page.evaluate(() => { location.hash = '/tasks/next'; });
  await expect(editor).toHaveValue('Keep this unsaved task while changing lists');
  await editor.fill('Keep the offline revision');
  await page.evaluate(() => { location.hash = '/conversations'; });
  await expect(page.getByLabel('Search conversations')).toBeVisible();
  await page.evaluate(() => { location.hash = '/tasks/next'; });
  await expect(editor).toHaveValue('Keep the offline revision');
  await page.context().setOffline(false);
  await page.reload();
  await expect(editor).toHaveValue('Keep the offline revision');
});

test('returning to conversations keeps cached rows in the first render', async ({ page }) => {
  let delay = false;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/conversations?*', async route => {
    if (delay) await gate;
    await route.fulfill({ json: { conversations: [{ key: 'existing', id: 'existing', aliases: ['existing'], title: 'Stable cached conversation', preview: 'Saved preview', source: 'desktop', updatedAt: 1 }], hasMore: false } }).catch(() => {});
  });
  try {
    await page.goto('/#/conversations');
    const row = page.getByRole('link', { name: /Stable cached conversation/ });
    await expect(row).toBeVisible();
    await expect(page.getByText('Refreshing conversations…', { exact: true })).toHaveCount(0);
    await page.evaluate(() => { location.hash = '/tasks/inbox'; });
    await expect(page.getByLabel('Add a task', { exact: true })).toBeEnabled();
    delay = true;
    await page.evaluate(() => {
      (window as any).emptyFrames = [];
      const observer = new MutationObserver(() => {
        if (document.querySelector('.conversation-list') && !document.querySelector('.conversation-list .item-title')) (window as any).emptyFrames.push(performance.now());
      });
      observer.observe(document.querySelector('main')!, { subtree: true, childList: true });
      (window as any).loadingObserver = observer;
      location.hash = '/conversations';
    });
    await expect(row).toBeVisible();
    await expect(page.getByText('Refreshing conversations…', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).emptyFrames)).toEqual([]);
  } finally {
    release();
    await page.evaluate(() => (window as any).loadingObserver?.disconnect());
  }
});

for (const width of [390, 1280]) for (const saved of [false, true]) test(`a delayed plugin shows loading on ${saved ? 'saved capture' : 'declared'} routes at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  let target = '/#/tasks/inbox';
  const text = 'Keep this saved task while its plugin loads';
  if (saved) {
    await page.goto(target);
    await page.getByLabel('Add a task', { exact: true }).fill(text);
    await page.evaluate(() => { location.hash = '/conversations'; });
    const draft = page.locator('.conversation-drafts a').filter({ hasText: text });
    await expect(draft).toBeVisible();
    target = '/' + await draft.getAttribute('href');
    expect(target).toContain('#/plugins/tasks/capture/');
    await page.goto('about:blank');
  }
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/_plugins/tasks/**/client.js', async route => { await gate; await route.continue(); });
  try {
    await page.goto(target);
    await expect(page.getByText('Loading screen…', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Plugin unavailable' })).toHaveCount(0);
    await page.screenshot({ path: `test-results/plugin-loading-${saved ? 'capture' : 'declared'}-${width}.png` });
    release();
    const editor = page.getByLabel('Add a task', { exact: true });
    await expect(editor).toBeEnabled();
    if (saved) await expect(editor).toHaveValue(text);
  } finally { release(); }
});

for (const route of ['/reading/add', '/new']) test(`entry controls wait for saved content on ${route}`, async ({ page }) => {
  await page.goto('/#/conversations');
  await expect(page.getByRole('link', { name: 'Reading', exact: true }).first()).toBeVisible();
  await page.evaluate(route => {
    const db = (window as any).__HERTS_PLUGIN_RUNTIME__.sdk.conversationDrafts.db;
    const original = db.kv.get.bind(db.kv);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    db.kv.get = async (key: string) => { if (key.startsWith('entry-fields:')) await gate; return original(key); };
    (window as any).releaseEntry = () => { db.kv.get = original; release(); };
    location.hash = route;
  }, route);
  try {
    await expect(page.locator('.composer-loading')).toBeVisible();
    await expect(page.getByLabel('Message Hermes', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Attach files', exact: true })).toBeDisabled();
  } finally { await page.evaluate(() => (window as any).releaseEntry()); }
  await page.getByLabel('Message Hermes', { exact: true }).fill('Keep https://example.com/loading-check');
  await page.evaluate(() => { location.hash = '/conversations'; });
  await expect(page.getByLabel('Search conversations')).toBeVisible();
  await expect(page.locator('.conversation-drafts')).toContainText('Keep https://example.com/loading-check');
});
