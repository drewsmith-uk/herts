import { test, expect, type Locator, type Page } from '@playwright/test';

async function usable(locator: Locator) {
  await expect(locator).toBeInViewport();
  await expect.poll(() => locator.evaluate(el => {
    const box = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
  })).toBe(true);
}
async function scrollHistory(page: Page, delta: number) {
  await page.mouse.move(250, 550); await page.mouse.wheel(0, delta);
}

for (const width of [390,1280]) test(`keeps conversation controls available at the latest messages on ${width}px screens`, async ({page,request}) => {
  await page.setViewportSize({width,height:844});
  const before = await (await request.get('http://127.0.0.1:8791/calls')).json();
  await page.goto('/#/conversations'); await page.getByRole('checkbox',{name:'Show linked conversations'}).check(); await page.getByRole('link',{name:/Header conversation/}).click();
  const header = page.locator('.conversation-page-header');
  const recent = page.locator('[data-history-message="header-history:450"]');
  await usable(header.getByRole('textbox',{name:'Conversation title',exact:true})); await usable(recent);
  const hide = header.getByRole('button', { name: 'Hide conversation', exact: true });
  await usable(hide);
  const makeOrOpen = header.getByRole('button', { name: /^(Make a task|Open task)$/ });
  await usable(makeOrOpen);
  await page.screenshot({ path: `test-results/conversation-view-actions-${width}.png` });
  await scrollHistory(page,200); await expect(header).toHaveClass(/is-compact/);
  await usable(makeOrOpen); await usable(header.getByRole('button', { name: 'Show page details', exact: true }));
  await scrollHistory(page,-250); await expect(header).not.toHaveClass(/is-compact/);
  await usable(header.getByRole('textbox',{name:'Conversation title',exact:true}));
  // The conversion controls remain reachable in the floating header too.
  if (await page.getByRole('button',{name:'Make a task',exact:true}).count()) {
    await page.getByRole('button',{name:'Make a task',exact:true}).click();
    await usable(page.getByLabel('New task from conversation title'));
    await page.getByRole('button',{name:'Create task',exact:true}).click();
  } else await page.getByRole('button',{name:'Open task',exact:true}).click();
  const title = page.getByLabel('Task title',{exact:true}), list = page.getByLabel('Task list',{exact:true});
  await usable(title); await usable(list); await usable(recent); await usable(page.getByLabel('Message Hermes'));
  await list.selectOption('next'); await expect(list).toHaveValue('next');
  await title.fill(`Long task title edited on ${width}px`);
  await scrollHistory(page,150); await expect(header).not.toHaveClass(/is-compact/);
  await title.press('Tab'); await expect(page.locator('.save-state')).toContainText('All changes saved');
  await page.reload(); await expect(title).toHaveValue(`Long task title edited on ${width}px`);
  await usable(title); await usable(list); await usable(recent); await usable(page.getByLabel('Message Hermes'));
  await page.screenshot({path:`test-results/conversation-header-${width}.png`});
  await scrollHistory(page,200); await expect(header).toHaveClass(/is-compact/);
  // Keyboard users can expand the persistent toolbar without jumping to the start.
  await header.getByRole('button', { name: 'Show page details', exact: true }).focus();
  await page.keyboard.press('Enter'); await expect(header).not.toHaveClass(/is-compact/); await usable(title); await usable(recent);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press('PageDown'); await expect(header).toHaveClass(/is-compact/);
  await page.keyboard.press('PageUp'); await expect(header).not.toHaveClass(/is-compact/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const after = await (await request.get('http://127.0.0.1:8791/calls')).json();
  expect(after.slice(before.length).filter((method:string)=>['session.create','session.resume','prompt.submit'].includes(method))).toEqual([]);
});

test('touch scrolling compacts and expands the header without reacting to programmatic jumps', async ({browser}) => {
  const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  try {
    const page = await context.newPage(); await page.goto('/#/conversation/long-history');
    const header = page.locator('.conversation-page-header');
    // Wait for the final shared panel, rather than the history-only preview
    // shown while its local conversation reference is being opened.
    await expect(page.getByLabel('Message Hermes')).toBeEditable();
    await expect(page.locator('[data-history-message="long-history:450"]')).toBeInViewport();
    await expect(header).not.toHaveClass(/is-compact/);
    const cdp = await context.newCDPSession(page);
    async function swipe(start: number, end: number) {
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:250,y:start}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:250,y:end}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    }
    await swipe(600,450); await expect(header).toHaveClass(/is-compact/);
    await swipe(450,600); await expect(header).not.toHaveClass(/is-compact/);
    await page.evaluate(()=>window.scrollBy({top:300,behavior:'instant'}));
    await expect(header).not.toHaveClass(/is-compact/);
  } finally { await context.close(); }
});
