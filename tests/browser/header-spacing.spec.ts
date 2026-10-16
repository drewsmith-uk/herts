import { test, expect } from '@playwright/test';
import { detailsField, closePageActions } from './composer-helpers';
import { builtinThemes, themeStorageKey } from '../../shared/themeValues';

for (const theme of builtinThemes.filter(theme => ['fieldwork', 'press'].includes(theme.id))) test(`${theme.name}: title editing does not move the fixed header`, async ({ page, request }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ key, theme }) => localStorage.setItem(key, JSON.stringify({ id: theme.id, theme })), { key: themeStorageKey, theme });
  const taskId = crypto.randomUUID(), itemId = crypto.randomUUID();
  const headers = { 'x-herts-request': '1' };
  await request.post('/api/v1/sync', { headers, data: { id: crypto.randomUUID(), taskId, kind: 'create', title: 'Short title', at: Date.now() } });
  await request.post('/api/v1/reading/sync', { headers, data: { id: crypto.randomUUID(), itemId, contextId: crypto.randomUUID(), kind: 'create', title: 'Short title', url: `https://example.com/${itemId}`, at: Date.now() } });
  const before = await (await request.get('http://127.0.0.1:8791/calls')).json();
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 480 });
    for (const [path, label] of [['/new', 'Conversation title'], ['/conversation/existing', 'Conversation title'], [`/task/${taskId}`, 'Task title'], [`/reading-item/${itemId}`, 'Reading title']]) {
      await page.goto('/#' + path);
      const header = page.locator('.conversation-page-header');
      await expect(header.locator('.conversation-compact-title')).toBeVisible();
      const original = await header.boundingBox();
      const title = await detailsField(page,label);
      await title.fill('A longer title that remains editable without moving the fixed header or hiding the dialog footer');
      const field=await title.boundingBox(), footer=await page.locator('.form-dialog-footer').boundingBox();
      expect(field!.x).toBeGreaterThanOrEqual(0);expect(field!.x+field!.width).toBeLessThanOrEqual(width);
      expect(field!.y+field!.height).toBeLessThanOrEqual(footer!.y+1);
      expect((await header.boundingBox())!.height).toBe(original!.height);
      await page.screenshot({path:`test-results/review-rename-${theme.id}-${label.split(' ')[0]}-${width}.png`});
      await page.keyboard.press('Escape');await closePageActions(page);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
  }
  expect(errors).toEqual([]);
  const after = await (await request.get('http://127.0.0.1:8791/calls')).json();
  expect(after.slice(before.length).filter((method:string)=>['session.create','session.resume','prompt.submit'].includes(method))).toEqual([]);
});
