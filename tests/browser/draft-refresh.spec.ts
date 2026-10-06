import { test, expect } from '@playwright/test';

test('an older state rebuild cannot remove the draft being edited', async ({ page }) => {
  await page.addInitScript(() => {
    // Hold one completed read, allowing later writes and reads to finish first.
    const original = IDBObjectStore.prototype.getAll;
    const success = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'onsuccess')!;
    IDBObjectStore.prototype.getAll = function (...args: any[]) {
      const request = original.apply(this, args as any);
      const range = args[0]?.query || args[0];
      const control = window as any;
      if (control.holdContextRead && this.name === 'kv' && range?.lower === 'context:') {
        control.holdContextRead = false;
        Object.defineProperty(request, 'onsuccess', {
          get() { return success.get!.call(request); },
          set(callback) {
            success.set!.call(request, function (event: Event) {
              control.releaseContextRead = () => { delete control.releaseContextRead; callback.call(request, event); };
            });
          },
        });
      }
      return request;
    };
  });
  await page.goto('/#/new');
  const editor = page.getByLabel('Message Hermes');
  await expect(editor).toBeEditable();
  await expect(page.locator('.save-state')).toContainText('Changes synced');
  await page.evaluate(() => { (window as any).holdContextRead = true; dispatchEvent(new Event('online')); });
  await expect.poll(() => page.evaluate(() => typeof (window as any).releaseContextRead)).toBe('function');
  try {
    await editor.fill('Typing');
    await expect(page).toHaveURL(/#\/draft\//);
    await expect(page.getByText('Draft saved on this device · Not sent', { exact: true })).toBeVisible();
    const node = await editor.elementHandle();
    await page.evaluate(() => (window as any).releaseContextRead());
    await expect.poll(() => page.evaluate(() => document.querySelector('.save-state')?.textContent)).toContain('Changes synced');
    await page.keyboard.type(' remains uninterrupted', { delay: 25 });
    expect(await node!.evaluate(element => element.isConnected)).toBe(true);
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue('Typing remains uninterrupted');
  } finally {
    await page.evaluate(() => (window as any).releaseContextRead?.());
  }
});
