import { detailsField, detailsControl } from './composer-helpers';
import { test, expect, type Page } from '@playwright/test';
const calls = async (request: any) => (await (await request.get('http://127.0.0.1:8791/calls')).json() as string[]).filter(m => ['session.create','session.resume','prompt.submit'].includes(m));
async function add(page: Page, title: string) { await page.goto('/#/reading/add'); await expect(page.locator('.save-state')).toContainText('Changes synced'); await page.getByLabel('Message Hermes',{exact:true}).fill(`https://example.com/${encodeURIComponent(title)}`); await (await detailsField(page, 'Reading title')).fill(title); await page.getByRole('button',{name:'Send',exact:true}).click(); await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase','complete'); }

test('phone reading capture sends only its raw URL, keeps conversation visible, and makes an independent task', async ({page,request}) => {
  await page.setViewportSize({width:390,height:844}); const before = await calls(request);
  await add(page,'Read this on phone'); const readingUrl = page.url();
  await expect(page.getByLabel('Message Hermes')).toHaveValue('');
  expect((await calls(request)).slice(before.length)).toEqual(['session.create','prompt.submit']);
  await expect(page.locator('.offline-controls')).toContainText('Available offline');
  await expect(page.getByRole('link',{name:'Settings',exact:true})).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/#/conversations'); await page.getByRole('checkbox', { name: 'Show all', exact: true }).check(); await expect(page.getByRole('link',{name:/Read this on phone/})).toBeVisible();
  await page.goto(readingUrl); await expect((await detailsControl(page, 'link', 'Open original'))).toHaveAttribute('href','https://example.com/Read%20this%20on%20phone');
  await page.getByRole('button',{name:'Make a task',exact:true}).click(); await page.getByRole('button',{name:'Create task',exact:true}).click();
  await expect((await detailsField(page, 'Task title'))).toHaveValue('Read this on phone');
  await (await detailsControl(page, 'button', 'Complete task')).click();
  await page.goto(readingUrl); await expect((await detailsControl(page, 'button', 'Mark read'))).toBeVisible();
  await (await detailsControl(page, 'button', 'Mark read')).click(); await expect(page.locator('.offline-controls')).toContainText('Download removed');
  await page.screenshot({path:'test-results/phone-reading-detail.png',fullPage:true});
});

test('making a task suggests the current reading title after renaming a shared link', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/reading/add');
  await page.getByLabel('Message Hermes', { exact: true }).fill('https://example.com/security-checklist');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase', 'complete');
  const readingUrl = page.url(), before = await calls(request);
  const suggestion = page.getByRole('textbox', { name: 'New task from conversation title', exact: true });
  for (const title of ['Security checklist', 'Security checklist for my app']) {
    await (await detailsField(page, 'Reading title')).fill(title);
    await (await detailsField(page, 'Reading title')).blur();
    await expect(page.locator('.save-state')).toContainText('Changes synced');
    await page.getByRole('button', { name: 'Make a task', exact: true }).click();
    await expect(suggestion).toHaveValue(title);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  await page.reload();
  await page.getByRole('button', { name: 'Make a task', exact: true }).click();
  await expect(suggestion).toHaveValue('Security checklist for my app');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect((await detailsField(page, 'Task title'))).toHaveValue('Security checklist for my app');
  await page.goto(readingUrl);
  await expect(page.getByRole('button', { name: 'Open task', exact: true })).toBeVisible();
  expect(await calls(request)).toEqual(before);
});

test('bookmarks multiple links without starting work and reopens an existing read item', async ({page,request}) => {
  const before = await calls(request); await page.goto('/#/conversation/reading-links');
  await page.getByRole('button',{name:'Save to reading list: https://example.com/one',exact:true}).first().click();
  await expect(page.getByRole('button',{name:'Open reading item: https://example.com/one',exact:true})).toHaveCount(2);
  await page.getByRole('button',{name:'Save to reading list: https://example.com/two',exact:true}).click();
  await expect(page.locator('.save-state')).toContainText('Changes synced');
  expect(await calls(request)).toEqual(before);
  await page.getByRole('button',{name:'Open reading item: https://example.com/one',exact:true}).first().click(); const url=page.url();
  await (await detailsControl(page, 'button', 'Mark read')).click(); await expect(page.locator('.save-state')).toContainText('Changes synced');
  await page.goto('/#/conversation/reading-links'); await page.getByRole('button',{name:'Open reading item: https://example.com/one',exact:true}).last().click(); await expect(page).toHaveURL(url);
  const state = await (await request.get('/api/v1/state')).json(); expect(state.snapshot.reading.items.filter((i:any)=>['https://example.com/one','https://example.com/two'].includes(i.url))).toHaveLength(2);
});

test('Android share confirmation saves offline and reconnecting never sends', async ({page,context,request}) => {
  await page.setViewportSize({width:390,height:844}); await page.goto('/#/reading'); await expect(page.locator('.save-state')).toContainText('Changes synced');
  await page.evaluate(() => navigator.serviceWorker.ready); await page.reload(); const before=await calls(request);
  await context.setOffline(true);
  await page.goto('/share?title=Shared%20story&text=Read%20https%3A%2F%2Fexample.com%2Fshared-offline');
  await page.getByRole('button',{name:'Reading',exact:true}).click();
  await expect(page.getByLabel('Message Hermes',{exact:true})).toHaveValue('Read https://example.com/shared-offline');
  await page.getByRole('button',{name:'Save link',exact:true}).click(); await page.getByRole('link',{name:'Shared story',exact:true}).click(); await expect(page).toHaveURL(/#\/reading-item\/[0-9a-f-]+$/); await expect((await detailsField(page, 'Reading title'))).toHaveValue('Shared story'); const url = page.url();
  await page.reload(); await expect(page.getByLabel('Message Hermes')).toHaveValue('Read https://example.com/shared-offline');
  await context.setOffline(false); await expect(page.locator('.save-state')).toContainText('Changes synced'); expect(await calls(request)).toEqual(before);
  await page.getByRole('button',{name:'Send',exact:true}).click(); await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase','complete');
  expect((await calls(request)).slice(before.length)).toEqual(['session.create','prompt.submit']);
  await expect(page.locator('.offline-controls')).toContainText('Available offline'); await (await detailsControl(page, 'link', 'Read in Herts')).click();
  await expect(page.locator('.reader-article')).toContainText('Article paragraph 7');
  await context.setOffline(true); await page.reload(); await expect(page.locator('.reader-article')).toContainText('Article paragraph 7');
  await page.goto(url); await (await detailsControl(page, 'button', 'Mark read')).click(); await expect(page.locator('.offline-controls')).toContainText('Download removed');
  expect(await page.evaluate(async () => { const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('hermes-tasks');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);}); const rows=await new Promise<any[]>((resolve,reject)=>{const r=db.transaction('pluginLocal').objectStore('pluginLocal').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();return rows.some(a=>a.key.startsWith('reading:')&&a.value?.url?.includes('shared-offline'));})).toBe(false);
  await context.setOffline(false);
});

test('a multi-link share requires choosing one and cancel starts no work', async ({page,request}) => {
  const before=await calls(request);
  await page.goto('/share?text=https%3A%2F%2Fexample.com%2Fa%20https%3A%2F%2Fexample.com%2Fb');
  await page.getByRole('button',{name:'Reading',exact:true}).click();
  await expect(page.getByRole('radio')).toHaveCount(2); await expect(page.getByLabel('Message Hermes',{exact:true})).toHaveValue('https://example.com/a https://example.com/b');
  await page.getByRole('button',{name:'Save link',exact:true}).click(); await expect(page.getByRole('alert')).toContainText('Choose which link');
  await page.getByRole('radio').last().check(); await expect(page.getByLabel('Message Hermes',{exact:true})).toHaveValue('https://example.com/a https://example.com/b');
  await page.getByRole('link',{name:'Reading list',exact:true}).click(); await expect(page).toHaveURL(/#\/reading$/); expect(await calls(request)).toEqual(before);
});

test('unread reorder controls and shared drafts survive reload across reading and task views', async ({page}) => {
  // A slow acknowledgement must not let the shared composer make the old
  // reading page look like the newly-created task page.
  await page.route('**/api/v1/plugins/tasks/commands', async route => {
    const response = await route.fetch();
    if (route.request().postDataJSON()?.command === 'link') await new Promise(resolve => setTimeout(resolve, 750));
    await route.fulfill({ response });
  });
  await add(page,'Reading order first'); const readingUrl=page.url();
  await page.getByRole('button',{name:'Make a task',exact:true}).click(); await page.getByRole('button',{name:'Create task',exact:true}).click();
  await expect(page).toHaveURL(/#\/task\/[0-9a-f-]+$/);
  await expect((await detailsField(page, 'Task title'))).toHaveValue('Reading order first');
  const taskUrl=page.url();
  await page.getByLabel('Message Hermes').fill('Shared follow-up draft'); await page.goto(readingUrl); await expect(page.getByLabel('Message Hermes')).toHaveValue('Shared follow-up draft');
  await page.getByLabel('Message Hermes').fill('Revised from reading'); await page.goto(taskUrl); await expect(page.getByLabel('Message Hermes')).toHaveValue('Revised from reading');
  await add(page,'Reading order second'); await page.goto('/#/reading'); await page.getByRole('button',{name:'Edit list',exact:true}).click();
  await page.getByRole('button',{name:'Move Reading order second down',exact:true}).click(); await expect(page.getByLabel('Edit reading title',{exact:true}).first()).toHaveValue('Reading order first');
  await expect(page.locator('.save-state')).toContainText('Changes synced'); await page.reload(); await expect(page.locator('.reading-row .task-title').first()).toHaveText('Reading order first');
});

test('a lost Send acknowledgement is recovered without repeating the conversation or message', async ({page,request}) => {
  const before = await calls(request); let interrupted = false;
  await page.route('**/api/v1/actions', async route => {
    const response = await route.fetch(); if (!interrupted) { interrupted = true; await route.abort('failed'); } else await route.fulfill({response});
  });
  await page.goto('/#/reading/add'); await expect(page.locator('.save-state')).toContainText('Changes synced');
  await page.getByLabel('Message Hermes',{exact:true}).fill('https://example.com/lost-reading-receipt'); await (await detailsField(page, 'Reading title')).fill('Lost reading receipt');
  await page.getByRole('button',{name:'Send',exact:true}).click(); await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase','complete');
  await page.reload(); await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase','complete');
  expect((await calls(request)).slice(before.length)).toEqual(['session.create','prompt.submit']);
  const state=await(await request.get('/api/v1/state')).json(); expect(state.snapshot.reading.items.filter((i:any)=>i.url==='https://example.com/lost-reading-receipt')).toHaveLength(1);
});

test('concurrent offline bookmarks converge on one item and a read on another device removes its local copy', async ({page,context,browser,request}) => {
  const second = await browser.newContext(); const other=await second.newPage();
  try {
    for (const tab of [page,other]) {
      await tab.route('**/api/v1/conversations/reading-links/history**', route=>route.fulfill({json:{sessionId:'reading-links',order:'latest',messages:[{id:4,role:'assistant',content:'[Concurrent article](https://example.com/concurrent-reading)'}],offset:0,hasMore:false,fetchedAt:Date.now()}}));
      await tab.goto('/#/conversation/reading-links'); await expect(tab.locator('.save-state')).toContainText('Changes synced'); await expect(tab.getByRole('button',{name:'Save to reading list: https://example.com/concurrent-reading',exact:true})).toBeVisible();
    }
    await context.setOffline(true); await second.setOffline(true);
    for(const tab of [page,other]) await tab.getByRole('button',{name:'Save to reading list: https://example.com/concurrent-reading',exact:true}).click();
    await context.setOffline(false); await expect(page.locator('.save-state')).toContainText('Changes synced');
    await second.setOffline(false); await expect(other.locator('.save-state')).toContainText('Changes synced');
    for(const tab of [page,other]) { await tab.getByRole('button',{name:'Open reading item: https://example.com/concurrent-reading',exact:true}).click(); await expect(tab.locator('.offline-controls')).toContainText('Available offline'); }
    expect(page.url()).toBe(other.url());
    await (await detailsControl(page, 'button', 'Mark read')).click(); await expect((await detailsControl(other, 'button', 'Mark unread'))).toBeVisible(); await expect(other.locator('.offline-controls')).toContainText('Download removed');
    const state=await(await request.get('/api/v1/state')).json(); expect(state.snapshot.reading.items.filter((i:any)=>i.url==='https://example.com/concurrent-reading')).toHaveLength(1);
  } finally { await context.setOffline(false); await second.close(); }
});

test('storage failure does not claim offline availability or prevent reading the fetched article', async ({page}) => {
  await page.addInitScript(() => { const put=IDBObjectStore.prototype.put; IDBObjectStore.prototype.put=function(...args: Parameters<typeof put>) { if(this.name==='pluginLocal' && String(args[0]?.key).includes(':article:')) throw new DOMException('Storage full','QuotaExceededError');return put.apply(this,args); }; });
  await add(page,'Article with full device storage');
  await expect(page.locator('.offline-controls')).toContainText('Could not save the article on this device');
  await expect(page.locator('.offline-controls')).not.toContainText('Available offline');
  await (await detailsControl(page, 'link', 'Read in Herts')).click(); await expect(page.locator('.reader-article')).toContainText('Article paragraph 7');
});
