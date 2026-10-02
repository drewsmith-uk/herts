import { test, expect } from '@playwright/test';

for (const width of [390,1280]) test(`submitted messages and tool-only work update in place on ${width}px screens`,async({page,request})=>{
  await page.setViewportSize({width,height:844});
  await page.goto('/#/conversations');await page.getByRole('link',{name:new RegExp(`Live history ${width}`)}).click();
  await page.getByRole('button',{name:'Make a task',exact:true}).click();await page.getByRole('button',{name:'Create task',exact:true}).click();
  await expect(page).toHaveURL(/#\/task\//);
  const url=page.url(),text=`Live transcript ${width}: show my message and tool activity immediately.`;
  await expect(page.getByLabel('Message Hermes')).toBeInViewport();
  const bottom=await page.locator('.conversation-scroll').evaluate(el=>el.scrollTop);await page.mouse.move(width/2,450);await page.mouse.wheel(0,-500);await expect.poll(()=>page.locator('.conversation-scroll').evaluate(el=>el.scrollTop)).toBeLessThan(bottom-100);
  const before=(await(await request.get('http://127.0.0.1:8791/calls')).json()).filter((m:string)=>m==='prompt.submit').length;
  // Observe the pending message independently of draft/settings sync time or a
  // fast history response replacing it. Do not start Hermes until it is visible.
  let release!:()=>void,submitted!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{submitted=resolve;});
  await page.route('**/api/v1/actions',async route=>{submitted();await held;await route.continue();});
  try {
    await page.getByLabel('Message Hermes').fill(text);await page.getByRole('button',{name:'Send',exact:true}).click();await ready;
    await expect(page.locator('.outgoing-message')).toContainText(text,{timeout:1500});await expect(page.locator('.outgoing-message')).toBeInViewport();
    await expect(page.locator('.message.from-user').filter({hasText:text})).toHaveCount(1);
  } finally { release(); }
  await expect(page.locator('.conversation-status')).toBeInViewport();await expect(page.getByRole('button',{name:'Show latest messages',exact:true})).toHaveCount(0);
  await expect(page.locator('.message.from-user').filter({hasText:text})).toHaveCount(1);
  const toggle=page.locator('.activity-group').getByRole('button',{name:/Hermes activity/});
  await expect(toggle).toContainText('1 tool call');await expect(page.locator('.outgoing-message')).toHaveCount(0);await expect(page.locator('.message.from-user').filter({hasText:text})).toHaveCount(1);
  await expect(page.locator('.conversation-status')).toBeInViewport();await page.screenshot({path:`test-results/live-working-${width}.png`});await toggle.click();await expect(toggle).toHaveAttribute('aria-expanded','true');const top=await toggle.evaluate(el=>el.getBoundingClientRect().top);
  expect((await request.post(`/__test/live-transcript/live-history-${width}/next`, { headers: { 'x-herts-request': '1' }, data: {} })).ok()).toBe(true);
  await expect(page.getByRole('button',{name:'Show latest messages',exact:true})).toBeAttached();
  expect(Math.abs(await toggle.evaluate(el=>el.getBoundingClientRect().top)-top)).toBeLessThan(5);await expect(toggle).toHaveAttribute('aria-expanded','true');
  // Block the next history request: already-fetched updates still open at once.
  await page.route('**/api/v1/conversations/*/history?*',route=>route.abort());
  await page.getByRole('button',{name:'Show latest messages',exact:true}).click();await expect(toggle).toContainText('2 tool calls',{timeout:1000});await expect(toggle).toHaveAttribute('aria-expanded','true');
  await page.unroute('**/api/v1/conversations/*/history?*');await toggle.click();await expect(toggle).toHaveAttribute('aria-expanded','false');
  await page.getByRole('button',{name:'Refresh conversation history',exact:true}).click();
  expect((await request.post(`/__test/live-transcript/live-history-${width}/finish`, { headers: { 'x-herts-request': '1' }, data: {} })).ok()).toBe(true);
  await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase','complete');await expect(page.locator('.conversation-status')).toHaveCount(0);
  await expect(page.locator('.message').filter({hasText:'Your work continued after leaving the app.'})).toHaveCount(1);
  expect(page.url()).toBe(url);expect((await(await request.get('http://127.0.0.1:8791/calls')).json()).filter((m:string)=>m==='prompt.submit')).toHaveLength(before+1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`test-results/live-transcript-${width}.png`});
});
