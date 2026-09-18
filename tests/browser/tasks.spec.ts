import { test, expect, type Page } from '@playwright/test';
async function capture(page: Page, title: string) { await page.goto('/'); await page.getByRole('textbox', { name: 'New task title' }).fill(title); await page.getByRole('button', { name: 'Add task', exact: true }).click(); await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible(); }
test('phone capture, edit mode, priority, completion and offline reload', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, 'Book the train'); await capture(page, 'Prepare for Friday');
  await expect(page.locator('.task-title').first()).toHaveText('Prepare for Friday');
  await page.getByRole('button', { name: 'Edit list', exact: true }).click();
  await page.getByRole('textbox', { name: 'Edit task title' }).first().fill('Prepare for Monday'); await page.getByRole('textbox', { name: 'Edit task title' }).first().press('Enter');
  await page.getByRole('button', { name: 'Move Prepare for Monday down', exact: true }).click();
  await page.getByRole('button', { name: 'Finish editing' }).click(); await expect(page.locator('.task-title').first()).toHaveText('Book the train');
  await page.getByRole('link', { name: 'Prepare for Monday', exact: true }).click(); await page.getByLabel('Task list', { exact: true }).selectOption('next');
  await page.goto('/#/tasks/next'); await expect(page.locator('.task-title').first()).toHaveText('Prepare for Monday');
  await page.evaluate(() => navigator.serviceWorker.ready); await page.reload(); await expect(page.locator('.save-state')).toContainText('All changes saved');
  await context.setOffline(true); await capture(page, 'Offline idea'); await page.reload(); await expect(page.getByRole('link', { name: 'Offline idea', exact: true })).toBeVisible();
  await context.setOffline(false); await expect(page.locator('.save-state')).toContainText('All changes saved');
  await page.screenshot({ path: 'test-results/phone-inbox.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('preview and convert an existing conversation without starting work', async ({ page, request }) => {
  const before: string[] = await (await request.get('http://127.0.0.1:8791/calls')).json();
  await page.goto('/#/conversations'); await page.getByRole('link', { name: /Plan the autumn trip/ }).click();
  await expect(page.getByText('We could visit the coast.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Make a task' }).click(); await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByLabel('Task title', { exact: true })).toHaveValue('Plan the autumn trip');
  const after: string[] = await (await request.get('http://127.0.0.1:8791/calls')).json();
  expect(after.slice(before.length).filter(m => ['session.resume','session.create','prompt.submit'].includes(m))).toEqual([]);
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0);
  await page.reload(); await page.getByLabel('Message Hermes').fill('A short list, please'); await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  const beforeSend: string[] = await (await request.get('http://127.0.0.1:8791/calls')).json();
  expect(beforeSend.slice(before.length).filter(m => ['session.resume','session.create','prompt.submit'].includes(m))).toEqual([]);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.execution-title')).toContainText('complete');
  const afterSend: string[] = await (await request.get('http://127.0.0.1:8791/calls')).json();
  expect(afterSend.slice(beforeSend.length).filter(m => ['session.resume','session.create','prompt.submit'].includes(m))).toEqual(['session.resume','prompt.submit']);
});
test('accepted work continues after closing the page; approvals are deliberate', async ({ page, context }) => {
  await capture(page, 'Draft the itinerary'); await page.getByRole('link', { name: 'Draft the itinerary', exact: true }).click();
  await page.getByLabel('Message Hermes').fill('Please draft it.'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.execution-card')).toBeVisible(); const url = page.url(); await page.close();
  const next = await context.newPage(); await next.goto(url); await expect(next.locator('.execution-title')).toContainText('complete');
  await expect(next.getByText('Your work continued after leaving the app.', { exact: false })).toBeVisible();
  await next.getByLabel('Message Hermes').fill('ask approval'); await next.getByRole('button', { name: 'Send', exact: true }).click();
  await next.getByRole('button', { name: 'Approve once', exact: true }).click(); await expect(next.locator('.execution-title')).toContainText('complete');
  await next.screenshot({ path: 'test-results/desktop-conversation.png', fullPage: true });
});
test('dictation countdown cancels on editing, and saved draft reload never sends', async ({ page, request }) => {
  await capture(page, 'Voice draft'); await page.getByRole('link', { name: 'Voice draft', exact: true }).click();
  const initialSends=(await (await request.get('http://127.0.0.1:8791/calls')).json()).filter((m: string)=>m==='prompt.submit').length;
  await page.getByLabel('Message Hermes').fill('Keep this draft.');
  await page.getByRole('button',{name:'Dictate',exact:true}).click(); await page.waitForTimeout(1200); await page.getByRole('button',{name:'Cancel dictation',exact:true}).click();
  await page.getByRole('button',{name:'Transcribe saved recording',exact:true}).click(); await expect(page.getByLabel('Message Hermes')).toHaveValue(/Please draft a packing list\./);
  await expect(page.getByText('Sending voice message in',{exact:false})).not.toBeVisible();
  expect((await (await request.get('http://127.0.0.1:8791/calls')).json()).filter((m: string)=>m==='prompt.submit').length).toBe(initialSends);
  await page.getByRole('button', { name: 'Dictate', exact: true }).click(); await expect(page.getByText('Recording…', { exact: false })).toBeVisible();
  await page.waitForTimeout(1200); await page.getByRole('button', { name: 'Stop recording and transcribe' }).click();
  await expect(page.getByText('Sending voice message in', { exact: false })).toBeVisible();
  await page.getByLabel('Message Hermes').fill('My revised packing list.'); await expect(page.getByText('Sending voice message in', { exact: false })).not.toBeVisible();
  const before = (await (await request.get('http://127.0.0.1:8791/calls')).json()).filter((m: string) => m === 'prompt.submit').length;
  await page.reload(); await expect(page.getByLabel('Message Hermes')).toHaveValue('My revised packing list.'); await page.waitForTimeout(5500);
  expect((await (await request.get('http://127.0.0.1:8791/calls')).json()).filter((m: string) => m === 'prompt.submit').length).toBe(before);
});
test('two devices retain conflicting title edits and let the user choose', async ({ page, context, browser }) => {
  await capture(page, 'Shared planning task'); await expect(page.locator('.save-state')).toContainText('All changes saved');
  await page.getByRole('link', {name:'Shared planning task',exact:true}).click(); const url=page.url();
  const second=await browser.newContext(); const other=await second.newPage();
  try {
    await other.goto(url); await expect(other.getByLabel('Task title',{exact:true})).toHaveValue('Shared planning task'); await expect(other.locator('.save-state')).toContainText('All changes saved');
    await context.setOffline(true); await second.setOffline(true);
    await page.getByLabel('Task title',{exact:true}).fill('Title from phone'); await page.getByLabel('Task title',{exact:true}).press('Tab');
    await other.getByLabel('Task title',{exact:true}).fill('Title from Mac'); await other.getByLabel('Task title',{exact:true}).press('Tab');
    await context.setOffline(false); await expect(page.locator('.save-state')).toContainText('All changes saved');
    await second.setOffline(false); await expect(other.getByText('Your change: Title from Mac',{exact:true})).toBeVisible(); await expect(other.getByText('Synced version: Title from phone',{exact:true})).toBeVisible();
    await other.getByRole('button',{name:'Keep my change',exact:true}).click(); await expect(other.locator('.save-state')).toContainText('All changes saved'); await page.reload(); await expect(page.getByLabel('Task title',{exact:true})).toHaveValue('Title from Mac');
  } finally { await second.close(); }
});
test('backgrounding during transcription retains audio and never starts a countdown on return', async ({page,request}) => {
  await capture(page,'Backgrounded recording'); await page.getByRole('link',{name:'Backgrounded recording',exact:true}).click();
  await page.getByLabel('Message Hermes').fill('My saved text.');
  const before=(await (await request.get('http://127.0.0.1:8791/calls')).json()).filter((m:string)=>m==='prompt.submit').length;
  let release!:()=>void; const gate=new Promise<void>(resolve=>release=resolve);
  await page.route('**/api/v1/audio/transcribe',async route=>{await gate; await route.continue();});
  await page.getByRole('button',{name:'Dictate',exact:true}).click(); await page.waitForTimeout(1200); await page.getByRole('button',{name:'Stop recording and transcribe',exact:true}).click();
  await expect(page.getByText('Transcribing…',{exact:false})).toBeVisible();
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
  release(); await expect(page.getByRole('button',{name:'Transcribe saved recording',exact:true})).toBeVisible();
  await expect(page.getByLabel('Message Hermes')).toHaveValue('My saved text.'); await expect(page.getByText('Sending voice message in',{exact:false})).not.toBeVisible();
  expect((await (await request.get('http://127.0.0.1:8791/calls')).json()).filter((m:string)=>m==='prompt.submit').length).toBe(before);
});
