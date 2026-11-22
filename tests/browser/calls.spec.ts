import { test, expect } from '@playwright/test';
import { callsPlugin, openCalls, syntheticCall } from './calls-helpers';

test.beforeEach(async ({ request, context }) => { await callsPlugin(request, 'enable'); await syntheticCall(context); });
test.afterEach(async ({ request }) => { await callsPlugin(request, 'disable'); });

test('Call opens an existing conversation and is absent from an unsent conversation', async ({ page }) => {
  await page.goto('/#/new');
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Call', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.goto('/#/conversation/calls-fixture');
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await page.getByRole('button', { name: 'Call', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start call', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).callFixture.peers)).toBe(0);
});

test('microphone refusal leaves no peer and permits a deliberate retry', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 480 });
  await openCalls(page, request);
  await page.evaluate(() => { (window as any).callFixture.denyMicrophone = true; });
  await page.getByRole('button', { name: 'Start call', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Check browser permissions');
  await expect(page.getByRole('button', { name: 'Call again', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'output/calls/permission-failed-390x480.png' });
  expect(await page.evaluate(() => (window as any).callFixture.peers)).toBe(0);
  await page.evaluate(() => { (window as any).callFixture.denyMicrophone = false; });
  await page.getByRole('button', { name: 'Call again' }).click();
  await expect(page.getByRole('button', { name: 'Mute', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'End call', exact: true }).click();
});

test('hiding during microphone permission stops a late stream without creating a session', async ({ page, request }) => {
  await openCalls(page, request);
  await page.evaluate(() => {
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = constraints => new Promise(resolve => {
      (window as any).callFixture.releaseMicrophone = () => get(constraints).then(resolve);
    });
  });
  await page.getByRole('button', { name: 'Start call', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).callFixture.releaseMicrophone)).toBe('function');
  await page.evaluate(() => (window as any).callFixture.hidden());
  await expect(page.getByRole('status').filter({ hasText: 'Call ended' })).toBeVisible();
  await page.evaluate(() => (window as any).callFixture.releaseMicrophone());
  await expect.poll(() => page.evaluate(() => {
    const fixture = (window as any).callFixture;
    return fixture.tracks.length > 0 && fixture.tracks.every((track: MediaStreamTrack) => track.readyState === 'ended');
  })).toBe(true);
  expect(await page.evaluate(() => (window as any).callFixture.peers)).toBe(0);
});

test('simulated call delegates once, preserves a draft, and keeps work separate from hangup', async ({ page, request }) => {
  await openCalls(page, request);
  const draft = page.getByRole('textbox', { name: 'Message Hermes', exact: true });
  await draft.fill('Keep this unsent typed draft.');
  await page.getByRole('button', { name: 'Start call', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mute', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const fixture = (window as any).callFixture;
    fixture.event({ type: 'session.input_transcript.delta', event_id: 'spoken-1', delta: 'Summarise the synthetic timetable.', start_ms: 1, end_ms: 20 });
    fixture.event({ type: 'session.delegation.created', delegation: { id: 'fixture-one' }, offset_ms: 30 });
    fixture.event({ type: 'session.delegation.created', delegation: { id: 'fixture-one' }, offset_ms: 30 });
  });
  await expect.poll(async () => (await (await request.get('http://127.0.0.1:8791/call-details')).json()).filter((entry: any) => entry.method === 'prompt.submit' && entry.params.text === 'Summarise the synthetic timetable.').length).toBe(1);
  await expect(draft).toHaveValue('Keep this unsent typed draft.');
  await page.getByRole('button', { name: 'Mute', exact: true }).click();
  expect(await page.evaluate(() => (window as any).callFixture.tracks.every((track: MediaStreamTrack) => !track.enabled))).toBe(true);
  await page.getByRole('button', { name: 'End call', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Call ended' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).callFixture.tracks.every((track: MediaStreamTrack) => track.readyState === 'ended'))).toBe(true);
  await page.reload();
  await expect(draft).toHaveValue('Keep this unsent typed draft.');
  await expect(page.getByRole('button', { name: 'Call again' })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).callFixture.peers)).toBe(0);
});

test('navigation retains the owner and hiding ends capture without automatic resume', async ({ page, request }) => {
  await openCalls(page, request);
  await page.getByRole('button', { name: 'Start call', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mute', exact: true })).toBeVisible();
  await page.evaluate(() => { location.hash = '/conversations'; });
  await page.getByRole('link', { name: 'Return to call', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mute', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).callFixture.peers)).toBe(1);
  await page.evaluate(() => (window as any).callFixture.hidden());
  await expect(page.getByRole('status').filter({ hasText: 'Call ended' })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await page.evaluate(() => (window as any).callFixture.peers)).toBe(1);
  await expect(page.getByRole('button', { name: 'Call again' })).toBeEnabled();
});

test('a second window cannot create another call', async ({ page, request, context }) => {
  await openCalls(page, request); await page.getByRole('button', { name: 'Start call', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mute', exact: true })).toBeVisible();
  await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }));
  const second = await context.newPage();
  await openCalls(second, request); await second.getByRole('button', { name: 'Start call', exact: true }).click();
  await expect(second.getByRole('alert')).toContainText('another Herts window');
  expect(await second.evaluate(() => (window as any).callFixture.peers)).toBe(0);
  await page.getByRole('button', { name: 'End call', exact: true }).click();
  await second.close();
});

test('disabling Calls during a call refreshes the plugin and stops capture', async ({ page, request }) => {
  await openCalls(page, request);
  await page.getByRole('button', { name: 'Start call', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mute', exact: true })).toBeVisible();
  await page.route('**/api/v1/state*', route => route.abort());
  await callsPlugin(request, 'disable');
  await expect(page.getByRole('heading', { name: 'Plugin unavailable' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const tracks = (window as any).callFixture.tracks as MediaStreamTrack[];
    return tracks.length > 0 && tracks.every(track => track.readyState === 'ended');
  })).toBe(true);
  expect(await page.evaluate(() => (window as any).callFixture.peers)).toBe(1);
});

test('optional call notification is removed after confirmed hangup', async ({ page, request, context }) => {
  await context.grantPermissions(['notifications']);
  const linked = await openCalls(page, request);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.goto('/#/settings/plugins');
  await page.getByRole('button', { name: 'Call notifications', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Call notifications', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.goto(`/#/plugins/calls/${linked.id}`);
  await page.getByRole('button', { name: 'Start call', exact: true }).click();
  const notices = () => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return (await registration.getNotifications()).filter(notice => notice.data?.pluginId === 'calls').map(notice => notice.title);
  });
  await expect.poll(notices).toEqual(['Call in progress']);
  await page.getByRole('button', { name: 'End call', exact: true }).click();
  await expect.poll(notices).toEqual([]);
});

test('freeze without a close event preserves an unconfirmed outcome and transcript', async ({ page, request }) => {
  await openCalls(page, request); await page.getByRole('button', { name: 'Start call', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mute', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const fixture = (window as any).callFixture; fixture.autoClose = false;
    fixture.event({ type: 'session.input_transcript.delta', delta: 'Keep this synthetic transcript.' });
    document.dispatchEvent(new Event('freeze'));
  });
  await expect(page.getByRole('status').filter({ hasText: 'Closure unconfirmed' })).toBeVisible();
  await expect(page.getByText('App in background')).toBeVisible();
  await page.reload();
  await expect(page.getByText('App in background')).toBeVisible();
  await page.getByRole('button', { name: 'Transcript' }).click();
  await expect(page.getByRole('dialog')).toContainText('Keep this synthetic transcript.');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Transcript' })).toBeFocused();
  expect(await page.evaluate(() => (window as any).callFixture.peers)).toBe(0);
});

test('loading, failed status, retry, and offline conversation preserve controls and draft', async ({ page, request, context }) => {
  await page.setViewportSize({ width: 390, height: 480 });
  let failed = true, release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/plugins/calls/queries/status', async route => {
    if (failed) { await delayed; await route.fulfill({ status: 503, json: { error: 'Synthetic status failure' } }); }
    else await route.continue();
  });
  const result = await request.post('/api/v1/conversations/calls-fixture/context', { headers: { 'x-herts-request': '1' }, data: {} });
  const { context: target } = await result.json();
  await page.goto(`/#/plugins/calls/${target.id}`);
  await expect(page.locator('.calls-screen > .session-bar')).toContainText('Checking voice…');
  await expect(page.getByRole('button', { name: 'Start call', exact: true })).toBeDisabled();
  await page.screenshot({ path: 'output/calls/loading-390x480.png' });
  release();
  await expect(page.getByRole('alert')).toContainText('Voice status could not be loaded');
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'output/calls/status-failed-390x480.png' });
  failed = false; await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start call', exact: true })).toBeEnabled();
  await page.getByRole('textbox', { name: 'Message Hermes', exact: true }).fill('Offline draft retained.');
  await context.setOffline(true);
  await expect(page.getByRole('button', { name: 'Start call', exact: true })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'Message Hermes', exact: true })).toHaveValue('Offline draft retained.');
  await expect(page.locator('.composer')).toBeInViewport();
  const composerBounds = (await page.locator('.composer').boundingBox())!, navigationBounds = (await page.locator('.mobile-nav').boundingBox())!;
  expect(composerBounds.y + composerBounds.height).toBeLessThanOrEqual(navigationBounds.y);
  await page.screenshot({ path: 'output/calls/offline-390x480.png' });
  await context.setOffline(false);
});

test('connection sounds stop at readiness and greeting never repeats on navigation', async ({ page, request }) => {
  const linked = await openCalls(page, request);
  await page.evaluate(() => { (window as any).callFixture.holdSession = true; });
  await page.getByRole('button', { name: 'Start call', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).callFixture.pulses)).toBeGreaterThan(0);
  await expect(page.getByRole('status').filter({ hasText: 'Starting call' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).callFixture.ready)).toBe(true);
  await page.evaluate(() => { const f = (window as any).callFixture; f.event({ type: 'session.started' }); f.event({ type: 'session.started' }); });
  await expect(page.getByRole('button', { name: 'Mute', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).callFixture.tones.every((audio: AudioContext) => audio.state === 'closed'))).toBe(true);
  await page.evaluate(() => { location.hash = '/conversations'; });
  await page.getByRole('link', { name: 'Return to call' }).click();
  expect(await page.evaluate(() => (window as any).callFixture.events.filter((event: any) => event.type === 'session.commentary.append' && event.delegation_id === null).length)).toBe(1);
  await page.getByRole('button', { name: 'End call', exact: true }).click();
  await page.goto('/#/settings/plugins');
  await page.getByRole('button', { name: 'Connection sounds', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connection sounds', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Connection sounds', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.goto(`/#/plugins/calls/${linked.id}`);
  await page.getByRole('button', { name: 'Call again' }).click();
  await expect(page.getByRole('button', { name: 'Mute', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).callFixture.tones.length)).toBe(0);
  await page.getByRole('button', { name: 'End call', exact: true }).click();
});
test('blocked connection sound does not block the call', async ({ page, request }) => {
  await openCalls(page, request);
  await page.evaluate(() => { (window as any).callFixture.blockSound = true; });
  await page.getByRole('button', { name: 'Start call', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mute', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'End call', exact: true }).click();
});
test('transcript groups fragments and preserves earlier reading position', async ({ page, request }) => {
  await openCalls(page, request); await page.getByRole('button', { name: 'Start call', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mute', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Transcript', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('No transcript yet.');
  await expect(page.getByRole('dialog')).not.toContainText('Unsent requests');
  await page.evaluate(() => {
    const f = (window as any).callFixture;
    for (const delta of ['Can', ' you', ' suggest', ' exercises', '?']) f.event({ type: 'session.input_transcript.delta', delta });
    f.event({ type: 'session.output_transcript.delta', delta: 'Yes. Here are some options.' });
  });
  await expect(page.locator('.call-turn')).toHaveCount(2);
  await expect(page.locator('.call-turn').first()).toHaveText('YouCan you suggest exercises?');
  await page.evaluate(() => {
    const f = (window as any).callFixture;
    for (let i = 0; i < 30; i++) f.event({ type: i % 2 ? 'session.input_transcript.delta' : 'session.output_transcript.delta', delta: `Synthetic long turn ${i}. ` + 'Details about the requested exercise. '.repeat(8) });
  });
  const scroll = page.locator('.call-transcript-scroll');
  await expect.poll(() => scroll.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThan(32);
  await scroll.evaluate(node => { node.scrollTop = 0; node.dispatchEvent(new Event('scroll')); });
  await page.evaluate(() => (window as any).callFixture.event({ type: 'session.output_transcript.delta', delta: 'A later update.' }));
  await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBe(0);
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'End call', exact: true }).click();
});

for (const event of ['cancel', 'hidden', 'freeze', 'pagehide', 'offline']) {
  test(`connecting audio stops on ${event}`, async ({ page, request }) => {
    await openCalls(page, request);
    await page.evaluate(() => { (window as any).callFixture.holdSession = true; });
    await page.getByRole('button', { name: 'Start call', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).callFixture.pulses)).toBeGreaterThan(0);
    if (event === 'cancel') await page.getByRole('button', { name: 'End call', exact: true }).click();
    else await page.evaluate(event => {
      if (event === 'hidden') (window as any).callFixture.hidden();
      else (event === 'freeze' ? document : window).dispatchEvent(new Event(event));
    }, event);
    await expect.poll(() => page.evaluate(() => (window as any).callFixture.tones.every((audio: AudioContext) => audio.state === 'closed'))).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as any).callFixture.tracks.every((track: MediaStreamTrack) => track.readyState === 'ended'))).toBe(true);
  });
}

test('Calls settings recover from a status failure and keep device controls available offline', async ({ page, context }) => {
  let failed = true;
  await page.route('**/plugins/calls/queries/status', route => failed
    ? route.fulfill({ status: 503, json: { error: 'Synthetic failure' } }) : route.continue());
  await page.goto('/#/settings/plugins');
  await expect(page.getByText('Voice status could not be loaded. Select Retry.')).toBeVisible();
  failed = false;
  await page.getByRole('region', { name: 'Configured in Hermes', exact: true }).getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('#calls-voice')).toHaveText('marin');
  await context.setOffline(true);
  await expect(page.getByRole('button', { name: 'Connection sounds', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Connection sounds', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connection sounds', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await context.setOffline(false);
});

for (const width of [390, 1280]) test(`call mode retains conversation page actions at ${width}px`, async ({ page, request }) => {
  await page.setViewportSize({ width, height: 844 });
  const linked = await openCalls(page, request);
  await page.goto('/#/conversation/calls-fixture');
  const actions = () => page.getByRole('button', { name: 'Actions', exact: true });
  const menu = () => page.getByRole('dialog', { name: 'Page actions', exact: true });
  await actions().click();
  await expect(menu().getByRole('button', { name: 'Rename conversation', exact: true })).toBeVisible();
  const expected = (await menu().locator('.action-row').allTextContents()).map(text => text.trim()).filter(text => text !== 'Call');
  await page.screenshot({ path: `output/calls/actions-reference-${width}.png` });
  await page.keyboard.press('Escape');
  await page.goto(`/#/plugins/calls/${linked.id}`);
  await page.getByRole('textbox', { name: 'Message Hermes', exact: true }).fill('Keep this draft while using call actions.');
  for (const active of [false, true]) {
    if (active) {
      await page.getByRole('button', { name: 'Start call', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Mute', exact: true })).toBeVisible();
    }
    await actions().click();
    await expect(menu().getByRole('button', { name: 'Rename conversation', exact: true })).toBeVisible();
    expect((await menu().locator('.action-row').allTextContents()).map(text => text.trim())).toEqual(expected);
    await expect(menu().locator('h1')).toHaveCount(0);
    await page.screenshot({ path: `output/calls/actions-${active ? 'active' : 'ready'}-${width}.png` });
    await menu().getByRole('button', { name: 'Hide conversation', exact: true }).click();
    await menu().getByRole('button', { name: 'Unhide conversation', exact: true }).click();
    await expect(menu().getByRole('button', { name: 'Hide conversation', exact: true })).toBeEnabled();
    await menu().getByRole('button', { name: 'Make a task', exact: true }).click();
    const task = page.getByRole('dialog', { name: 'Make a task', exact: true });
    await expect(task).toBeVisible();
    await task.getByRole('button', { name: 'Cancel', exact: true }).click();
    if (!await menu().isVisible()) await actions().click();
    await menu().getByRole('button', { name: 'Rename conversation', exact: true }).click();
    const rename = page.getByRole('dialog', { name: 'Rename conversation', exact: true });
    await expect(rename.getByRole('textbox', { name: 'Conversation title', exact: true })).toBeEditable();
    await rename.getByRole('textbox', { name: 'Conversation title', exact: true }).fill('Do not save this temporary title');
    await rename.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(rename).toHaveCount(0);
    if (await menu().isVisible()) await page.keyboard.press('Escape');
    await expect(actions()).toBeFocused();
    await expect(page.getByRole('textbox', { name: 'Message Hermes', exact: true })).toHaveValue('Keep this draft while using call actions.');
  }
  await page.getByRole('button', { name: 'End call', exact: true }).click();
});


test('another conversation keeps the original call controls and cannot start a second call', async ({ page, request }) => {
  const linked = await openCalls(page, request);
  await page.getByRole('button', { name: 'Start call', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mute', exact: true })).toBeVisible();
  const result = await request.post('/api/v1/conversations/existing/context', { headers: { 'x-herts-request': '1' }, data: {} });
  const { context } = await result.json();
  await page.evaluate(id => { location.hash = `/plugins/calls/${id}`; }, context.id);
  await expect(page.getByRole('button', { name: 'Start call', exact: true })).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: 'Another call is open' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Return to call', exact: true })).toHaveAttribute('href', `#/plugins/calls/${linked.id}`);
  await expect(page.getByRole('button', { name: 'End call', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'End call', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start call', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).callFixture.peers)).toBe(1);
});
