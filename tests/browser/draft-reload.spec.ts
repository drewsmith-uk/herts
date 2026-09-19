import { test, expect, type BrowserContext } from '@playwright/test';

async function holdStorage(context: BrowserContext) {
  // Another connection keeps storage busy until after the old document closes.
  const storage = await context.newPage();
  await storage.goto('/manifest.webmanifest');
  await storage.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('hermes-tasks');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    let held = true;
    (window as any).releaseDraftLock = () => { held = false; };
    await new Promise<void>(resolve => {
      const transaction = database.transaction(['pluginLocal', 'kv'], 'readwrite');
      transaction.oncomplete = () => database.close();
      const keepBusy = () => {
        const request = transaction.objectStore('pluginLocal').get('hold-for-reload-test');
        request.onsuccess = () => { resolve(); if (held) keepBusy(); };
      };
      keepBusy();
    });
  });
  return async () => {
    await storage.evaluate(() => (window as any).releaseDraftLock());
    await storage.close();
  };
}

for (const capture of [
  { name: 'task', path: '/', fields: { 'New task title': 'Keep this idea through a reload' } },
  { name: 'reading', path: '/#/reading/add', fields: { 'Article link': 'https://example.com/read-later', 'Reading title': 'Keep this article title' } },
]) {
  test(`${capture.name} capture survives reload while its IndexedDB write is pending`, async ({ page, context }) => {
    await page.goto(capture.path);
    for (const label of Object.keys(capture.fields)) await expect(page.getByRole('textbox', { name: label, exact: true })).toBeEditable();
    const release = await holdStorage(context);
    try {
      for (const [label, text] of Object.entries(capture.fields)) await page.getByRole('textbox', { name: label, exact: true }).fill(text!);
      await page.reload({ waitUntil: 'domcontentloaded' });
    } finally { await release(); }
    for (const [label, text] of Object.entries(capture.fields)) await expect(page.getByRole('textbox', { name: label, exact: true })).toHaveValue(text!);
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('herts:draft-write:')))).toEqual([]);
  });
}

test('the newest capture edit in another window survives interrupted older writes', async ({ page, context }) => {
  const newer = await context.newPage();
  for (const window of [page, newer]) {
    await window.goto('/');
    await expect(window.getByRole('textbox', { name: 'New task title' })).toBeEditable();
  }
  const release = await holdStorage(context);
  try {
    await page.getByRole('textbox', { name: 'New task title' }).fill('Older window edit');
    await newer.getByRole('textbox', { name: 'New task title' }).fill('Newest window edit');
    await newer.reload({ waitUntil: 'domcontentloaded' });
    await page.reload({ waitUntil: 'domcontentloaded' });
  } finally { await release(); }
  for (const window of [page, newer]) await expect(window.getByRole('textbox', { name: 'New task title' })).toHaveValue('Newest window edit');
});
