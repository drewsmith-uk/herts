import { test, expect } from '@playwright/test';

for (const width of [390, 1280]) test(`opens latest history on ${width}px screens and prepends older messages`, async ({page,context,request}) => {
  await page.setViewportSize({width,height:844});
  const before = await (await request.get('http://127.0.0.1:8791/calls')).json();
  await page.goto('/#/conversation/long-history');
  await expect(page.getByLabel('Message Hermes')).toBeVisible();
  const recent = page.locator('[data-history-message="long-history:450"]');
  await expect(recent).toBeInViewport();
  await expect(page.locator('[data-history-message="long-history:1"]')).toHaveCount(0);
  await expect(page.locator('.message')).toHaveCount(200);
  const oldestLoaded = page.locator('[data-history-message="long-history:251"]');
  await page.getByRole('button',{name:'Load older messages',exact:true}).scrollIntoViewIfNeeded();
  const originalTop = await oldestLoaded.evaluate(el=>el.getBoundingClientRect().top);
  await page.getByRole('button',{name:'Load older messages',exact:true}).click();
  await expect(page.locator('.message')).toHaveCount(400);
  await expect.poll(async()=>Math.abs(await oldestLoaded.evaluate(el=>el.getBoundingClientRect().top)-originalTop)).toBeLessThan(5);
  await expect(page.locator('.message').first()).toContainText('History message 51.');
  await expect(page.locator('.message').last()).toContainText('History message 450.');
  await page.getByRole('button',{name:'Load older messages',exact:true}).click();
  await expect(page.locator('.message').first()).toContainText('History message 1.');
  await expect(page.getByRole('button',{name:'Load older messages',exact:true})).toHaveCount(0);
  await page.evaluate(()=>navigator.serviceWorker.ready); await page.reload(); await expect(recent).toBeInViewport();
  await context.setOffline(true); await page.reload(); await expect(recent).toBeInViewport(); await expect(page.getByText('Showing saved messages',{exact:false})).toBeAttached();
  await context.setOffline(false);
  const after = await (await request.get('http://127.0.0.1:8791/calls')).json();
  expect(after.slice(before.length).filter((method:string)=>['session.create','session.resume','prompt.submit'].includes(method))).toEqual([]);
});

test('linked tasks also open at the latest message with the composer visible', async ({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/#/conversations'); await page.getByRole('link',{name:/Long conversation/}).click();
  await expect(page.locator('[data-history-message="long-history:450"]')).toBeInViewport();
  await page.getByRole('button',{name:'Make a task',exact:true}).click(); await page.getByRole('button',{name:'Create task',exact:true}).click();
  await expect(page.getByLabel('Message Hermes')).toBeInViewport();
  await expect(page.locator('[data-history-message="long-history:450"]')).toBeInViewport();
});

test('keeps history cached by the previous app available offline', async ({page,context})=>{
  await page.goto('/'); await page.getByLabel('Message Hermes').waitFor(); await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.evaluate(async()=>{
    const request=indexedDB.open('hermes-tasks'); const db=await new Promise<IDBDatabase>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    await new Promise<void>((resolve,reject)=>{const tx=db.transaction('kv','readwrite');tx.objectStore('kv').put({key:'history:legacy:200',value:{sessionId:'legacy',offset:200,hasMore:false,fetchedAt:Date.now(),messages:[{id:1,role:'assistant',content:'Previously saved history.'}]}});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();
  });
  await context.setOffline(true); await page.goto('/#/conversation/legacy');
  await expect(page.getByText('Previously saved history.',{exact:true})).toBeInViewport();
});
