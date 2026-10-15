import { test, expect } from '@playwright/test';
import { pinnedPlugin, pinnedReady, seedPin } from './pinned-helpers';
import { builtinThemes, themeStorageKey } from '../../shared/themeValues';

async function bots(request: import('@playwright/test').APIRequestContext, action: 'enable' | 'disable') {
  const { catalogue } = await (await request.get('/api/v1/plugins')).json();
  expect((await request.post('/api/v1/plugins/bots/manage', { headers: { 'x-herts-request': '1' }, data: { action, revision: catalogue.revision } })).ok()).toBe(true);
}
test.afterEach(async ({ request }) => { await bots(request, 'disable'); await pinnedPlugin(request, 'disable'); });

test('an older app gets an actionable plugin update message and can still open app updates', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, '__HERTS_PLUGIN_RUNTIME__', {
      configurable: true,
      set(runtime) {
        Object.defineProperty(globalThis, '__HERTS_PLUGIN_RUNTIME__', { configurable: true, writable: true, value: { ...runtime, sdk: { ...runtime.sdk, PageHeader: undefined } } });
      },
    });
  });
  await page.goto('/#/settings/plugins');
  await expect(page.getByText('Update Herts in Settings → App updates to use this version of Tasks.', { exact: true })).toBeVisible();
  await expect(page.getByText('Update Herts in Settings → App updates to use this version of Reading.', { exact: true })).toBeVisible();
  await page.goto('/#/settings');
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
        if (path === '/reading') await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
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
          expect(Math.max(...rows.map(row => row.height)) - Math.min(...rows.map(row => row.height))).toBeLessThanOrEqual(1);
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
        if (path === '/settings') {
          const voice=page.getByLabel('Voice on this device');
          await expect(voice).toHaveValue('device');await voice.focus();await expect(voice).toBeFocused();
          const bounds=(await voice.boundingBox())!;
          expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width+1);
          await page.screenshot({path:`test-results/speech-settings-${theme.id}-${width}.png`});
        }
        if (path === '/settings/plugins') await expect(page.getByRole('heading', { name: 'Task spaces', exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme.id} ${path} at ${width}px`).toBe(true);
        const controls = await page.locator('.page-header-actions a, .page-header-actions button, .section-nav>a').evaluateAll(nodes => nodes.map(node => {
          const { x, width, height } = node.getBoundingClientRect(); return { x, width, height };
        }));
        for (const bounds of controls) {
          expect(bounds.height).toBeGreaterThanOrEqual(44);
          expect(bounds.x).toBeGreaterThanOrEqual(0);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
        }
        if (['fieldwork', 'press'].includes(theme.id) && [390, 1280].includes(width)) {
          await page.screenshot({ path: `test-results/ui-${theme.id}-${path.slice(1).replaceAll('/', '-')}-${width}.png`, fullPage: path.startsWith('/settings') || path === '/plugins/bots' });
        }
      }
    }
    // Populated forms, errors and focused fields at each target width, including a keyboard-sized viewport.
    for(const width of [320,390,768,1280]){
      await page.setViewportSize({width,height:480});
      await page.goto('/#/plugins/bots/research');await expect(page.getByLabel('Message Researcher')).toBeVisible();
      await expect(page.getByRole('link',{name:'Routines',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Edit bot',exact:true})).toBeVisible();
      const history=await page.locator('.conversation-scroll').boundingBox(),composer=await page.locator('.composer-wrap').boundingBox();expect(history!.height).toBeGreaterThan(30);expect(history!.y+history!.height).toBeLessThanOrEqual(composer!.y+1);
      const bottom=width<=700?await page.locator('.mobile-nav').evaluate(node=>node.getBoundingClientRect().top):480;
      expect(composer!.y+composer!.height).toBeLessThanOrEqual(bottom);
      await page.screenshot({path:`test-results/ui-${theme.id}-bot-chat-${width}.png`});
      // Focusing expands the composer; its controls must remain reachable inside
      // the fixed viewport even when settings and draft status consume space.
      await page.getByLabel('Message Researcher').fill('An unsent short-window draft');
      await page.getByRole('button',{name:'Send',exact:true}).scrollIntoViewIfNeeded();
      await page.locator('.composer-wrap').evaluate(node=>{node.scrollTop=node.scrollHeight;});
      const expanded=await page.locator('.composer-wrap').boundingBox(),send=await page.getByRole('button',{name:'Send',exact:true}).boundingBox();
      expect(expanded!.y+expanded!.height).toBeLessThanOrEqual(bottom);expect(send!.y).toBeGreaterThanOrEqual(expanded!.y);expect(send!.y+send!.height).toBeLessThanOrEqual(expanded!.y+expanded!.height-5);
      await page.screenshot({path:`test-results/ui-${theme.id}-bot-chat-expanded-${width}.png`});
      await page.getByRole('button',{name:'Collapse message box',exact:true}).click();
      await page.getByRole('button',{name:'Edit bot',exact:true}).click();await page.getByRole('textbox',{name:'Persona',exact:true}).fill('Long persona with https://example.com/'+ 'instructions'.repeat(80));
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
      await page.getByRole('button', { name: 'Edit list', exact: true }).click();
      const reorderButtons = await page.locator('.reorder-controls button').evaluateAll(nodes => nodes.map(node => {
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
    await page.goto('/#/settings');
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
      const pin = page.getByRole('button', { name: 'Pin notification', exact: true }); await expect(pin).toBeEnabled();
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
      const bottom = width <= 700 ? await page.locator('.mobile-nav').evaluate(node => node.getBoundingClientRect().top) : 480;
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
        const bottom = width <= 700 ? (await page.locator('.mobile-nav').boundingBox())!.y : 900;
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
      await page.getByRole('button',{name:'Refresh conversation history',exact:true}).click();
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
