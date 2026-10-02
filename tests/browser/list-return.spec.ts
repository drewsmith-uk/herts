import { test, expect } from '@playwright/test';

for (const width of [390, 1280]) for (const home of [false, true]) test(`returning from a task restores the ${home ? "home" : "space"} list position at ${width}px`, async ({ page, request }) => {
  await page.setViewportSize({ width, height: 844 });
  const headers = { 'x-herts-request': '1' }, spaceId = home ? '00000000-0000-4000-8000-000000000001' : crypto.randomUUID(), ids: string[] = [];
  if (!home) await request.post('/api/v1/spaces/sync', { headers, data: { id: crypto.randomUUID(), spaceId, kind: 'create', name: `Reading position ${width}`, at: Date.now() } });
  for (let i = 0; i < 18; i++) {
    const id = crypto.randomUUID(); ids.push(id);
    await request.post('/api/v1/sync', { headers, data: { id: crypto.randomUUID(), taskId: id, spaceId, kind: 'create', title: `Position item ${width} ${i}`, at: Date.now() } });
  }
  await page.goto(home ? width === 390 ? '/' : '/#/tasks/inbox' : `/#/spaces/${spaceId}/inbox`);
  const row = page.locator(`[data-task-id="${ids[5]}"]`);
  await expect(row).toBeVisible();
  // Real scrolling ends initial restoration; a programmatic jump alone does not.
  await page.mouse.wheel(0, 1);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await row.scrollIntoViewIfNeeded();
  const top = await row.evaluate(el => el.getBoundingClientRect().top);
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(300);
  await row.getByRole('link').click();
  await expect(page.locator('.conversation-panel')).toBeVisible();
  await page.getByRole('link', { name: new RegExp(`Back to ${home ? 'Personal' : `Reading position ${width}`} / Inbox`) }).click();
  await expect(row).toBeInViewport();
  await expect.poll(async () => Math.abs(await row.evaluate(el => el.getBoundingClientRect().top) - top)).toBeLessThan(5);
});
