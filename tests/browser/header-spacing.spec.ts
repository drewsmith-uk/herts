import { test, expect } from '@playwright/test';
import { builtinThemes, themeStorageKey } from '../../shared/themeValues';

for (const theme of builtinThemes.filter(theme => ['fieldwork', 'press'].includes(theme.id))) test(`${theme.name}: draft and conversation titles use consistent open and closed spacing`, async ({ page, request }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ key, theme }) => localStorage.setItem(key, JSON.stringify({ id: theme.id, theme })), { key: themeStorageKey, theme });
  const taskId = crypto.randomUUID(), itemId = crypto.randomUUID();
  const headers = { 'x-herts-request': '1' };
  expect((await request.post('/api/v1/sync', { headers, data: { id: crypto.randomUUID(), taskId, kind: 'create', title: 'Short title', at: Date.now() } })).ok()).toBe(true);
  expect((await request.post('/api/v1/reading/sync', { headers, data: { id: crypto.randomUUID(), itemId, contextId: crypto.randomUUID(), kind: 'create', title: 'Short title', url: `https://example.com/${itemId}`, at: Date.now() } })).ok()).toBe(true);
  const before = await (await request.get('http://127.0.0.1:8791/calls')).json();
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const compactHeights: number[] = [];
    for (const [path, label] of [['/new', 'Conversation title'], ['/conversation/existing', 'Conversation title'], [`/task/${taskId}`, 'Task title'], [`/reading-item/${itemId}`, 'Reading title']]) {
      await page.goto('/#' + path);
      const header = page.locator('.conversation-page-header'), title = page.getByLabel(label, { exact: true });
      await expect(title).toBeAttached();
      await page.evaluate(() => document.fonts.ready);
      await expect(header).toHaveClass(/is-compact/);
      const gap = () => header.evaluate(el => el.getBoundingClientRect().top - document.querySelector('.topbar')!.getBoundingClientRect().bottom);
      await expect.poll(gap).toBe(0);
      const compact = (await header.boundingBox())!.height;
      expect(compact).toBeLessThanOrEqual(66);
      compactHeights.push(compact);
      const screenshot = theme.id === 'press' && width === 390 && path === '/new';
      if (screenshot) await page.screenshot({ path: 'test-results/new-title-closed.png' });
      await page.getByRole('button', { name: 'Show page details', exact: true }).click();
      await expect(title).toBeVisible();
      await expect(header.locator('.conversation-compact-title')).toBeHidden();
      await expect.poll(gap).toBe(0);
      const original = await title.inputValue();
      await expect.poll(() => title.evaluate(el => {
        const css = getComputedStyle(el);
        const oneLine = parseFloat(css.lineHeight) + parseFloat(css.paddingTop) + parseFloat(css.paddingBottom) + parseFloat(css.borderTopWidth) + parseFloat(css.borderBottomWidth);
        return el.getBoundingClientRect().height <= Math.max(44, Math.ceil(oneLine)) + 1;
      })).toBe(true);
      const shortHeight = (await title.boundingBox())!.height;
      expect(shortHeight).toBeGreaterThanOrEqual(44);
      if (screenshot) await page.screenshot({ path: 'test-results/new-title-open.png' });
      await title.fill('A longer title that wraps naturally while keeping all of its words visible as the screen changes');
      if (width < 700) await expect.poll(async () => (await title.boundingBox())!.height).toBeGreaterThan(shortHeight);
      await expect.poll(() => title.evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
      await page.setViewportSize({ width: width === 320 ? 390 : 320, height: 844 });
      await expect.poll(() => title.evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
      await page.setViewportSize({ width, height: 844 });
      await expect.poll(() => title.evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
      await title.fill(original);
      await expect.poll(async () => (await title.boundingBox())!.height).toBe(shortHeight);
      await page.getByRole('button', { name: 'Collapse page details', exact: true }).click();
      await expect(header.locator('.conversation-compact-title')).toBeVisible();
      await expect.poll(async () => (await header.boundingBox())!.height).toBe(compact);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    expect(Math.max(...compactHeights) - Math.min(...compactHeights)).toBeLessThanOrEqual(1);
  }
  const after = await (await request.get('http://127.0.0.1:8791/calls')).json();
  expect(after.slice(before.length).filter((method: string) => ['session.create', 'session.resume', 'prompt.submit', 'session.interrupt'].includes(method))).toEqual([]);
  expect(errors).toEqual([]);
});
