import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window {
    voiceProbe: { calls: number; denied: boolean; release?: () => void; streams: MediaStream[] };
  }
}

async function probeMicrophone(page: Page, options: { denied?: boolean; delayed?: boolean } = {}) {
  await page.addInitScript(({ denied, delayed }) => {
    if (!navigator.mediaDevices) return;
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.voiceProbe = { calls: 0, denied: !!denied, streams: [] };
    navigator.mediaDevices.getUserMedia = async constraints => {
      window.voiceProbe.calls++;
      if (window.voiceProbe.denied) throw new DOMException('Permission denied', 'NotAllowedError');
      if (delayed) await new Promise<void>(resolve => { window.voiceProbe.release = resolve; });
      const stream = await getUserMedia(constraints);
      window.voiceProbe.streams.push(stream);
      return stream;
    };
  }, options);
}

async function shortcutUrl(page: Page) {
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  return manifest.shortcuts.find((entry: { name: string }) => entry.name === 'New voice task').url as string;
}

test('shortcut records on a cold launch, preserves the draft, and only saves a task on Add', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await probeMicrophone(page);
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New task title' }).fill('My saved idea.');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'New task title' })).toHaveValue('My saved idea.');
  expect(await page.evaluate(() => window.voiceProbe.calls)).toBe(0);
  const before: string[] = await (await request.get('http://127.0.0.1:8791/calls')).json();
  const url = await shortcutUrl(page);
  await page.goto('about:blank');
  await page.goto(url);
  await expect(page.getByRole('button', { name: 'Stop recording and transcribe' })).toBeVisible();
  await expect(page).toHaveURL(/#\/tasks\/inbox$/);
  await expect(page.getByRole('textbox', { name: 'New task title' })).toHaveValue('My saved idea.');
  await page.getByRole('textbox', { name: 'New task title' }).fill('Edited while recording.');
  await page.waitForTimeout(1200); // Let the synthetic microphone produce a saved audio chunk.
  await page.screenshot({ path: 'test-results/phone-voice-shortcut.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Stop recording and transcribe' }).click();
  const title = 'Edited while recording. Please draft a packing list.';
  await expect(page.getByRole('textbox', { name: 'New task title' })).toHaveValue(title);
  await expect(page.getByRole('link', { name: title, exact: true })).toHaveCount(0);
  await expect(page.locator('.countdown')).toHaveCount(0);
  expect(await page.evaluate(() => window.voiceProbe.calls)).toBe(1);
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'New task title' })).toHaveValue('');
  expect(await page.evaluate(() => window.voiceProbe.calls)).toBe(0);
  const after: string[] = await (await request.get('http://127.0.0.1:8791/calls')).json();
  expect(after.slice(before.length).filter(method => ['session.create', 'session.resume', 'prompt.submit'].includes(method))).toEqual([]);
});

test('shortcut works in an open app, avoids overlapping recordings and is consumed in browser history', async ({ page }) => {
  await probeMicrophone(page);
  await page.goto('/#/conversations');
  await expect(page.getByRole('heading', { name: 'Conversations', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.voiceProbe.calls)).toBe(0);
  const url = await shortcutUrl(page);
  await page.evaluate(url => { location.hash = new URL(url, location.href).hash; }, url);
  await expect(page.getByRole('button', { name: 'Stop recording and transcribe' })).toBeVisible();
  await page.evaluate(url => { location.hash = new URL(url, location.href).hash; }, url);
  await expect(page).toHaveURL(/#\/tasks\/inbox$/);
  expect(await page.evaluate(() => window.voiceProbe.calls)).toBe(1);
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Cancel dictation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Transcribe saved recording', exact: true })).toBeVisible();
  await page.evaluate(() => { location.hash = '/conversations'; });
  await expect(page.getByRole('heading', { name: 'Conversations', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('textbox', { name: 'New task title' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dictate', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.voiceProbe.calls)).toBe(1);
  expect(await page.evaluate(() => window.voiceProbe.streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
});

test('denied shortcut microphone is explained and can be retried manually without automatic retry', async ({ page }) => {
  await probeMicrophone(page, { denied: true });
  await page.goto(await shortcutUrl(page));
  await expect(page.getByRole('alert')).toContainText('Microphone permission is needed');
  await expect(page).toHaveURL(/#\/tasks\/inbox$/);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'New task title' })).toBeEnabled();
  expect(await page.evaluate(() => window.voiceProbe.calls)).toBe(0);
  await page.evaluate(() => { window.voiceProbe.denied = false; });
  await page.getByRole('button', { name: 'Dictate', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop recording and transcribe' })).toBeVisible();
});

for (const leave of ['cancel', 'navigate', 'background'] as const) {
  test(`${leave} while shortcut permission is pending prevents a late microphone start`, async ({ page }) => {
    await probeMicrophone(page, { delayed: true });
    await page.goto(await shortcutUrl(page));
    await expect(page.getByRole('status').filter({ hasText: 'Starting microphone' })).toBeVisible();
    if (leave === 'cancel') await page.getByRole('button', { name: 'Cancel dictation', exact: true }).click();
    if (leave === 'navigate') {
      await page.evaluate(() => { location.hash = '/conversations'; });
      await expect(page.getByRole('heading', { name: 'Conversations', exact: true })).toBeVisible();
    }
    if (leave === 'background') await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.evaluate(() => window.voiceProbe.release!());
    await expect.poll(() => page.evaluate(() => window.voiceProbe.streams.length)).toBe(1);
    await expect.poll(() => page.evaluate(() => window.voiceProbe.streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
      location.hash = '/tasks/inbox';
    });
    await expect(page.getByRole('button', { name: 'Dictate', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => window.voiceProbe.calls)).toBe(1);
    await expect(page.getByRole('button', { name: 'Transcribe saved recording', exact: true })).toHaveCount(0);
  });
}

test('offline shortcut retains audio across reload and transcribes only when requested after reconnection', async ({ page, context }) => {
  await probeMicrophone(page);
  await page.goto('/');
  const url = await shortcutUrl(page);
  await page.getByRole('textbox', { name: 'New task title' }).fill('Offline capture.');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'New task title' })).toHaveValue('Offline capture.');
  await page.goto('about:blank');
  await context.setOffline(true);
  await page.goto(url);
  await expect(page.getByRole('button', { name: 'Stop recording and transcribe' })).toBeVisible();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Stop recording and transcribe' }).click();
  await expect(page.getByRole('button', { name: 'Transcribe saved recording', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Transcribe saved recording', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.voiceProbe.calls)).toBe(0);
  let transcriptions = 0;
  page.on('request', request => { if (request.url().endsWith('/audio/transcribe')) transcriptions++; });
  await context.setOffline(false);
  await expect(page.locator('.save-state')).toContainText('All changes saved');
  expect(transcriptions).toBe(0);
  await page.getByRole('button', { name: 'Transcribe saved recording', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'New task title' })).toHaveValue('Offline capture. Please draft a packing list.');
  expect(transcriptions).toBe(1);
  await expect(page.locator('.countdown')).toHaveCount(0);
});
