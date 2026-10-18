import { detailsField } from './composer-helpers';
import { test, expect } from '@playwright/test';

const headers = { 'x-herts-request': '1' };
const calls = async (request: any) => (await (await request.get('http://127.0.0.1:8791/calls')).json() as string[]).filter(value => ['session.create', 'session.resume', 'prompt.submit'].includes(value));

test('task capture saves through its shortcut and preserves a collapsed offline draft', async ({ page, request, context }) => {
  const before = await calls(request);
  await page.setViewportSize({ width:390, height:844 });
  await page.goto('/#/tasks/inbox');
  const input = page.getByRole('textbox', { name:'Add a task', exact:true });
  await input.fill('Save without agent execution');
  await input.press('Control+Enter');
  await expect(page.getByRole('link', { name:'Save without agent execution', exact:true })).toBeVisible();
  await input.fill('Preserve this draft');
  await input.press('Enter');
  await expect(input).toHaveValue('Preserve this draft\n');
  await input.press('Control+End');
  await input.press('x');
  await expect(input).toHaveValue('Preserve this draft\nx');
  await page.getByRole('button', { name:'Collapse message box' }).click();
  await expect(input).toHaveValue('Preserve this draft\nx');
  await context.setOffline(true);
  await input.focus();
  await expect(page.getByRole('button', { name:'Send to Hermes', exact:true })).toBeDisabled();
  await input.press('Control+Enter');
  await expect(page.getByRole('link', { name:'Preserve this draft', exact:true })).toBeVisible();
  await context.setOffline(false);
  expect(await calls(request)).toEqual(before);
});

test('task capture shows fields directly on every list and preserves them offline', async ({ page, context }) => {
  await page.goto('/#/tasks/inbox');
  const input = page.getByRole('textbox', { name: 'Add a task', exact: true });
  await input.fill('Keep the task message');
  const title = page.getByRole('textbox', { name: 'New task title', exact: true });
  await expect(title).toBeVisible();
  await title.fill('Keep the optional title');
  for (const list of ['next', 'waiting', 'parked', 'snoozed', 'done', 'inbox']) {
    await page.goto(`/#/tasks/${list}`);
    await input.focus();
    await expect(title).toHaveValue('Keep the optional title');
    await expect(input).toHaveValue('Keep the task message');
    await expect(page.locator('.composer-capture details, .capture-destination')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Conversation settings:/ })).toBeVisible();
  }
  await context.setOffline(true);
  await title.fill('Offline optional title');
  await expect(page.getByRole('button', { name: 'Send to Hermes', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Save to Inbox', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Offline optional title', exact: true })).toBeVisible();
  await context.setOffline(false);
});

test('reading modes and split resizing preserve the discussion draft and article position', async ({ page, request }) => {
  const itemId = crypto.randomUUID(), contextId = crypto.randomUUID();
  await request.post('/api/v1/reading/sync', { headers, data:{ id:crypto.randomUUID(), itemId, contextId, kind:'create', title:'A readable article', url:'https://example.com/split-review', at:Date.now() } });
  await page.route('**/api/v1/plugins/reading/queries/article', async route => {
    const response = await route.fetch(), article = await response.json();
    await route.fulfill({ response, json:{...article, status:'saved', html:'<h2>Article opening</h2>' + '<p>Long article content for reading position restoration.</p>'.repeat(100)} });
  });
  await page.setViewportSize({width:1280,height:844});
  await page.goto(`/#/reading-item/${itemId}`);
  const draft = page.getByRole('textbox', {name:/^(Message Hermes|Add a task)$/,exact:true});
  await draft.fill('Keep these discussion notes');
  await page.getByRole('link', {name:'Article',exact:true}).click();
  await expect(page.locator('.reader-article')).toBeVisible();
  await expect(draft).toBeHidden();
  const article = page.getByRole('region', {name:'Article pane'});
  await article.evaluate(node => {node.scrollTop=400;});
  await expect.poll(() => article.evaluate(node => node.scrollTop)).toBeGreaterThan(300);
  await page.getByRole('link', {name:'Discussion',exact:true}).click();
  await expect(draft).toHaveValue('Keep these discussion notes');
  await page.getByRole('button', {name:'Show alongside',exact:true}).click();
  await expect(article).toBeVisible();
  await expect.poll(() => article.evaluate(node => node.scrollTop)).toBeGreaterThan(300);
  await draft.focus();
  await page.setViewportSize({width:390,height:600});
  await expect(draft).toBeVisible();
  await expect(article).toBeHidden();
  await page.setViewportSize({width:1280,height:844});
  await expect(article).toBeVisible();
  await expect(draft).toHaveValue('Keep these discussion notes');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('page actions support Escape and restore keyboard focus', async ({page,request}) => {
  const taskId=crypto.randomUUID();
  await request.post('/api/v1/sync',{headers,data:{id:crypto.randomUUID(),taskId,kind:'create',title:'Task actions',at:Date.now()}});
  await page.goto(`/#/task/${taskId}`);
  const more=page.locator('.conversation-page-header').getByRole('button',{name:'Actions',exact:true});
  await more.focus();await more.press('Enter');
  await expect(page.getByRole('dialog',{name:'Page actions'})).toBeVisible();
  await page.keyboard.press('Escape');await expect(more).toBeFocused();
});

test('unknown capture outcomes block saving through both the button and shortcut', async ({page,request}) => {
  await page.goto('/#/tasks/inbox');
  const input=page.getByRole('textbox',{name:'Add a task',exact:true});
  await input.fill('Uncertain capture remains available');
  await expect(page.locator('.composer-note')).toContainText('Draft saved');
  const before=await calls(request);
  await page.evaluate(async () => {
    const sdk=(window as any).__HERTS_PLUGIN_RUNTIME__.sdk;
    const draft=(await sdk.conversationDrafts.toArray()).find((value:any)=>value.text==='Uncertain capture remains available');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('hermes-tasks');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('submissions', 'readwrite');
        transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
        const id = crypto.randomUUID();
        transaction.objectStore('submissions').put({id, input: {id, contextId:draft.id, kind:'send', text:draft.text, uploadIds:[]}, at:Date.now(), confirmed:false});
      });
    } finally { database.close(); }
    await sdk.rebuild();
  });
  await expect(page.getByRole('button',{name:'Save to Inbox',exact:true})).toBeDisabled();
  await page.evaluate(async () => { await (window as any).__HERTS_PLUGIN_RUNTIME__.sdk.rebuild(); });
  await expect(page.getByRole('button',{name:'Save to Inbox',exact:true})).toBeDisabled();
  await input.press('Control+Enter');
  await expect(input).toHaveValue('Uncertain capture remains available');
  await expect(page.getByRole('link',{name:'Uncertain capture remains available',exact:true})).toHaveCount(0);
  expect(await calls(request)).toEqual(before);
});

test('article states keep excerpts honest and retain the discussion draft during delayed reads', async ({page,request,context}) => {
  const itemId=crypto.randomUUID();
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/v1/plugins/reading/queries/article',async route=>{
    const response=await route.fetch(),article=await response.json();
    await gate;
    await route.fulfill({response,json:{...article,status:'excerpt',html:'<p>A partial article.</p>',warning:'Only an excerpt is available.'}});
  });
  await request.post('/api/v1/reading/sync',{headers,data:{id:crypto.randomUUID(),itemId,contextId:crypto.randomUUID(),kind:'create',title:'Partial article',url:'https://example.com/partial-design',at:Date.now()}});
  await page.goto(`/#/reading-item/${itemId}`);
  const draft=page.getByRole('textbox',{name:'Message Hermes',exact:true});
  await draft.fill('Notes made while the article loads');
  try {
    await expect(page.locator('.offline-controls > p')).toContainText(/Downloading|Waiting/);
    await page.getByRole('link',{name:'Article',exact:true}).click();
    await expect(page.getByText('Preparing article…',{exact:true})).toBeVisible();
    await page.getByRole('link',{name:'Discussion',exact:true}).click();
    await expect(draft).toHaveValue('Notes made while the article loads');
  } finally {release();}
  await expect(page.locator('.offline-controls > p')).toHaveText('Available offline');
  await page.getByRole('link',{name:'Article',exact:true}).click();
  await expect(page.locator('.reader-excerpt')).toHaveText('Saved excerpt');
  await context.setOffline(true);
  await expect(page.locator('.reader-article')).toContainText('A partial article.');
  await page.getByRole('link',{name:'Discussion',exact:true}).click();
  await expect(draft).toHaveValue('Notes made while the article loads');
  await context.setOffline(false);
});

test('remote task titles update clean fields and preserve unfinished edits', async ({page,request}) => {
  const taskId=crypto.randomUUID();
  await request.post('/api/v1/sync',{headers,data:{id:crypto.randomUUID(),taskId,kind:'create',title:'Original task title',at:Date.now()}});
  await page.goto(`/#/task/${taskId}`);
  await page.locator('.conversation-page-header').getByRole('button',{name:'Actions',exact:true}).click();
  const title=await detailsField(page,'Task title');
  await expect(title).toHaveValue('Original task title');
  await request.post('/api/v1/sync',{headers,data:{id:crypto.randomUUID(),taskId,kind:'title',title:'Remote task title',baseTitle:'Original task title',at:Date.now()}});
  await expect(title).toHaveValue('Remote task title');
  await title.fill('Unfinished local title');
  await request.post('/api/v1/sync',{headers,data:{id:crypto.randomUUID(),taskId,kind:'title',title:'Another remote title',baseTitle:'Remote task title',at:Date.now()}});
  await expect.poll(()=>page.evaluate(id=>(window as any).__HERTS_PLUGIN_RUNTIME__.sdk.getCore().pluginData.tasks.records.state.tasks.find((task:any)=>task.id===id)?.title,taskId)).toBe('Another remote title');
  await expect(title).toHaveValue('Unfinished local title');
});

for(const width of [320,390,768,1280]) test(`visible navigation retains task drag destinations at ${width}px`,async ({page,request})=>{
  const taskId=crypto.randomUUID();
  await request.post('/api/v1/sync',{headers,data:{id:crypto.randomUUID(),taskId,kind:'create',title:'Drag this task to Next',at:Date.now()}});
  await page.setViewportSize({width,height:844});await page.goto('/#/tasks/inbox');
  const row=page.locator(`[data-task-id="${taskId}"]`);await expect(row).toBeVisible();
  const target=page.locator('.mobile-lists [data-drop-list="next"]');
  await expect(target).toBeInViewport({ratio:1});
  const box=(await row.boundingBox())!;
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  await expect(target).toHaveClass(/task-drop-ready/);
  const destination=(await target.boundingBox())!;
  await page.mouse.move(destination.x+destination.width/2,destination.y+destination.height/2,{steps:12});
  await page.mouse.up();await expect(row).toHaveCount(0);
  await target.click();
  await expect(row).toBeVisible();await expect(target).toBeVisible();
});

test('article metadata stays compact and download failure offers an explicit retry', async ({ page, request }) => {
  const itemId = crypto.randomUUID();
  let unavailable = false;
  await page.route('**/api/v1/plugins/reading/queries/article', async route => {
    const response = await route.fetch(), article = await response.json();
    await route.fulfill({ response, json: { ...article, siteName: 'X', status: unavailable ? 'unavailable' : 'excerpt', html: unavailable ? '' : '<p>A saved excerpt of the original post.</p>', warning: unavailable ? 'Download interrupted.' : 'Saved excerpt · May be incomplete.' } });
  });
  await request.post('/api/v1/reading/sync', { headers, data: { id: crypto.randomUUID(), itemId, contextId: crypto.randomUUID(), kind: 'create', title: 'Teknium (@Teknium) on X', url: 'https://example.com/article-cleanup', at: Date.now() } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/#/reader/${itemId}`);
  const pane = page.getByRole('region', { name: 'Article pane' });
  await expect(pane.getByText('Saved excerpt', { exact: true })).toHaveCount(1);
  await expect(pane.locator('.reader-warning')).toHaveCount(0);
  await expect(pane.getByRole('link', { name: 'Open original', exact: true })).toHaveAttribute('href', 'https://example.com/article-cleanup');
  await page.screenshot({ path: 'test-results/article-cleanup-press-390.png' });
  unavailable = true;
  await request.post('/api/v1/reading/sync', { headers, data: { id: crypto.randomUUID(), itemId, kind: 'offline', offline: 'keep', at: Date.now() } });
  await expect(pane.getByRole('alert')).toContainText('Download interrupted.');
  const retry = pane.getByRole('button', { name: 'Retry download', exact: true });
  await expect(retry).toBeVisible();
  unavailable = false;
  await retry.click();
  await expect(pane.locator('.reader-article')).toContainText('A saved excerpt');
  await expect(pane.getByRole('alert')).toHaveCount(0);
});
