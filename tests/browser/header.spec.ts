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
  await usable(header.getByRole('heading',{name:'Header conversation',exact:true})); await usable(recent);
  const hide = header.getByRole('button', { name: 'Hide conversation', exact: true });
  await usable(hide);
  const makeOrOpen = header.getByRole('button', { name: /^(Make a task|Open task)$/ });
  const hideBox = (await hide.boundingBox())!, taskBox = (await makeOrOpen.boundingBox())!;
  expect(Math.abs(hideBox.y - taskBox.y)).toBeLessThan(2);
  await page.screenshot({ path: `test-results/conversation-view-actions-${width}.png` });
  await scrollHistory(page,200); await expect(header).toHaveClass(/is-hidden/);
  await scrollHistory(page,-250); await expect(header).not.toHaveClass(/is-hidden/);
  await usable(header.getByRole('heading',{name:'Header conversation',exact:true}));
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
  await scrollHistory(page,150); await expect(header).not.toHaveClass(/is-hidden/);
  await title.press('Tab'); await expect(page.locator('.save-state')).toContainText('All changes saved');
  await page.reload(); await expect(title).toHaveValue(`Long task title edited on ${width}px`);
  await usable(title); await usable(list); await usable(recent); await usable(page.getByLabel('Message Hermes'));
  await page.screenshot({path:`test-results/conversation-header-${width}.png`});
  await scrollHistory(page,200); await expect(header).toHaveClass(/is-hidden/);
  // Keyboard focus brings hidden controls back without navigating to the top of the history.
  await title.focus(); await expect(header).not.toHaveClass(/is-hidden/); await usable(title); await usable(recent);
  await title.evaluate(el => (el as HTMLElement).blur());
  await page.keyboard.press('PageDown'); await expect(header).toHaveClass(/is-hidden/);
  await page.keyboard.press('PageUp'); await expect(header).not.toHaveClass(/is-hidden/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const after = await (await request.get('http://127.0.0.1:8791/calls')).json();
  expect(after.slice(before.length).filter((method:string)=>['session.create','session.resume','prompt.submit'].includes(method))).toEqual([]);
});

test('touch scrolling hides and reveals the header without reacting to programmatic jumps', async ({browser}) => {
  const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  try {
    const page = await context.newPage(); await page.goto('/#/conversation/long-history');
    const header = page.locator('.conversation-page-header');
    await expect(page.locator('[data-history-message="long-history:450"]')).toBeInViewport();
    await expect(header).not.toHaveClass(/is-hidden/);
    const cdp = await context.newCDPSession(page);
    async function swipe(start: number, end: number) {
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:250,y:start}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:250,y:end}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    }
    await swipe(600,450); await expect(header).toHaveClass(/is-hidden/);
    await swipe(450,600); await expect(header).not.toHaveClass(/is-hidden/);
    await page.evaluate(()=>window.scrollBy({top:300,behavior:'instant'}));
    await expect(header).not.toHaveClass(/is-hidden/);
  } finally { await context.close(); }
});
