import { openSettingsGroups } from './composer-helpers';
import { pageAction, closePageActions } from './composer-helpers';
import { openConnectionDetails } from './navigation-helpers';
import { test, expect } from '@playwright/test';
import { pinnedPlugin, pinnedReady, seedPin } from './pinned-helpers';
import { builtinThemes, themeStorageKey } from '../../shared/themeValues';
import { detailsField, saveTitle } from './composer-helpers';

for (const [width, height] of [[320, 844], [390, 844], [768, 844], [1280, 844], [390, 480]]) {
  test(`first send uses the conversation layout in Press at ${width}x${height}`, async ({ page, request }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/#/conversation/existing');
    await expect(page.locator('[data-history-message]').first()).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Message Hermes', exact: true })).toBeEditable();
    await page.screenshot({ path: `output/first-send/existing-${width}x${height}.png` });
    await page.goto('/#/new');
    const editor = page.getByRole('textbox', { name: 'Message Hermes', exact: true });
    const text = 'Review the travel plan, including the accessible station entrance and the return journey.\n\nSources: https://example.com/' + 'journey-details/'.repeat(12);
    await editor.fill(text);
    const title = 'Review the travel plan and confirm all arrangements for the project meeting with the regional team';
    await (await detailsField(page, 'Conversation title')).fill(title); await saveTitle(page); await closePageActions(page);
    await page.locator('.session-settings-button').click();
    await expect(page.getByRole('dialog', { name: 'Conversation settings', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.session-settings-button')).toBeFocused();
    await page.locator('input[type=file]').setInputFiles({ name: 'travel-plan-and-accessibility-notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic travel plan') });
    await expect(page.getByRole('button', { name: 'Remove travel-plan-and-accessibility-notes.txt' })).toBeVisible();
    await request.post('/__test/session-creation', { headers: { 'x-herts-request': '1' }, data: { hold: true } });
    try {
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      const message = page.locator('.outgoing-message');
      await expect(message).toContainText(text);
      await expect(message).toContainText('1 attachment');
      await expect(message.getByRole('status')).toContainText('preparing conversation');
      await expect(editor).toHaveValue('');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'press');
      await expect(page.getByRole('link', { name: 'Back to Conversations', exact: true })).toHaveAttribute('href', '#/conversations');
      await page.getByRole('link', { name: 'Back to Conversations', exact: true }).focus();
      await expect(page.getByRole('link', { name: 'Back to Conversations', exact: true })).toBeFocused();
      for (const selector of ['.conversation-page-header', '.conversation-scroll', '.composer', '.outgoing-message']) {
        const bounds = (await page.locator(selector).boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
      }
      await expect(editor).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `output/first-send/pending-${width}x${height}.png` });
      await page.getByRole('button', { name: 'Actions', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Page actions', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Actions', exact: true })).toBeFocused();
    } finally { await request.post('/__test/session-creation', { headers: { 'x-herts-request': '1' }, data: { hold: false } }); }
    await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase', 'complete');
    await expect(page.locator('[data-history-message].from-user')).toContainText('Review the travel plan');
    await page.screenshot({ path: `output/first-send/confirmed-${width}x${height}.png` });
  });
}

for (const width of [320, 1280]) {
  test(`unconfirmed message recovery stays compact at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.route('**/api/v1/actions', route => route.abort());
    await page.goto('/#/new');
    const editor = page.getByRole('textbox', { name: 'Message Hermes', exact: true });
    await editor.fill('Keep this message and attachment available while checking confirmation.');
    await page.locator('input[type=file]').setInputFiles({ name: 'journey-planning-notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic planning notes') });
    await expect(page.getByRole('button', { name: 'Remove journey-planning-notes.txt' })).toBeVisible();
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const recovery = page.locator('.outgoing-message .submission-recovery');
    const check = recovery.getByRole('button', { name: 'Check again', exact: true });
    await expect(check).toBeEnabled();
    await expect(recovery.getByRole('status')).toHaveText('Unconfirmed');
    await expect(page.locator('.composer-wrap .submission-recovery')).toHaveCount(0);
    expect(Math.abs((await check.boundingBox())!.y - (await recovery.locator('summary').boundingBox())!.y)).toBeLessThan(1);
    await check.focus(); await expect(check).toBeFocused();
    let hold = true, release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await check.evaluate(button => button.addEventListener('click', () => {
      (window as any).holdConfirmationCheck = true;
    }, { once: true, capture: true }));
    await page.route('**/api/v1/state', async route => {
      if (hold && await page.evaluate(() => !!(window as any).holdConfirmationCheck)) await gate;
      await route.continue();
    });
    try {
      await check.click();
      await expect(recovery.getByRole('status')).toHaveText('Checking…');
      await expect(check).toBeDisabled();
      await page.screenshot({ path: `output/first-send/checking-${width}.png` });
      hold = false; release();
      await expect(check).toBeEnabled();
      await expect(recovery.getByRole('status')).toHaveText('Unconfirmed');
      await page.screenshot({ path: `output/first-send/unconfirmed-compact-${width}.png` });
      await recovery.locator('summary').focus();
      await page.keyboard.press('Enter');
      const cancel = recovery.getByRole('button', { name: 'Cancel if not yet received', exact: true });
      await expect(cancel).toBeVisible();
      for (const control of [recovery, check, cancel]) {
        const bounds = (await control.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      }
      await page.screenshot({ path: `output/first-send/unconfirmed-${width}.png` });
      await cancel.click();
      await expect(recovery).toHaveCount(0);
      await expect(editor).toHaveValue('Keep this message and attachment available while checking confirmation.');
      await editor.focus();
      await expect(page.getByRole('button', { name: 'Remove journey-planning-notes.txt' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
    } finally { hold = false; release(); }
  });
}

test('model settings wrap only when the available width requires it', async ({ page }) => {
  await page.route('**/api/v1/session-settings?*', async route => {
    const response = await route.fetch();
    const view = await response.json();
    view.current = { ...view.current, model: { provider: 'configured', id: 'gpt-6.1-sol' }, effort: 'medium', fast: true };
    delete view.wireEffort;
    await route.fulfill({ response, json: view });
  });
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/#/conversation/existing');
    await page.getByRole('textbox', { name: 'Message Hermes', exact: true }).click();
    const button = page.locator('.session-settings-button');
    await expect(button).toContainText('gpt-6.1-sol');
    await expect(button.locator('.session-settings-effort')).toHaveText('medium · fast');
    const model = (await button.locator('.session-settings-model').boundingBox())!;
    const effort = (await button.locator('.session-settings-effort').boundingBox())!;
    if (width >= 390) expect(effort.y).toBe(model.y);
    else expect(effort.y).toBeGreaterThan(model.y);
    expect(await button.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: `test-results/model-settings-wrap-${width}.png` });
    await button.focus();
    await expect(button).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Conversation settings', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(button).toBeFocused();
  }
});

async function bots(request: import('@playwright/test').APIRequestContext, action: 'enable' | 'disable') {
  const { catalogue } = await (await request.get('/api/v1/plugins')).json();
  expect((await request.post('/api/v1/plugins/bots/manage', { headers: { 'x-herts-request': '1' }, data: { action, revision: catalogue.revision } })).ok()).toBe(true);
}
test.afterEach(async ({ page, request }) => { await page.unrouteAll({ behavior: 'wait' }); await bots(request, 'disable'); await pinnedPlugin(request, 'disable'); });

for (const missing of ['PageHeader', 'DragHandle', 'DragPreview', 'ComposerPlaceholder', 'captureLayout']) test(`an app without ${missing} gets an actionable plugin update message`, async ({ page }) => {
  await page.addInitScript(missing => {
    Object.defineProperty(globalThis, '__HERTS_PLUGIN_RUNTIME__', {
      configurable: true,
      set(runtime) {
        Object.defineProperty(globalThis, '__HERTS_PLUGIN_RUNTIME__', { configurable: true, writable: true, value: { ...runtime, sdk: { ...runtime.sdk, ...(missing === 'captureLayout' ? { composerCapabilities: { ...runtime.sdk.composerCapabilities, captureLayout: undefined } } : { [missing]: undefined }) } } });
      },
    });
  }, missing);
  await page.goto('/#/settings/plugins');
  await expect(page.getByText('Update Herts in Settings → App updates to use this version of Tasks.', { exact: true })).toBeVisible();
  if (missing !== 'captureLayout') await expect(page.getByText('Update Herts in Settings → App updates to use this version of Reading.', { exact: true })).toBeVisible();
  await page.goto('/#/settings'); await openSettingsGroups(page);
  await expect(page.getByRole('button', { name: 'Check for updates', exact: true })).toBeVisible();
});

for (const theme of builtinThemes) {
  test(`${theme.name}: page controls fit narrow phones and shared dialogs remain usable`, async ({ page, request }) => {
    test.setTimeout(240_000);
    await bots(request, 'enable');
    // Mixed roster content without creating profiles or sending model prompts.
    await page.route('**/api/v1/state', async route => {
      const response = await route.fetch(), data = await response.json();
      const records = data.pluginData?.bots?.records;
      if (records?.roster?.length) {
        const base = { ...records.roster[0], hidden: false, hasAvatar: false, active: false, updatedAt: 0, preview: '', description: '' };
        records.roster.push(
          { ...base, name: 'empty-preview', title: 'New assistant' },
          { ...base, name: 'description-preview', title: 'Project planning and research assistant', preview: '   ', description: 'Research sources at https://example.com/' + 'long-path/'.repeat(20) },
          { ...base, name: 'conversation-preview', title: 'Briefing assistant', preview: 'The latest conversation summary. '.repeat(15), active: true, updatedAt: Date.now() },
        );
      }
      await route.fulfill({ response, json: data });
    });
    await page.route('**/api/v1/plugins/bots/queries/result',route=>route.fulfill({json:{conversationId:'profile:research:synthetic-result',messages:[{role:'assistant',index:0,timestamp:1791288000,text:'# Research summary\n\n'+('A paragraph with a [source](https://example.com/'+ 'long-path'.repeat(15)+') and **useful findings**.\n\n').repeat(8)+'```text\n'+ 'output '.repeat(100)+'\n```'}],text:'',hasMore:false,nextOffset:200}}));
    await page.addInitScript(({ key, theme }) => localStorage.setItem(key, JSON.stringify({ id: theme.id, theme })), { key: themeStorageKey, theme });
    const title = `${theme.name}: Review the shared project plan and prepare a clear outline for the next meeting`;
    const taskId = crypto.randomUUID();
    expect((await request.post('/api/v1/sync', { headers: { 'x-herts-request': '1' }, data: { id: crypto.randomUUID(), taskId, kind: 'create', title, at: Date.now() } })).ok()).toBe(true);
    expect((await request.post('/api/v1/reading/sync', { headers: { 'x-herts-request': '1' }, data: { id: crypto.randomUUID(), itemId: crypto.randomUUID(), contextId: crypto.randomUUID(), kind: 'create', title, url: 'https://example.com/ui-consistency', at: Date.now() } })).ok()).toBe(true);

    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ['/tasks/inbox', '/conversations', '/reading', '/settings', '/settings/plugins', '/plugins/bots', '/plugins/bots/research/routines', '/plugins/bots/research/routines/daily/results', '/plugins/bots/research/routines/daily/results/run-1']) {
        await page.goto(`/#${path}`);
        await expect(page.locator('.page-header h1')).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id);
        if (path === '/tasks/inbox') await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
        if (path === '/tasks/inbox' && width <= 1000) {
          const strip = (await page.locator('.task-space-bar').boundingBox())!;
          expect(strip.height).toBeLessThanOrEqual(50);
          expect(strip.x).toBe(0);
          expect(strip.width).toBe(width);
          const tab = page.locator('.space-tab.active');
          const underline = await tab.evaluate(e => {
            const style = getComputedStyle(e, '::after');
            return { left: parseFloat(style.left), right: parseFloat(style.right) };
          });
          expect(underline.left).toBeGreaterThan(0);
          expect(underline.right).toBeGreaterThan(0);
        }

        if (path === '/reading') await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
        if (path === '/tasks/inbox' || path === '/reading') {
          const targets = await page.locator('.task-list .task-row').first().evaluate(row => ({
            completion: row.querySelector('.completion-button')!.getBoundingClientRect().right,
            title: row.querySelector('.task-title')!.getBoundingClientRect().left,
          }));
          expect(targets.completion).toBeLessThanOrEqual(targets.title);
        }
        if (path === '/conversations') await expect(page.locator('.conversation-row').first()).toBeVisible();
        if (path === '/plugins/bots') {
          const roster = page.locator('.bots-roster');
          await expect(roster.getByRole('link', { name: 'New assistant', exact: true })).toBeVisible();
          await expect(roster.getByRole('link', { name: 'Project planning and research assistant', exact: true }).locator('.item-preview')).toContainText('Research sources');
          const rows = await roster.locator('.item-row').evaluateAll(nodes => nodes.map(node => {
            const box = node.getBoundingClientRect(), wrapper = node.closest('.conversation-item')!.getBoundingClientRect();
            return { height: box.height, wrapperHeight: wrapper.height, href: node.getAttribute('href'), bodyBottom: node.querySelector('.item-row-body')!.getBoundingClientRect().bottom, bottom: box.bottom };
          }));
          expect(rows.length).toBeGreaterThanOrEqual(5);
          await expect(roster.getByRole('link', { name: 'New assistant', exact: true }).locator('.item-preview')).toHaveCount(0);
          for (const row of rows) {
            expect(row.wrapperHeight - row.height).toBeLessThanOrEqual(3);
            expect(row.bodyBottom).toBeLessThanOrEqual(row.bottom);
            expect(row.href).toMatch(/^#\/plugins\/bots\/[a-z0-9_-]+$/);
          }
          const row=page.locator('.conversation-item').filter({has:page.getByRole('link',{name:'Researcher',exact:true})});
          await expect(row.getByRole('button',{name:'Hide Researcher',exact:true})).toBeEnabled();
          const box=(await row.boundingBox())!;await page.mouse.move(box.x+20,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+130,box.y+box.height/2,{steps:10});
          expect(await row.locator('.conversation-item-content').evaluate(node=>new DOMMatrix(getComputedStyle(node).transform).m41)).toBeGreaterThanOrEqual(100);
          await expect(row.locator('.conversation-swipe-action')).toHaveText('Edit bot');
          if(['fieldwork','press'].includes(theme.id)&&[390,1280].includes(width))await page.screenshot({path:`test-results/ui-${theme.id}-bots-right-swipe-${width}.png`});
          await row.dispatchEvent('pointercancel',{pointerId:1});await page.mouse.up();await expect(page.getByRole('dialog')).toHaveCount(0);
        }
        if (path === '/plugins/bots/research/routines') await expect(page.getByRole('heading', { name: 'research briefing', exact: true })).toBeVisible();
        if (path === '/settings') { await openSettingsGroups(page);
          const voice=page.getByLabel('Voice on this device');
          await expect(voice).toHaveValue('device');await voice.focus();await expect(voice).toBeFocused();
          const bounds=(await voice.boundingBox())!;
          expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width+1);
          await page.screenshot({path:`test-results/speech-settings-${theme.id}-${width}.png`});
        }
        if (path === '/settings/plugins') await expect(page.getByRole('heading', { name: 'Task spaces', exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme.id} ${path} at ${width}px`).toBe(true);
        for (const control of await page.locator('.page-header-actions a, .page-header-actions button, .section-nav>a').all()) {
          await control.focus();
          const bounds = (await control.boundingBox())!;
          expect(bounds.height).toBeGreaterThanOrEqual(44);
          expect(bounds.x).toBeGreaterThanOrEqual(0);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
        }
        if (path === '/tasks/inbox') await page.locator('.mobile-lists [aria-current=page]').focus();
        if ([320, 390, 768, 1280].includes(width)) {
          await page.screenshot({ path: `test-results/ui-${theme.id}-${path.slice(1).replaceAll('/', '-')}-${width}.png`, fullPage: path.startsWith('/settings') || path === '/plugins/bots' });
        }
      }
    }
    // Populated forms, errors and focused fields at each target width, including a keyboard-sized viewport.
    for(const width of [320,390,768,1280]){
      await page.setViewportSize({width,height:480});
      await page.goto('/#/plugins/bots/research');await expect(page.getByLabel('Message Researcher')).toBeVisible();
      await expect(page.getByRole('link',{name:'Routines',exact:true})).toBeVisible();await expect(page.locator('.conversation-page-header').getByRole('button',{name:'Actions',exact:true})).toBeVisible();
      const history=await page.locator('.conversation-scroll').boundingBox(),composer=await page.locator('.composer-wrap').boundingBox();expect(history!.height).toBeGreaterThan(30);expect(history!.y+history!.height).toBeLessThanOrEqual(composer!.y+1);
      const bottom=width<=1000?await page.locator('.mobile-nav').evaluate(node=>node.getBoundingClientRect().top):480;
      expect(composer!.y+composer!.height).toBeLessThanOrEqual(bottom);
      await page.screenshot({path:`test-results/ui-${theme.id}-bot-chat-${width}.png`});
      // Focusing expands the composer; its controls must remain reachable inside
      // the fixed viewport even when settings and draft status consume space.
      await page.getByLabel('Message Researcher').fill('An unsent short-window draft');
      await page.getByRole('button',{name:/^(Send|Send to Hermes)$/,exact:true}).scrollIntoViewIfNeeded();
      await page.locator('.composer-wrap').evaluate(node=>{node.scrollTop=node.scrollHeight;});
      const expanded=await page.locator('.composer-wrap').boundingBox(),send=await page.getByRole('button',{name:/^(Send|Send to Hermes)$/,exact:true}).boundingBox();
      expect(expanded!.y+expanded!.height).toBeLessThanOrEqual(bottom);expect(send!.y).toBeGreaterThanOrEqual(expanded!.y);expect(send!.y+send!.height).toBeLessThanOrEqual(expanded!.y+expanded!.height-5);
      await page.screenshot({path:`test-results/ui-${theme.id}-bot-chat-expanded-${width}.png`});
      await page.getByRole('button',{name:'Collapse message box',exact:true}).click();
      if (!await page.getByRole('button', {name:'Edit bot',exact:true}).isVisible()) await page.locator('.conversation-page-header').getByRole('button',{name:'Actions',exact:true}).click(); await page.getByRole('button',{name:'Edit bot',exact:true}).click();await page.getByRole('textbox',{name:'Persona',exact:true}).fill('Long persona with https://example.com/'+ 'instructions'.repeat(80));
      await page.getByRole('textbox',{name:'Persona',exact:true}).focus();
      const field=await page.getByRole('textbox',{name:'Persona',exact:true}).boundingBox(),footer=await page.locator('.form-dialog-footer').boundingBox();expect(field!.y+field!.height).toBeLessThanOrEqual(footer!.y+1);
      await page.screenshot({path:`test-results/ui-${theme.id}-bot-form-${width}.png`});await page.keyboard.press('Escape');
      await page.goto('/#/plugins/bots/research/routines');await page.getByRole('button',{name:'New routine',exact:true}).click();await page.getByLabel('Name',{exact:true}).fill('Long routine '+ 'title '.repeat(25));await page.getByRole('textbox',{name:'Instructions',exact:true}).fill('Detailed instructions '+ 'https://example.com/long-path/'.repeat(25));
      await page.getByRole('textbox',{name:'Instructions',exact:true}).focus();const instruction=await page.getByRole('textbox',{name:'Instructions',exact:true}).boundingBox(),actions=await page.locator('.form-dialog-footer').boundingBox();expect(instruction!.y+instruction!.height).toBeLessThanOrEqual(actions!.y+1);
      await page.screenshot({path:`test-results/ui-${theme.id}-routine-form-${width}.png`});await page.keyboard.press('Escape');
    }
    await page.setViewportSize({width:390,height:844});await page.goto('/#/plugins/bots');await page.getByRole('button',{name:'New bot',exact:true}).click();
    // Drive the same viewport events as a keyboard. Direct CSS overrides race
    // with useVisualViewport's pending focus/resize animation frame.
    await page.evaluate(() => {
      const viewport = window.visualViewport!;
      Object.defineProperty(viewport, 'height', { configurable: true, value: 330 });
      Object.defineProperty(viewport, 'offsetTop', { configurable: true, value: 90 });
      viewport.dispatchEvent(new Event('resize'));
      viewport.dispatchEvent(new Event('scroll'));
    });
    try {
      await expect(page.getByLabel('Bot name', { exact: true })).toBeEditable();
      await page.getByLabel('Bot name', { exact: true }).focus();
      await expect(page.getByLabel('Bot name', { exact: true })).toBeFocused();
      await expect(page.locator('body')).toHaveClass(/keyboard-open/);
      await expect.poll(async () => {
        const box = (await page.getByRole('dialog').boundingBox())!;
        return box.y >= 90 && box.y + box.height <= 420;
      }).toBe(true);
      // A subsequent focus update must retain the simulated keyboard bounds.
      await page.getByRole('textbox', { name: 'Description', exact: true }).focus();
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const keyboardDialog = (await page.getByRole('dialog').boundingBox())!;
      expect(keyboardDialog.y).toBeGreaterThanOrEqual(90);
      expect(keyboardDialog.y + keyboardDialog.height).toBeLessThanOrEqual(420);
      await page.screenshot({ path: `test-results/ui-${theme.id}-bot-keyboard-dialog.png` });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    } finally {
      await page.evaluate(() => {
        const viewport = window.visualViewport!;
        Reflect.deleteProperty(viewport, 'height');
        Reflect.deleteProperty(viewport, 'offsetTop');
        viewport.dispatchEvent(new Event('resize'));
        viewport.dispatchEvent(new Event('scroll'));
      });
    }
    await page.setViewportSize({ width: 320, height: 900 });
    for (const path of ['/tasks/inbox', '/reading']) {
      await page.goto(`/#${path}`);
      const reorderButtons = await page.locator('.list-drag-handle').evaluateAll(nodes => nodes.map(node => {
        const { width, height } = node.getBoundingClientRect(); return { width, height };
      }));
      expect(reorderButtons.length).toBeGreaterThan(0);
      for (const bounds of reorderButtons) {
        expect(bounds.width).toBeGreaterThanOrEqual(44);
        expect(bounds.height).toBeGreaterThanOrEqual(44);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    for (const path of ['/plugins/bots', '/plugins/bots/research/routines']) {
      await page.goto(`/#${path}`);
      await page.getByRole('button', { name: path.endsWith('routines') ? 'New routine' : 'New bot', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      if (!path.endsWith('routines')) await dialog.getByText('Model and profile settings', { exact: true }).click();
      const fields = await dialog.locator('input:not([type="checkbox"]), select, textarea').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).map(node => {
        const style = getComputedStyle(node), rect = node.getBoundingClientRect();
        return { search: node.getAttribute('type') === 'search', border: style.borderWidth, font: style.fontSize, radius: style.borderRadius, expected: getComputedStyle(document.documentElement).getPropertyValue('--radius-control').trim(), height: rect.height, left: rect.left, right: rect.right };
      }));
      for (const field of fields) {
        expect(field.font).toBe('16px');
        // Search has a styled container; regular form fields own their border.
        if (!field.search) expect(field.radius).toBe(field.expected);
        else expect(field.border).toBe('0px');
        expect(field.left).toBeGreaterThanOrEqual(0); expect(field.right).toBeLessThanOrEqual(320);
      }
      expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
    }
    await page.goto('/#/settings'); await openSettingsGroups(page);
    await page.getByRole('button', { name: 'Edit conversation defaults', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const fields = await dialog.locator('input, select').evaluateAll(nodes => nodes.map(node => {
      const style = getComputedStyle(node), bounds = node.getBoundingClientRect();
      return { search:node.getAttribute('type')==='search', font: style.fontSize, radius: style.borderRadius, expectedRadius: getComputedStyle(document.documentElement).getPropertyValue('--radius-control').trim(), height: bounds.height, right: bounds.right };
    }));
    for (const field of fields) {
      expect(field.font).toBe('16px');
      if(!field.search)expect(field.radius).toBe(field.expectedRadius);
      expect(field.height).toBeGreaterThanOrEqual(44);
      expect(field.right).toBeLessThanOrEqual(320);
    }
    await page.screenshot({path:`test-results/ui-${theme.id}-conversation-settings-320.png`});
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit conversation defaults', exact: true })).toBeFocused();
  });
}

for (const theme of builtinThemes) {
  test(`${theme.name}: pinned notifications match shared lists and conversation controls`, async ({ page, request, context }) => {
    test.setTimeout(180_000);
    await pinnedPlugin(request, 'enable'); await context.grantPermissions(['notifications']);
    await page.addInitScript(({ key, theme }) => localStorage.setItem(key, JSON.stringify({ id: theme.id, theme })), { key: themeStorageKey, theme });
    await pinnedReady(page);
    const title = 'Review the project plan and reference https://example.com/' + 'long-reference-without-spaces'.repeat(20);
    await seedPin(page, title); await seedPin(page, 'Prepare an agenda, review the research notes, and confirm the next project meeting');
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/#/conversations'); await expect(page.locator('.conversation-row').first()).toBeVisible();
      await page.screenshot({ path: `test-results/pinned-${theme.id}-comparison-${width}.png` });
      await page.goto('/#/plugins/pinned'); await expect(page.locator('.pinned-list .item-row')).toHaveCount(2);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const row of await page.locator('.pinned-list .item-row').all()) {
        const titleBounds = (await row.locator('.draft-open').boundingBox())!;
        const actionBounds = (await row.getByRole('button', { name: /^Unpin:/ }).boundingBox())!;
        expect(Math.abs(titleBounds.y + titleBounds.height / 2 - actionBounds.y - actionBounds.height / 2)).toBeLessThan(2);
      }
      const searchBounds = (await page.locator('.search-field').boundingBox())!;
      const listBounds = (await page.locator('.pinned-list').boundingBox())!;
      expect(listBounds.y - searchBounds.y - searchBounds.height).toBeGreaterThanOrEqual(16);
      const links = page.locator('.pinned-list a');
      for (const link of await links.all()) await expect(link).toHaveAttribute('href', '#/conversation/existing');
      const search = page.getByRole('searchbox', { name: 'Search pinned notifications' });
      await search.focus(); await expect(search).toBeFocused();
      await page.keyboard.press('Tab'); await expect(page.locator('.pinned-list a').first()).toBeFocused();
      for (const control of await page.locator('.pinned-list button, .search-field').all()) {
        const bounds = (await control.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
        expect(bounds.height).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({ path: `test-results/pinned-${theme.id}-list-${width}.png` });
      await search.fill('no matching notification'); await expect(page.getByRole('heading', { name: 'No pins match this search' })).toBeVisible();
      await page.getByRole('button', { name: 'Clear search pinned notifications' }).click(); await expect(page.locator('.pinned-list .item-row')).toHaveCount(2);
      await context.clearPermissions();
      const retryPins = () => page.evaluate(async () => {
        const service = (globalThis as any).__HERTS_PLUGIN_RUNTIME__.sdk.pluginNotifications('pinned');
        for (const row of await service.list()) await service.retry(row.key);
      });
      await retryPins(); await expect(page.locator('.pinned-list').getByRole('button', { name: 'Retry', exact: true })).toHaveCount(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const control of await page.locator('.pinned-list button').all()) {
        const bounds = (await control.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
      }
      await page.screenshot({ path: `test-results/pinned-${theme.id}-failure-${width}.png` });
      await context.grantPermissions(['notifications']); await retryPins();
      await expect(page.locator('.pinned-list').getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
      await page.setViewportSize({ width, height: 480 }); await page.goto('/#/conversation/existing');
      const pin = await pageAction(page, 'button', 'Pin notification'); await expect(pin).toBeEnabled();
      await pin.focus(); await expect(pin).toBeFocused();
      const bounds = (await pin.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      for (const control of await page.locator('.conversation-toolbar button, .conversation-toolbar a').all()) {
        if (!await control.isVisible()) continue;
        const box = (await control.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const composer = (await page.locator('.composer-wrap').boundingBox())!;
      const bottom = width <= 1000 ? await page.locator('.mobile-nav').evaluate(node => node.getBoundingClientRect().top) : 480;
      expect(composer.y + composer.height).toBeLessThanOrEqual(bottom + 1);
      await page.screenshot({ path: `test-results/pinned-${theme.id}-conversation-${width}.png` });
    }
  });
}

for (const theme of builtinThemes) {
  test(`${theme.name}: undo toast fits the shared lists`, async ({ page, request }) => {
    await page.addInitScript(({ key, theme }) => localStorage.setItem(key, JSON.stringify({ id: theme.id, theme })), { key: themeStorageKey, theme });
    const title = `${theme.name}: Undo layout ` + 'long task title https://example.com/reference '.repeat(8);
    await request.post('/api/v1/sync', { headers: { 'x-herts-request': '1' }, data: { id: crypto.randomUUID(), taskId: crypto.randomUUID(), kind: 'create', title, at: Date.now() } });
    await request.post('/api/v1/reading/sync', { headers: { 'x-herts-request': '1' }, data: { id: crypto.randomUUID(), itemId: crypto.randomUUID(), contextId: crypto.randomUUID(), kind: 'create', title, url: `https://example.com/undo-${theme.id}`, at: Date.now() } });
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ['/tasks/inbox', '/reading', '/conversations']) {
        await page.goto(`/#${path}`);
        if (path === '/conversations') {
          await page.getByLabel('Search conversations').fill('Header conversation');
          const hide = page.locator('[data-conversation-key="header-history"]').getByRole('button', { name: 'Hide', exact: true });
          await hide.focus();
          await page.keyboard.press('Enter');
        } else {
          await page.getByRole('button', { name: `${path === '/reading' ? 'Mark read:' : 'Complete'} ${title}`, exact: true }).click();
        }
        const toast = page.locator('.undo-toast');
        await expect(toast).toBeVisible();
        const bounds = (await toast.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        expect(bounds.height).toBeLessThanOrEqual(64);
        const bottom = width <= 1000 ? (await page.locator('.mobile-nav').boundingBox())!.y : 900;
        expect(bounds.y + bounds.height).toBeLessThan(bottom);
        await toast.getByRole('button', { name: 'Undo', exact: true }).focus();
        await expect(toast.getByRole('button', { name: 'Undo', exact: true })).toBeFocused();
        await page.screenshot({ path: `test-results/undo-${theme.id}-${path.split('/')[1]}-${width}.png` });
        await page.keyboard.press('Enter');
        await expect(toast).toHaveCount(0);
        await expect(page.locator('.save-state')).toHaveText('Changes synced');
        await expect(page.locator('.conflict-banner')).toHaveCount(0);
        if (path === '/conversations') await expect(page.locator('[data-conversation-key="header-history"]')).toBeVisible();
        else await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
      }
    }
  });
}

for (const theme of builtinThemes) test(`${theme.name}: speech preparation and errors stay beside the response`, async ({page}) => {
  await page.addInitScript(()=>localStorage.setItem('herts:speech-provider','hermes'));
  await page.addInitScript(({key,theme}) => localStorage.setItem(key,JSON.stringify({id:theme.id,theme})),{key:themeStorageKey,theme});
  for (const width of [320,390,768,1280]) {
    await page.setViewportSize({width,height:480});
    let release!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    await page.route('**/api/v1/audio/speak',async route=>{await gate;await route.fulfill({status:503,json:{error:'The speech provider is unavailable. Your message is unchanged. Try reading this response again when the connection returns.'}});});
    try {
      await page.goto('/#/conversation/existing');
      await expect(page.getByRole('textbox', {name: 'Message Hermes', exact: true})).toBeEditable();
      const response=page.locator('.message').filter({has:page.locator('button.read-aloud')});
      const button=response.getByRole('button',{name:'Read response aloud',exact:true});
      await button.focus();await expect(button).toBeFocused();
      await page.screenshot({path:`test-results/speech-${theme.id}-${width}-idle.png`});
      await button.press('Enter');
      await expect(response.getByRole('status')).toHaveText('Preparing audio…');
      await expect(response.getByRole('button',{name:'Cancel audio preparation',exact:true})).toBeFocused();
      await page.screenshot({path:`test-results/speech-${theme.id}-${width}-preparing.png`});
      release();
      await expect(response.getByRole('alert')).toContainText('Read aloud failed:');
      await expect(response.getByRole('alert')).toBeInViewport();
      await (await pageAction(page, 'button', 'Refresh conversation history')).click(); await closePageActions(page);
      await expect(response.getByRole('alert')).toContainText('The speech provider is unavailable.');
      for(const element of [response,response.getByRole('alert')]) {
        const bounds=(await element.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width+1);
      }
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:`test-results/speech-${theme.id}-${width}-error.png`});
    } finally {release();await page.unroute('**/api/v1/audio/speak');}
  }
});

for (const theme of builtinThemes) for (const width of [320,390,768,1280]) test(`${theme.name}: file downloads fit conversation layouts at ${width}px`, async ({ page }) => {
  await page.addInitScript(({key,theme}) => localStorage.setItem(key,JSON.stringify({id:theme.id,theme})),{key:themeStorageKey,theme});
  const filename = 'Project-review-and-accessibility-report-'.repeat(4) + '.html';
  await page.route('**/api/v1/conversations/*/history*', route => route.fulfill({json:{sessionId:'existing',offset:0,order:'latest',hasMore:false,fetchedAt:Date.now(),messages:[
    {role:'assistant',content:`The report contains the review results.\n\nMEDIA:/tmp/${filename}`},
  ]}}));
  let mediaStatus = 503;
  await page.route('**/api/v1/media', route => route.fulfill({status:mediaStatus,json:mediaStatus === 200
    ? {dataUrl:'data:text/html;base64,PGgxPlJlcG9ydDwvaDE+'}
    : {error:'Hermes is unavailable. Try again when the connection returns.'}}));
  await page.setViewportSize({width,height:480});
  await page.goto('/#/conversation/existing');
  await expect(page.getByRole('textbox', {name: 'Message Hermes', exact: true})).toBeEditable();
  const button = page.getByRole('button',{name:'Download file',exact:true});
  await button.focus(); await expect(button).toBeFocused();
  await page.screenshot({path:`test-results/media-${theme.id}-${width}-idle.png`});
  await button.press('Enter');
  await expect(page.locator('.message-file [role="alert"]')).toBeVisible();
  for (const element of [page.locator('.message-file'),button]) {
    const bounds = (await element.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width+1);
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/media-${theme.id}-${width}-error.png`});
  mediaStatus = 200;
  const original = page.waitForEvent('download');
  await button.click(); await original;
  await expect(button).toBeEnabled();
  mediaStatus = 409;
  const saved = page.waitForEvent('download');
  await button.click(); await saved;
  const warning = page.locator('.message-file [role="alert"]');
  await expect(warning).toHaveText('Saved copy. The file reference has changed. Refresh the conversation and download again.');
  const warningBounds = (await warning.boundingBox())!;
  expect(warningBounds.x).toBeGreaterThanOrEqual(0);
  expect(warningBounds.x + warningBounds.width).toBeLessThanOrEqual(width + 1);
  await page.screenshot({path:`test-results/media-${theme.id}-${width}-saved.png`});
});

for (const theme of builtinThemes) test(`${theme.name}: adaptive navigation and connection details fit all viewports`, async ({ page, request }) => {
  test.setTimeout(120_000);
  for (const id of ['bots', 'pinned']) {
    const { catalogue } = await (await request.get('/api/v1/plugins')).json();
    expect((await request.post(`/api/v1/plugins/${id}/manage`, {headers: {'x-herts-request': '1'}, data: {action: 'enable', revision: catalogue.revision}})).ok()).toBe(true);
  }
  await page.addInitScript(({ key, theme }) => {
    localStorage.setItem(key, JSON.stringify({ id: theme.id, theme }));
    localStorage.setItem('herts-navigation-more', JSON.stringify(['reading']));
  }, { key: themeStorageKey, theme });
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/#/conversations');
    await expect(page.locator('.page-header h1')).toBeVisible();
    await expect(page.locator('.topbar')).toHaveCount(0);
    const status = page.locator('.connection-badge:visible');
    await expect(status).toBeVisible();
    if (width <= 1000) {
      const nav = page.locator('.mobile-nav');
      await nav.getByRole('button', { name: 'More', exact: true }).click();
      const sheet = page.getByRole('dialog');
      await expect(sheet.getByRole('link', { name: 'Reading', exact: true })).toHaveAttribute('href', '#/reading');
      await sheet.getByRole('link', { name: 'Reading', exact: true }).evaluate(node => {
        node.querySelector('.item-row-body')!.textContent = 'Research and reading material with a long plugin title https://example.com/' + 'long-path/'.repeat(12);
      });
      await expect(sheet.getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute('href', '#/settings');
      expect(await sheet.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.screenshot({ path: `test-results/navigation-more-${theme.id}-${width}.png` });
      await page.keyboard.press('Escape');
      await expect(nav.getByRole('button', { name: 'More', exact: true })).toBeFocused();
      const boxes = await nav.locator('a,button').evaluateAll(nodes => nodes.map(node => {
        const box = node.getBoundingClientRect(); return { x: box.x, right: box.right, width: box.width, height: box.height };
      }));
      expect(Math.max(...boxes.map(box => box.width)) - Math.min(...boxes.map(box => box.width))).toBeLessThanOrEqual(1);
      for (const box of boxes) { expect(box.x).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(width); expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44); }
      expect(await nav.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    } else {
      await expect(page.locator('.sidebar').getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
      await expect(page.locator('.sidebar').getByRole('link', { name: 'Reading', exact: true })).toBeVisible();
    }
    const closeDetails = await openConnectionDetails(page);
    await expect(page.getByRole('dialog', { name: 'Connection and sync', exact: true })).toBeVisible();
    await page.screenshot({ path: `test-results/navigation-status-${theme.id}-${width}.png` });
    await closeDetails();
    await page.goto('/#/settings/plugins');
    await expect(page.locator('.tab-order-row')).toHaveCount(5);
    await expect(page.locator('.tab-order select')).toHaveCount(0);
    await page.locator('.tab-order').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/tab-order-${theme.id}-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/navigation-settings-${theme.id}-${width}.png`, fullPage: true });
    await page.goto('/#/conversation/long-history');
    await expect(page.locator('.conversation-panel')).toBeVisible();
    await page.setViewportSize({ width, height: 560 });
    await expect(status).toBeVisible();
    await page.screenshot({ path: `test-results/navigation-conversation-${theme.id}-${width}.png` });
    if (width <= 1000) {
      await page.getByRole('textbox', { name: /^Message / }).focus();
      await page.evaluate(() => {
        Object.defineProperty(window.visualViewport!, 'height', { configurable: true, value: 400 });
        window.visualViewport!.dispatchEvent(new Event('resize'));
      });
      await expect(page.locator('body')).toHaveClass(/keyboard-open/);
      await expect(page.locator('.mobile-nav')).toBeHidden();
      await expect(status).toHaveCount(0);
      expect(await page.locator('main').evaluate(e => getComputedStyle(e).paddingBottom)).toBe('0px');
      const composer = (await page.locator('.composer-wrap').boundingBox())!;
      expect(composer.y + composer.height).toBeLessThanOrEqual(400);
      await page.evaluate(() => {
        delete (window.visualViewport as any).height;
        window.visualViewport!.dispatchEvent(new Event('resize'));
      });
      await expect(page.locator('.mobile-nav')).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});


test('tab order keeps long names inside collapsible sections in every theme', async ({ page }) => {
  test.setTimeout(120_000);
  for (const theme of builtinThemes) {
    await page.goto('/#/settings/plugins');
    await page.evaluate(({key, theme}) => localStorage.setItem(key, JSON.stringify({id: theme.id, theme})), {key: themeStorageKey, theme});
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({width, height: 844});
      await page.goto('/#/settings/plugins');
      const title = page.locator('.tab-order-name').first();
      await expect(title).toBeVisible();
      await title.evaluate(node => { node.textContent = 'Research notes https://example.com/' + 'long-path/'.repeat(10); });
      expect(await page.locator('.tab-order').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.screenshot({path: `test-results/tab-order-long-${theme.id}-${width}.png`});
      const toggle = page.getByRole('button', {name: 'Tab order', exact: true});
      await toggle.click();
      await expect(title).toBeHidden();
      await expect(toggle).toBeFocused();
      await page.screenshot({path: `test-results/tab-order-collapsed-${theme.id}-${width}.png`});
      await toggle.click();
      await expect(title).toBeVisible();
    }
  }
});

for (const theme of builtinThemes) test(`${theme.name}: refined capture and reading modes fit all viewports`, async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.addInitScript(({key,theme}) => localStorage.setItem(key,JSON.stringify({id:theme.id,theme})), {key:themeStorageKey,theme});
  const taskId=crypto.randomUUID(),itemId=crypto.randomUUID();
  const title='Review https://example.com/'+'long-project-reference/'.repeat(12);
  await request.post('/api/v1/sync',{headers:{'x-herts-request':'1'},data:{id:crypto.randomUUID(),taskId,kind:'create',title,at:Date.now()}});
  await request.post('/api/v1/reading/sync',{headers:{'x-herts-request':'1'},data:{id:crypto.randomUUID(),itemId,contextId:crypto.randomUUID(),kind:'create',title,url:'https://example.com/refined-reading',at:Date.now()}});
  for(const width of [320,390,768,1280]) {
    await page.setViewportSize({width,height:844});
    await page.goto('/#/tasks/inbox');
    await expect(page.getByRole('textbox',{name:'Add a task',exact:true})).toBeVisible();
    await expect(page.getByRole('navigation',{name:'Task spaces',exact:true})).toBeVisible();
    const destinations=page.locator('.mobile-lists [data-drop-list]');
    await expect(destinations).toHaveCount(6);
    for(const target of await destinations.all()) { await target.focus(); await expect(target).toBeInViewport({ratio:1}); }
    await destinations.first().focus();
    await expect(destinations.first()).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path:`test-results/refined-${theme.id}-tasks-${width}.png`});
    await page.getByRole('textbox', { name: 'Add a task', exact: true }).fill('A draft with https://example.com/' + 'long-reference/'.repeat(15));
    const capture = page.locator('.composer-capture');
    await expect(capture.locator('.primary-button')).toHaveText('Send to Hermes');
    expect((await capture.locator('.primary-button').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(capture.getByRole('button', { name: 'Save only', exact: true })).not.toHaveClass(/primary-button/);
    const saveButton = capture.getByRole('button', { name: 'Save only', exact: true });
    const sendButton = capture.getByRole('button', { name: 'Send to Hermes', exact: true });
    expect((await saveButton.boundingBox())!.x).toBeLessThan((await sendButton.boundingBox())!.x);
    await saveButton.focus();
    await page.keyboard.press('Tab');
    await expect(sendButton).toBeFocused();
    await expect(capture.locator('details')).toHaveCount(0);
    await expect(capture.locator('.capture-destination')).toHaveCount(0);
    const titleField = capture.getByRole('textbox', { name: 'New task title', exact: true });
    await expect(titleField).toHaveCount(0);
    await expect(capture.getByRole('button', { name: /^Conversation settings:/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path:`test-results/capture-open-${theme.id}-${width}.png`});
    await page.goto('/#/reading/add');
    await page.getByLabel('Message Hermes', { exact: true }).fill('Reading notes\nhttps://example.com/' + 'long-reference/'.repeat(15) + '\nhttps://example.com/second');
    await expect(page.getByLabel('Reading title', { exact: true })).toHaveCount(0);
    await page.getByRole('radio').last().check();
    await expect(page.getByRole('radio').last()).toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path:`test-results/reading-capture-open-${theme.id}-${width}.png`});
    await page.goto(`/#/reading-item/${itemId}`);
    await expect(page.getByRole('link',{name:'Article',exact:true})).toBeVisible();
    await page.getByRole('textbox',{name:/^(Message Hermes|Add a task)$/,exact:true}).fill('A discussion draft with a long URL https://example.com/'+'long-path/'.repeat(20));
    await page.getByRole('link',{name:'Article',exact:true}).click();
    await expect(page.locator('.reader-article')).toBeVisible();
    await expect(page.locator('.reading-mode-bar .offline-controls')).toHaveCount(0);
    const original = page.locator('.reader-meta').getByRole('link', { name: 'Open original', exact: true });
    await expect(original).toHaveAttribute('target', '_blank');
    await original.focus();
    await expect(original).toBeFocused();
    await page.locator('.conversation-page-header').getByRole('button', { name: 'Actions', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Page actions' }).getByRole('button', { name: 'Remove download', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.conversation-page-header').getByRole('button', { name: 'Actions', exact: true })).toBeFocused();
    if(width===1280) await page.getByRole('button',{name:'Show alongside',exact:true}).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path:`test-results/refined-${theme.id}-reading-${width}.png`});
    await page.getByRole('link',{name:'Discussion',exact:true}).click();
    await page.setViewportSize({width,height:480});
    await expect(page.getByRole('textbox',{name:/^(Message Hermes|Add a task)$/,exact:true})).toHaveValue(/A discussion draft/);
    await expect.poll(async () => { const composer = (await page.locator('.composer-wrap').boundingBox())!; return composer.y + composer.height; }).toBeLessThanOrEqual(480);
    await expect(page.getByRole('button',{name:'Send',exact:true})).toBeInViewport({ratio:1});
    await page.screenshot({path:`test-results/refined-${theme.id}-discussion-short-${width}.png`});
  }
});

test('normal task capture keeps visible destinations and the first task reachable', async ({page,request}) => {
  await request.post('/api/v1/sync',{headers:{'x-herts-request':'1'},data:{id:crypto.randomUUID(),taskId:crypto.randomUUID(),kind:'create',title:'Short task',at:Date.now()}});
  await page.setViewportSize({width:390,height:844});await page.goto('/#/tasks/inbox');
  await expect(page.getByRole('textbox',{name:'Add a task',exact:true})).toBeVisible();
  await expect(page.locator('.task-item').first()).toBeVisible();
  const targets=page.locator('.mobile-lists [data-drop-list]');
  await expect(targets).toHaveCount(6);
  for(const target of await targets.all()) { await target.focus(); await expect(target).toBeInViewport({ratio:1}); }
  const capture=(await page.locator('.composer-capture').boundingBox())!;
  const task=(await page.locator('.task-item').first().boundingBox())!;
  expect(task.y).toBeGreaterThanOrEqual(capture.y+capture.height);
  expect(task.y).toBeLessThan((await page.locator('.mobile-nav').boundingBox())!.y);
});

for (const theme of builtinThemes) test(`${theme.name}: reviewed actions and Press-only settings fit every viewport`, async ({ page, request }) => {
  test.setTimeout(180_000);
  await bots(request, 'enable');
  await page.addInitScript(({key,theme}) => localStorage.setItem(key, JSON.stringify({id:theme.id,theme})), {key:themeStorageKey,theme});
  const taskId=crypto.randomUUID(), itemId=crypto.randomUUID(), title='Review '+ 'the detailed project schedule and delivery dates '.repeat(12);
  const headers={'x-herts-request':'1'};
  await request.post('/api/v1/sync',{headers,data:{id:crypto.randomUUID(),taskId,kind:'create',title,at:Date.now()}});
  await request.post('/api/v1/reading/sync',{headers,data:{id:crypto.randomUUID(),itemId,contextId:crypto.randomUUID(),kind:'create',title,url:'https://example.com/'+ 'long-path/'.repeat(20),at:Date.now()}});
  for (const width of [320,390,768,1280]) {
    await page.setViewportSize({width,height:480});
    for (const path of [`/task/${taskId}`,`/reading-item/${itemId}`,'/conversation/existing','/plugins/bots/research']) {
      await page.goto('/#'+path);
      await expect(page.locator('.conversation-panel')).toBeVisible();
      await expect(page.locator('.conversation-compact-title')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme',theme.id);
      const more=page.locator('.conversation-page-header').getByRole('button',{name:'Actions',exact:true});
      await more.click();
      const dialog=page.getByRole('dialog',{name:'Page actions',exact:true});
      await expect(dialog.locator('.action-row').first()).toBeVisible();
      const fonts=await dialog.locator('.action-row').evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).fontSize));
      expect(new Set(fonts).size).toBe(1);
      const bounds=await dialog.locator('.action-row').evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect();return {height:b.height,left:b.left,right:b.right,text:n.textContent?.trim()}}));
      for (const b of bounds) {expect(b.height).toBeGreaterThanOrEqual(44);expect(b.left).toBeGreaterThanOrEqual(0);expect(b.right).toBeLessThanOrEqual(width);expect(b.text).toBeTruthy();}
      const visibility=dialog.locator('.page-visibility-actions');
      if(await visibility.count()) expect(await visibility.evaluate(n=>getComputedStyle(n).marginTop)).toBe('0px');
      await page.screenshot({path:`test-results/review-${theme.id}-${path.split('/')[1]}-${width}.png`});
      const rename=dialog.getByRole('button',{name:/^Rename /});
      if(await rename.count()) {
        await rename.click();
        const editor=page.getByRole('dialog',{name:/^Rename /}), field=editor.getByRole('textbox');
        await field.fill('A long title with https://example.com/'+'reference'.repeat(6));await field.focus();
        await expect(field).toBeFocused();
        await expect(dialog).toBeHidden();await expect(page.locator('dialog[open]')).toHaveCount(1);
        const box=(await field.boundingBox())!, footer=(await editor.locator('.form-dialog-footer').boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);expect(box.y+box.height).toBeLessThanOrEqual(footer.y+1);
        await page.screenshot({path:`test-results/review-${theme.id}-${path.split('/')[1]}-rename-${width}.png`});
        await page.keyboard.press('Escape');await expect(editor).toBeHidden();await expect(more).toBeFocused();
      }
      if(path.startsWith('/task/')) for(const kind of ['list','space']) {
        await more.click();
        const trigger=dialog.getByRole('button',{name:new RegExp(`^Move to ${kind}`)});await trigger.click();
        const editor=page.getByRole('dialog',{name:`Move to ${kind}`,exact:true}), field=editor.getByRole('combobox');
        await field.focus();await expect(field).toBeFocused();
        await expect(dialog).toBeHidden();await expect(page.locator('dialog[open]')).toHaveCount(1);
        const box=(await field.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
        await page.screenshot({path:`test-results/review-${theme.id}-move-${kind}-${width}.png`});
        await page.keyboard.press('Escape');await expect(editor).toBeHidden();await expect(more).toBeFocused();
      }
      if(path.startsWith('/task/') || path.startsWith('/plugins/bots/')) {
        if(!await dialog.isVisible()) await more.click();
        await dialog.getByRole('button',{name:path.startsWith('/task/')?'Snooze':'Edit bot',exact:true}).click();
        const editor=page.getByRole('dialog');
        await expect(editor).toBeVisible();await expect(dialog).toBeHidden();
        await expect(page.locator('dialog[open]')).toHaveCount(1);
        await page.screenshot({path:`test-results/review-${theme.id}-${path.startsWith('/task/')?'snooze':'bot-editor'}-${width}.png`});
        await page.keyboard.press('Escape');await expect(editor).toBeHidden();await expect(more).toBeFocused();
      }
      await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(more).toBeFocused();
      expect(await page.locator('.conversation-page-header').evaluate(n=>n.getBoundingClientRect().height)).toBeLessThanOrEqual(90);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
    await page.goto('/#/settings');
    await expect(page.locator('.appearance-settings select')).toHaveCount(0);
    await page.screenshot({path:`test-results/review-${theme.id}-appearance-${width}.png`,fullPage:true});
    await expect(page.locator('.appearance-settings,.theme-preview')).toHaveCount(0);

    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
});

for (const theme of builtinThemes.filter(t => ['press', 'fieldwork'].includes(t.id))) test(`${theme.name}: bot header actions share vertical edges`, async ({ page, request }) => {
  await bots(request, 'enable');
  await page.addInitScript(({ key, theme }) => localStorage.setItem(key, JSON.stringify({ id: theme.id, theme })), { key: themeStorageKey, theme });
  await page.goto('/#/plugins/bots/research');
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const routines = page.getByRole('link', { name: 'Routines', exact: true });
    const more = page.locator('.conversation-page-header').getByRole('button', { name: 'Actions', exact: true });
    await expect(routines).toBeVisible(); await expect(more).toBeVisible();
    const a = (await routines.boundingBox())!, b = (await more.boundingBox())!;
    expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.y + a.height - b.y - b.height)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `test-results/header-alignment-${theme.id}-${width}.png` });
  }
});

for (const theme of builtinThemes) test(`${theme.name}: report sheets and plugin controls fit every viewport`, async ({ page, request }) => {
  test.setTimeout(180_000);
  await page.addInitScript(({ key, theme }) => {
    localStorage.setItem(key, JSON.stringify({ id: theme.id, theme }));
    localStorage.setItem('herts-navigation-more', JSON.stringify(['reading']));
  }, { key: themeStorageKey, theme });
  const taskId = crypto.randomUUID(), title = 'Review the delivery plan and https://example.com/' + 'reference/'.repeat(25);
  await request.post('/api/v1/sync', { headers: { 'x-herts-request': '1' }, data: { id: crypto.randomUUID(), taskId, kind: 'create', title, at: Date.now() } });
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/#/settings/plugins');
    const rescan = page.getByRole('button', { name: 'Rescan plugins', exact: true });
    await expect(rescan).toBeVisible(); await expect(rescan).toBeEnabled(); await rescan.focus(); await expect(rescan).toBeFocused();
    await expect(page.locator('.settings-toolbar')).toContainText('General');
    const tasks = page.locator('.plugin-card').filter({ has: page.getByRole('checkbox', { name: 'Enable Tasks', exact: true }) });
    await tasks.getByRole('button', { name: /^Tasks / }).click();
    await expect(tasks.getByRole('checkbox', { name: 'Enable Tasks', exact: true })).toBeVisible();
    await expect(tasks.getByRole('radio')).toBeHidden();
    await tasks.getByRole('button', { name: /^Tasks / }).click();
    await expect(page.locator('input[name=default-space]:checked')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const order = page.getByRole('button', { name: 'Tab order', exact: true });
    await order.click();
    expect((await page.locator('.tab-order').boundingBox())!.height).toBeLessThanOrEqual(54);
    await order.click();
    await page.screenshot({ path: `test-results/report-${theme.id}-plugins-${width}.png`, fullPage: true });
    await page.goto('/#/settings');
    await page.getByRole('button', { name: 'Edit conversation defaults' }).click();
    const defaults = page.getByRole('dialog', { name: 'New conversation defaults', exact: true });
    await expect(defaults.getByRole('button', { name: 'Save defaults', exact: true })).toBeInViewport();
    await page.screenshot({ path: `test-results/report-${theme.id}-defaults-${width}.png` });
    await page.keyboard.press('Escape');
    await page.goto(`/#/task/${taskId}`);
    const actions = page.locator('.conversation-page-header').getByRole('button', { name: 'Actions', exact: true });
    await actions.click();
    const sheet = page.getByRole('dialog', { name: 'Page actions', exact: true });
    await expect(sheet).toBeVisible();
    if (width <= 1000) {
      const box = (await sheet.boundingBox())!;
      expect(box.x).toBe(0); expect(box.width).toBe(width); expect(Math.abs(box.y + box.height - 844)).toBeLessThanOrEqual(1);
    }
    const rule = await sheet.locator('.action-row').first().evaluate(e => {
      const box = e.getBoundingClientRect(), style = getComputedStyle(e, '::after');
      return { left: box.left + parseFloat(style.left), right: box.right - parseFloat(style.right) };
    });
    const sheetBounds = (await sheet.boundingBox())!;
    expect(Math.abs(rule.left - sheetBounds.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(rule.right - sheetBounds.x - sheetBounds.width)).toBeLessThanOrEqual(2);
    await page.screenshot({ path: `test-results/report-${theme.id}-actions-${width}.png` });
    await page.keyboard.press('Escape'); await expect(actions).toBeFocused();
    for (const height of [844, 480]) {
      await page.setViewportSize({ width, height });
      await page.getByRole('button', { name: /^Conversation settings:/ }).click();
      const dialog = page.getByRole('dialog', { name: 'Conversation settings', exact: true });
      await expect(dialog).toBeVisible();
      const apply = dialog.getByRole('button', { name: 'Apply', exact: true });
      await expect(apply).toBeInViewport({ ratio: 1 });
      const refresh = dialog.getByRole('button', { name: 'Refresh current settings', exact: true });
      const applyBox = (await apply.boundingBox())!, refreshBox = (await refresh.boundingBox())!;
      expect(Math.abs(applyBox.y + applyBox.height / 2 - refreshBox.y - refreshBox.height / 2)).toBeLessThanOrEqual(1);
      const field = dialog.getByRole('textbox', { name: 'Working folder', exact: true });
      await field.fill('/home/hermes/' + 'long-folder/'.repeat(25));
      await field.focus(); await expect(field).toBeFocused();
      const box = (await dialog.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(height);
      if (width <= 1000) expect(Math.abs(box.y + box.height - height)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `test-results/report-${theme.id}-settings-${width}-${height}.png` });
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(dialog).toHaveCount(0);
    }
  }
});

for (const theme of builtinThemes) test(`${theme.name}: populated defaults keep a compact footer`, async ({ page }) => {
  await page.addInitScript(({ key, theme }) => localStorage.setItem(key, JSON.stringify({ id: theme.id, theme })), { key: themeStorageKey, theme });
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/#/settings');
    await page.getByRole('button', { name: 'Edit conversation defaults' }).click();
    const dialog = page.getByRole('dialog', { name: 'New conversation defaults', exact: true });
    const folder = dialog.getByRole('textbox', { name: 'Working folder', exact: true });
    const inherited = await folder.inputValue();
    await folder.fill('/home/claw/workspace/' + 'long-folder/'.repeat(12));
    const reset = dialog.getByRole('button', { name: 'Use Hermes defaults for all', exact: true });
    await reset.scrollIntoViewIfNeeded();
    const save = dialog.getByRole('button', { name: 'Save defaults', exact: true });
    const refresh = dialog.getByRole('button', { name: 'Refresh current settings', exact: true });
    const a = (await save.boundingBox())!, b = (await refresh.boundingBox())!;
    expect(Math.abs(a.y + a.height / 2 - b.y - b.height / 2)).toBeLessThanOrEqual(1);
    expect(await dialog.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
    await page.screenshot({ path: `test-results/footer-${theme.id}-${width}.png` });
    await page.setViewportSize({ width, height: 480 });
    await expect(save).toBeInViewport({ ratio: 1 });
    await reset.click();
    await expect(folder).toHaveValue(inherited);
    await expect(reset).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit conversation defaults' })).toBeFocused();
  }
});

for (const theme of builtinThemes) test(`${theme.name}: More connection row aligns with navigation rows`, async ({ page }) => {
  await page.addInitScript(({ key, theme }) => {
    localStorage.setItem(key, JSON.stringify({ id: theme.id, theme }));
    localStorage.setItem('herts-navigation-more', JSON.stringify(['reading']));
  }, { key: themeStorageKey, theme });
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/#/settings');
    await page.locator('.mobile-nav').getByRole('button', { name: 'More', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'More', exact: true });
    const connection = sheet.locator('.connection-status-row');
    const settings = sheet.getByRole('link', { name: 'Settings', exact: true });
    const a = (await connection.boundingBox())!, b = (await settings.boundingBox())!;
    expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
    const caret = (await connection.locator(':scope > svg').boundingBox())!;
    const otherCaret = (await settings.locator('.item-row-actions svg').boundingBox())!;
    expect(Math.abs(caret.x - otherCaret.x)).toBeLessThanOrEqual(1);
    const label = connection.locator(':scope > span:nth-child(2)');
    const otherLabel = settings.locator('.item-row-body');
    expect(Math.abs((await label.boundingBox())!.x - (await otherLabel.boundingBox())!.x)).toBeLessThanOrEqual(1);
    expect(await label.evaluate(e => getComputedStyle(e).fontSize)).toBe(await otherLabel.evaluate(e => getComputedStyle(e).fontSize));
    await page.screenshot({ path: `test-results/more-alignment-${theme.id}-${width}.png` });
    await connection.click();
    await expect(page.getByRole('dialog', { name: 'Connection and sync', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(connection).toBeFocused();
    await page.keyboard.press('Escape');
  }
});

for (const theme of builtinThemes) for (const width of [320, 390, 768, 1280]) test(`${theme.name}: keyboard navigation releases space and preserves discussion drafts at ${width}px`, async ({ page, request }) => {
  await page.addInitScript(({ key, theme }) => localStorage.setItem(key, JSON.stringify({ id: theme.id, theme })), { key: themeStorageKey, theme });
  const itemId = crypto.randomUUID(), taskId = crypto.randomUUID();
  const headers = { 'x-herts-request': '1' };
  await request.post('/api/v1/reading/sync', { headers, data: { id: crypto.randomUUID(), itemId, contextId: crypto.randomUUID(), kind: 'create', title: 'Reading keyboard layout', url: 'https://example.com/keyboard-layout', at: Date.now() } });
  await request.post('/api/v1/sync', { headers, data: { id: crypto.randomUUID(), taskId, kind: 'create', title: 'Task keyboard layout', at: Date.now() } });
  await page.setViewportSize({ width, height: 844 });
  for (const path of [`/reading-item/${itemId}`, `/task/${taskId}`, '/conversation/existing']) {
    await page.goto('/#' + path);
    const editor = page.getByRole('textbox', { name: /^(Message Hermes|Add a task)$/ });
    await expect(page.locator('.conversation-heading')).toHaveCount(0);
    const draft = `Keep this draft when the keyboard changes: ${path}\n` + 'A long draft with a source https://example.com/research.\n'.repeat(12);
    if (theme.id === 'press') await expect(page.locator('.composer')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await editor.fill(draft);
    if (theme.id === 'press') await expect(page.locator('.composer')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    for (const height of [360, 460]) {
      await page.evaluate(height => {
        Object.defineProperty(window.visualViewport!, 'height', { configurable: true, value: height });
        window.visualViewport!.dispatchEvent(new Event('resize'));
      }, height);
      await expect(page.locator('body')).toHaveClass(/keyboard-open/);
      await expect(editor).toHaveValue(draft);
      const nav = page.locator('.mobile-nav');
      await expect(nav).toBeHidden();
      if (width <= 1000) expect(await page.locator('main').evaluate(e => getComputedStyle(e).paddingBottom)).toBe('0px');
      const settings = (await page.locator('.session-settings-button').boundingBox())!;
      const input = (await page.locator('.composer').boundingBox())!;
      const focusExtent = await page.locator('.composer').evaluate(element => {
        const style = getComputedStyle(element);
        return parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
      });
      expect(input.y - focusExtent - settings.y - settings.height).toBeGreaterThanOrEqual(4);
      const composer = (await page.locator('.composer-wrap').boundingBox())!;
      expect(composer.y + composer.height).toBeLessThanOrEqual(height);
      for (const selector of ['.composer-settings-row', '.composer textarea', '.composer-tools']) {
        const control = (await page.locator(selector).boundingBox())!;
        expect(control.y).toBeGreaterThanOrEqual(composer.y);
        expect(control.y + control.height).toBeLessThanOrEqual(composer.y + composer.height);
        expect(control.y + control.height).toBeLessThanOrEqual(height);
      }
      for (const overflow of await page.locator('.composer-wrap, .composer-settings-row, .composer-expanded, .composer, .composer-tools').evaluateAll(elements => elements.map(element => element.scrollHeight - element.clientHeight))) {
        expect(overflow).toBeLessThanOrEqual(1);
      }
      await page.screenshot({ path: `test-results/keyboard-hidden-${theme.id}-${path.split('/')[1]}-${width}-${height}.png` });
      await page.evaluate(() => {
        delete (window.visualViewport as any).height;
        window.visualViewport!.dispatchEvent(new Event('resize'));
      });
      await expect(page.locator('body')).not.toHaveClass(/keyboard-open/);
      if (width <= 1000) await expect(nav).toBeVisible();
      await expect(editor).toHaveValue(draft);
    }
  }
});

for (const width of [320, 390, 768, 1280]) test(`Press task capture becomes white when expanded at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await page.goto('/#/tasks/inbox');
  const composer = page.locator('.composer-capture .composer');
  const editor = page.getByRole('textbox', { name: 'Add a task', exact: true });
  await expect(composer).toHaveCSS('background-color', 'rgb(239, 236, 228)');
  await expect(editor).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.screenshot({ path: `test-results/task-capture-closed-${width}.png` });
  await editor.fill('Preserve the task draft while changing its presentation');
  await expect(composer).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.screenshot({ path: `test-results/task-capture-open-${width}.png` });
  await page.getByRole('button', { name: 'Collapse message box', exact: true }).click();
  await expect(composer).toHaveCSS('background-color', 'rgb(239, 236, 228)');
  await expect(editor).toHaveValue('Preserve the task draft while changing its presentation');
  await editor.focus();
  await expect(composer).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(editor).toHaveValue('Preserve the task draft while changing its presentation');
});

test('plugin callers retain the default Conversation section heading', async ({ page, request }) => {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, '__HERTS_PLUGIN_RUNTIME__', {
      configurable: true,
      set(runtime) {
        const Panel = runtime.sdk.ConversationPanel;
        const DefaultPanel = ({ showHeading, ...props }: any) => runtime.React.createElement(Panel, props);
        Object.defineProperty(globalThis, '__HERTS_PLUGIN_RUNTIME__', { configurable: true, writable: true,
          value: { ...runtime, sdk: { ...runtime.sdk, ConversationPanel: DefaultPanel } } });
      },
    });
  });
  const taskId = crypto.randomUUID();
  await request.post('/api/v1/sync', { headers: { 'x-herts-request': '1' }, data: { id: crypto.randomUUID(), taskId, kind: 'create', title: 'Plugin heading compatibility', at: Date.now() } });
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/#/task/' + taskId);
    await expect(page.locator('.conversation-heading')).toHaveText('Conversation');
    await expect(page.locator('.conversation-heading')).toBeVisible();
    await expect(page.getByLabel('Message Hermes', { exact: true })).toBeEditable();
  }
});

for (const width of [320, 390, 768, 1280]) test(`Press loading composer keeps task bounds at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await page.goto('/#/tasks/inbox');
  const editor = page.getByRole('textbox', { name: 'Add a task', exact: true });
  await expect(editor).toBeEnabled();
  const ready = (await page.locator('.composer-capture').boundingBox())!;
  const readyTools = await Promise.all(['Attach files', 'Dictate'].map(name => page.getByRole('button', { name, exact: true }).boundingBox()));
  await page.screenshot({ path: `test-results/loading-composer-ready-${width}.png` });
  await page.evaluate(() => { location.hash = '/conversations'; });
  await expect(page.getByLabel('Search conversations')).toBeVisible();
  await page.evaluate(() => {
    const db = (window as any).__HERTS_PLUGIN_RUNTIME__.sdk.conversationDrafts.db;
    const original = db.transaction.bind(db);
    let delayed = false;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    db.transaction = (...args: any[]) => {
      if (!delayed && args[0] === 'rw' && args[1] === db.kv) { delayed = true; return gate.then(() => original(...args)); }
      return original(...args);
    };
    (window as any).releaseEntry = () => { db.transaction = original; release(); };
    location.hash = '/tasks/inbox';
  });
  try {
    await expect(page.locator('.composer-loading')).toBeVisible();
    await expect(editor).toBeDisabled();
    const pending = (await page.locator('.composer-capture').boundingBox())!;
    expect(Math.abs(pending.height - ready.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(pending.width - ready.width)).toBeLessThanOrEqual(1);
    expect(pending.x).toBeGreaterThanOrEqual(0);
    expect(pending.x + pending.width).toBeLessThanOrEqual(width);
    for (const [index, name] of ['Attach files', 'Dictate'].entries()) {
      const tool = (await page.getByRole('button', { name, exact: true }).boundingBox())!;
      expect(Math.abs(tool.x - readyTools[index]!.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(tool.y - readyTools[index]!.y)).toBeLessThanOrEqual(1);
    }
    await page.screenshot({ path: `test-results/loading-composer-pending-${width}.png` });
  } finally { await page.evaluate(() => (window as any).releaseEntry()); }
  await expect(editor).toBeEnabled();
  await editor.fill('A long draft with https://example.com/' + 'long-path/'.repeat(12));
  await expect(editor).toHaveValue(/A long draft/);
});
for (const [width, height] of [[320, 844], [390, 844], [768, 844], [1280, 844], [390, 480]]) {
  test(`Press make-task dialog fits at ${width}x${height}`, async ({ page, context }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/#/conversation/existing');
    await (await pageAction(page, 'button', 'Rename conversation')).click();
    await page.screenshot({ path: `output/make-task/reference-${width}-${height}.png` });
    await page.getByRole('dialog', { name: 'Rename conversation', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
    await (await pageAction(page, 'button', 'Make a task')).click();
    const dialog = page.getByRole('dialog', { name: 'Make a task', exact: true });
    const field = dialog.getByRole('textbox');
    await expect(field).toBeEditable();
    await field.focus();
    await expect(field).toBeFocused();
    const title = 'Review the delivery arrangements and https://example.com/' + 'long-reference/'.repeat(20);
    await field.fill(title);
    await expect(dialog).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    const submit = dialog.getByRole('button', { name: 'Create task', exact: true });
    await expect(submit).toHaveCSS('background-color', 'rgb(30, 60, 255)');
    for (const control of [dialog, field, ...await dialog.getByRole('combobox').all(), submit, dialog.getByRole('button', { name: 'Cancel', exact: true })]) {
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(height);
    }
    await page.screenshot({ path: `output/make-task/dialog-${width}-${height}.png` });
    await context.setOffline(true);
    await expect(field).toHaveValue(title);
    await context.setOffline(false);
    await expect(field).toHaveValue(title);
    await expect(submit).toBeEnabled();
    await field.focus();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('combobox', { name: 'Space', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await (await pageAction(page, 'button', 'Make a task')).click();
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });
}

test('make-task dialog protects its title during delayed submission and failure', async ({ page }) => {
  await page.goto('/#/conversation/existing');
  await (await pageAction(page, 'button', 'Make a task')).click();
  const dialog = page.getByRole('dialog', { name: 'Make a task', exact: true });
  const field = dialog.getByRole('textbox');
  const title = 'Keep this task title after a failed submission';
  await field.fill(title);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/plugins/tasks/commands', async route => { await gate; await route.abort(); });
  await dialog.getByRole('button', { name: 'Create task', exact: true }).click();
  try {
    await expect(field).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(field).toHaveValue(title);
  } finally { release(); }
  await expect(dialog.getByRole('alert')).toContainText('request is saved');
  await expect(field).toHaveValue(title);
  await expect(field).toBeEditable();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
});
