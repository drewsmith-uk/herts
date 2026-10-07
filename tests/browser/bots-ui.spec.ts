import { test, expect, type APIRequestContext } from '@playwright/test';
const headers = { 'x-herts-request': '1' };
async function manage(request: APIRequestContext, action: string) {
  const { catalogue } = await (await request.get('/api/v1/plugins')).json();
  expect((await request.post('/api/v1/plugins/bots/manage', { headers, data: { action, revision: catalogue.revision } })).ok()).toBe(true);
}
async function action(request: APIRequestContext, command: string, input: unknown) {
  const { catalogue } = await (await request.get('/api/v1/plugins')).json();
  const response = await request.post('/api/v1/plugins/bots/actions', { headers, data: { id: crypto.randomUUID(), generation: catalogue.entries.find((e: any) => e.manifest.id === 'bots').generation, command, input } });
  expect(response.ok()).toBe(true); const result = await response.json();
  await expect.poll(async () => (await (await request.get(`/api/v1/plugins/bots/actions/${result.id}`)).json()).state).toBe('finished');
}
async function configure(request: APIRequestContext, changes: Record<string, unknown>) {
  const detail = await (await request.post('/api/v1/plugins/bots/queries/describe', { headers, data: { name: 'research' } })).json();
  await action(request, 'configure', { name: 'research', title: detail.title, description: detail.description, revision: detail.revision, ...changes });
}
test.beforeEach(async ({ request }) => { await manage(request, 'enable'); await configure(request, { title: 'Researcher', description: 'Research specialist', hidden: false }); });
test.afterEach(async ({ request }) => { await configure(request, { title: 'Researcher', description: 'Research specialist', hidden: false }); await manage(request, 'disable'); });

test('roster bounds, full-row targets, empty states and filters survive navigation', async ({ page, request }) => {
  await configure(request, { title: 'Research'.repeat(12), description: 'https://example.com/' + 'abcdef'.repeat(75) });
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 }); await page.goto('/#/plugins/bots');
    const link = page.getByRole('link', { name: 'Research'.repeat(12), exact: true }); await expect(link).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await page.getByRole('searchbox', { name: 'Search bots' }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole('searchbox', { name: 'Search bots' }).fill('unmatched');
  await expect(page.getByRole('heading', { name: 'No bots match this search' })).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.locator('.sidebar').getByRole('link', { name: 'Bots', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Search bots' })).toHaveValue('unmatched');
  await page.getByRole('button', { name: 'Clear search bots', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Research'.repeat(12), exact: true })).toBeVisible();
});

test('bot forms validate identifiers, preserve drafts and lock every field through saving', async ({ page }) => {
  await page.goto('/#/plugins/bots'); await page.getByRole('button', { name: 'New bot' }).click();
  await page.getByLabel('Bot name', { exact: true }).fill('UI Writer');
  await expect(page.getByLabel('Profile identifier')).toHaveValue('ui-writer');
  await page.getByText('Model and profile settings', {exact:true}).click();
  await page.getByLabel('Profile identifier').fill('Bad Profile Name');
  expect(await page.getByLabel('Profile identifier').evaluate((e: HTMLInputElement) => e.checkValidity())).toBe(false);
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: /UI Writer/ }).click();
  await expect(page.getByText('Restored draft · Saved on this device')).toBeVisible();
  await page.getByRole('button', { name: 'Discard draft' }).click(); await page.getByRole('button', {name:'Discard changes',exact:true}).click(); await expect(page.getByLabel('Bot name', { exact: true })).toHaveValue('');
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Researcher', exact: true }).click(); await expect(page.getByLabel('Message Researcher')).toBeVisible();
  await page.getByRole('button', { name: 'Show page details' }).click();
  await expect(page.getByRole('heading', { name: 'Researcher', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit bot', exact: true }).click();
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('Saved without losing a later edit');
  let release!: () => void; const gate = new Promise<void>(resolve => release = resolve);
  await page.route('**/api/v1/plugins/bots/actions', async route => { const response = await route.fetch(); await gate; await route.fulfill({ response }); });
  try {
    await page.getByRole('button', { name: 'Save bot', exact: true }).click();
    await expect(page.getByLabel('Bot name', { exact: true })).toBeDisabled();
    await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
  } finally { release(); }
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit bot', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue('Saved without losing a later edit');
});

test('routines distinguish loading and show readable schedules and formatted results', async ({ page }) => {
  let release!: () => void; const gate = new Promise<void>(resolve => release = resolve);
  await page.route('**/api/v1/plugins/bots/queries/routines', async route => { await gate; await route.continue(); });
  await page.goto('/#/plugins/bots/research/routines');
  try { await expect(page.getByText('Loading routines…', { exact: true })).toBeVisible(); await expect(page.getByRole('heading', { name: 'No routines yet' })).toHaveCount(0); } finally { release(); }
  const routine = page.getByRole('group', { name: 'research briefing', exact: true }); await expect(routine).toBeVisible();
  await expect(routine).toContainText('Every day at 09:00'); await routine.locator('summary').click();
  await routine.getByRole('button', { name: 'Edit routine', exact: true }).click();
  await expect(page.getByLabel('Frequency')).toHaveValue('daily'); await expect(page.getByLabel('Time', { exact: true })).toHaveValue('09:00'); await page.keyboard.press('Escape');
  await page.route('**/api/v1/plugins/bots/queries/result', route => route.fulfill({ json: { text: '# Research summary\n\n**Important**\n\n[Source](https://example.com)\n\n```python\nprint(1)\n```', nextOffset: 1, hasMore: false } }));
  await routine.getByRole('link', { name: 'Results', exact: true }).click(); await page.getByRole('link', { name: /^Read result:/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Research summary' })).toBeVisible();
  await expect(page.locator('.bot-results').getByRole('link', { name: 'Source' })).toHaveAttribute('href', 'https://example.com');
  await expect(page.locator('.bot-results').locator('pre code')).toContainText('print(1)');
  await page.getByRole('link', { name: 'All runs' }).click(); await expect(page.getByRole('link', { name: /^Read result:/ }).first()).toBeVisible();
});

test('action history is bounded outside the chat and invalid links remain navigable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 480 });
  await page.goto('/#/plugins/bots/research'); await expect(page.getByLabel('Message Researcher')).toBeVisible();
  await page.getByRole('button', { name: 'Show page details' }).click(); await page.getByRole('button', { name: 'Recent actions' }).click();
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(e => e.getBoundingClientRect().bottom)).toBeLessThanOrEqual(480);
  await page.keyboard.press('Escape');
  const history = await page.locator('.conversation-scroll').boundingBox(), composer = await page.locator('.composer-wrap').boundingBox();
  expect(history!.y + history!.height).toBeLessThanOrEqual(composer!.y);
  await page.goto('/#/plugins/bots/%ZZ'); await expect(page.getByRole('heading', { name: 'Invalid bot link' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to Bots' }).click(); await expect(page.getByRole('heading', { name: /^Bots/ })).toBeVisible();
});

test('offline bot and routine drafts can be reopened and edited without submitting', async ({ page, context }) => {
  await page.goto('/#/plugins/bots/research'); await expect(page.getByLabel('Message Researcher')).toBeVisible();
  await page.getByRole('button', { name: 'Show page details' }).click(); await page.getByRole('button', { name: 'Edit bot', exact: true }).click();
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('Saved offline editor draft');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await context.setOffline(true);
  try {
    await expect(page.getByText('Offline. Saved messages and drafts remain available.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Edit bot', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue('Saved offline editor draft');
    await page.getByRole('textbox', { name: 'Description', exact: true }).fill('Continued while offline');
    await expect(page.getByRole('button', { name: 'Save bot', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('link', { name: 'Routines', exact: true }).click();
    await page.getByRole('button', { name: 'New routine', exact: true }).click();
    await page.getByLabel('Name', { exact: true }).fill('An offline routine draft');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: /An offline routine draft/ }).click();
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('An offline routine draft');
    await expect(page.getByRole('button', { name: 'Save routine', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
  } finally { await context.setOffline(false); }
});

test('model errors are recoverable and result selection ignores late responses', async ({ page }) => {
  await page.route('**/api/v1/plugins/bots/queries/models', route => route.fulfill({ status: 503, json: { error: 'Models temporarily unavailable' } }));
  await page.goto('/#/plugins/bots'); await page.getByRole('button', { name: 'New bot', exact: true }).click();
  await page.getByText('Model and profile settings', { exact: true }).click();
  await expect(page.getByText('Models temporarily unavailable', { exact: false })).toBeVisible();
  await page.unroute('**/api/v1/plugins/bots/queries/models'); await page.getByRole('button', { name: 'Retry models' }).click();
  await expect(page.getByRole('combobox', { name: 'Model and provider', exact: true }).locator('optgroup').first()).toBeAttached();
  await expect(page.getByText('Models temporarily unavailable', { exact: false })).toHaveCount(0); await page.keyboard.press('Escape');
  await page.route('**/api/v1/plugins/bots/queries/runs', route => route.fulfill({ json: [{ id: 'first', title: 'First run', status: 'finished', at: '2026-01-01T09:00:00Z' }, { id: 'second', title: 'Second run', status: 'finished', at: '2026-01-02T09:00:00Z' }] }));
  let release!: () => void; const gate = new Promise<void>(resolve => release = resolve);
  await page.route('**/api/v1/plugins/bots/queries/result', async route => {
    const first = route.request().postDataJSON().run === 'first';
    if (first) await gate;
    await route.fulfill({ json: { text: first ? 'Stale first result' : 'Current second result', hasMore: false, nextOffset: 1 } });
  });
  try {
    await page.goto('/#/plugins/bots/research/routines'); await page.getByRole('group', { name: 'research briefing', exact: true }).getByRole('link', { name: 'Results', exact: true }).click();
    await page.getByRole('link', { name: /^Read result: First run/ }).click();
    await expect(page.getByText('Loading results…', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'All runs', exact: true }).click();
    await page.getByRole('link', { name: /^Read result: Second run/ }).click();
    await expect(page.getByText('Current second result', { exact: true })).toBeVisible(); release();
    await expect(page.getByText('Stale first result', { exact: true })).toHaveCount(0);
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
});

test('a successful routine save survives cleanup failure, navigation and retry without duplication',async({page,request})=>{
 await page.goto('/#/plugins/bots/research/routines');await page.getByRole('button',{name:'New routine',exact:true}).click();
 const title=`Cleanup recovery ${crypto.randomUUID()}`;await page.getByLabel('Name',{exact:true}).fill(title);await page.getByRole('textbox',{name:'Instructions',exact:true}).fill('Synthetic instructions.');
 await page.evaluate(()=>{const original=IDBObjectStore.prototype.delete;(window as any).restoreDelete=()=>IDBObjectStore.prototype.delete=original;IDBObjectStore.prototype.delete=function(key){if(this.name==='pluginLocal'&&String(key).includes('draft:routine:'))throw new DOMException('Synthetic cleanup failure','UnknownError');return original.call(this,key);};});
 let submissions=0;await page.route('**/api/v1/plugins/bots/actions',async route=>{if(route.request().postDataJSON()?.input?.action==='create')submissions++;await route.continue();});
 await page.getByRole('button',{name:'Save routine',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'Synthetic cleanup failure'})).toBeVisible();await expect(page.getByRole('button',{name:'Save routine',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Close',exact:true}).click();await expect(page.locator('.conversation-drafts .item-row').filter({has:page.getByRole('button',{name:new RegExp(title)})})).not.toContainText('Not applied');await page.getByRole('button',{name:new RegExp(title)}).click();
 await expect(page.getByRole('button',{name:'Finish saved change'})).toBeVisible();await page.evaluate(()=>(window as any).restoreDelete());await page.getByRole('button',{name:'Finish saved change'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 const data=await(await request.post('/api/v1/plugins/bots/queries/routines',{headers,data:{profile:'research'}})).json();expect(data.jobs.filter((j:any)=>j.name===title)).toHaveLength(1);expect(submissions).toBe(1);
});

test('cached editors survive read failures and discard uses the reloaded baseline',async({page,request})=>{
 await page.goto('/#/plugins/bots/research');await page.getByRole('button',{name:'Edit bot',exact:true}).click();await page.getByRole('textbox',{name:'Description',exact:true}).fill('Preserved local work');await page.getByRole('button',{name:'Close',exact:true}).click();
 await page.route('**/api/v1/plugins/bots/queries/describe',route=>route.fulfill({status:503,json:{error:'Synthetic read failure'}}));await page.getByRole('button',{name:'Edit bot',exact:true}).click();await expect(page.getByRole('textbox',{name:'Description',exact:true})).toHaveValue('Preserved local work');await expect(page.getByText(/Showing saved settings/)).toBeVisible();
 await page.unroute('**/api/v1/plugins/bots/queries/describe');await configure(request,{description:'New baseline on Hermes'});await page.getByRole('button',{name:'Reload saved values'}).click();await page.getByRole('button',{name:'Replace draft',exact:true}).click();await expect(page.getByRole('textbox',{name:'Description',exact:true})).toHaveValue('New baseline on Hermes');
 await page.getByRole('textbox',{name:'Description',exact:true}).fill('Discard this part');await page.getByRole('button',{name:'Discard draft',exact:true}).click();await page.getByRole('button',{name:'Keep draft',exact:true}).click();await expect(page.getByRole('textbox',{name:'Description',exact:true})).toHaveValue('Discard this part');
 await page.getByRole('button',{name:'Discard draft',exact:true}).click();await page.getByRole('button',{name:'Discard changes',exact:true}).click();await expect(page.getByRole('textbox',{name:'Description',exact:true})).toHaveValue('New baseline on Hermes');
});

test('stale routine edits require review before replacing another device’s values',async({page,request})=>{
 await page.goto('/#/plugins/bots/research/routines');const row=page.getByRole('group',{name:'research briefing',exact:true});await row.getByRole('button',{name:'Edit routine',exact:true}).click();await page.getByLabel('Name',{exact:true}).fill('Local title change');
 const data=await(await request.post('/api/v1/plugins/bots/queries/routines',{headers,data:{profile:'research'}})).json(),original=data.jobs.find((j:any)=>j.id==='daily');
 try { await action(request,'routine',{action:'update',profile:'research',id:'daily',name:original.name,prompt:'New remote instructions',schedule:'0 15 * * *',deliver:'local',expectedRevision:original.revision});
 await page.getByRole('button',{name:'Save routine',exact:true}).click();await expect(page.getByRole('alert')).toContainText('changed in Hermes');await page.getByRole('button',{name:'Review current routine'}).click();await expect(page.getByText('New remote instructions',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Use current values'}).click();
 await expect(page.getByRole('textbox',{name:'Instructions',exact:true})).toHaveValue('New remote instructions');await expect(page.getByLabel('Time',{exact:true})).toHaveValue('15:00');await expect(page.getByRole('combobox',{name:'Results',exact:true})).toHaveValue('local');
 } finally { // Restore the shared fixture for later tests, using its current revision.
 const current=(await(await request.post('/api/v1/plugins/bots/queries/routines',{headers,data:{profile:'research'}})).json()).jobs.find((j:any)=>j.id==='daily');await action(request,'routine',{action:'update',profile:'research',id:'daily',name:original.name,prompt:original.prompt,schedule:original.schedule,deliver:original.deliver,expectedRevision:current.revision});}
});

test('loaded result pages and navigation survive offline, reload and late reads',async({page,context})=>{
 await page.route('**/api/v1/plugins/bots/queries/result',route=>{const offset=route.request().postDataJSON().offset||0;return route.fulfill({json:{text:offset?'Second saved page':'First saved page',hasMore:!offset,nextOffset:offset+200}});});
 await page.goto('/#/plugins/bots/research/routines/daily/results/run-1');await expect(page.getByText('First saved page',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Load more result'}).click();await expect(page.getByText('Second saved page',{exact:true})).toBeVisible();
 await context.setOffline(true);await expect(page.getByText('Second saved page',{exact:true})).toBeVisible();await page.reload();await expect(page.getByText('Second saved page',{exact:true})).toBeVisible();await context.setOffline(false);await expect(page.getByText('Second saved page',{exact:true})).toBeVisible();await page.getByRole('link',{name:'All runs',exact:true}).click();await page.goBack();await expect(page.getByText('Second saved page',{exact:true})).toBeVisible();
});

test('unknown saves stay locked across navigation until status and current values are reviewed',async({page})=>{
 await page.goto('/#/plugins/bots/research/routines');await page.getByRole('button',{name:'New routine',exact:true}).click();const title='Unconfirmed synthetic draft';await page.getByLabel('Name',{exact:true}).fill(title);await page.getByRole('textbox',{name:'Instructions',exact:true}).fill('Synthetic routine.');let id='',submissions=0;
 await page.route('**/api/v1/plugins/bots/actions',route=>{id=route.request().postDataJSON().id;submissions++;return route.abort('failed');});
 await page.route('**/api/v1/plugins/bots/actions/*',route=>route.fulfill({json:{id,pluginId:'bots',command:'routine',state:'unknown',createdAt:Date.now(),error:'Synthetic unknown save'}}));
 await page.getByRole('button',{name:'Save routine',exact:true}).click();await expect(page.getByRole('button',{name:'Save routine',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:new RegExp(title)}).click();await expect(page.getByRole('button',{name:'Save routine',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Check save status'}).click();await page.getByRole('button',{name:'Review current values'}).click();await expect(page.getByText('No matching routine is currently listed in Hermes.')).toBeVisible();expect(submissions).toBe(1);
});

test('swipes use the shared gesture and preliminary hide reads lock the action',async({page})=>{
 await page.goto('/#/plugins/bots');const row=page.locator('.conversation-item').filter({has:page.getByRole('link',{name:'Researcher',exact:true})});await expect(row).toBeVisible();await expect(row.getByRole('button',{name:/Actions for/})).toHaveCount(0);
 let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);let reads=0;await page.route('**/api/v1/plugins/bots/queries/describe',async route=>{reads++;await gate;await route.continue();});
 const box=(await row.boundingBox())!;try{await page.mouse.move(box.x+box.width*.8,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width*.3,box.y+box.height/2,{steps:10});await page.mouse.up();await expect(row).toHaveAttribute('aria-busy','true');await expect(row.getByRole('button',{name:'Hide Researcher',exact:true})).toBeDisabled();expect(reads).toBe(1);}finally{release();}
 await expect(page.getByRole('link',{name:'Researcher',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Undo hide'}).click();await expect(page.getByRole('link',{name:'Researcher',exact:true})).toBeVisible();
});

test.describe('right-swipe editing',()=>{
test.use({serviceWorkers:'block'});
for(const width of [320,1280])test(`right swipe opens the correct bot editor once and preserves its draft at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:844});await page.goto('/#/plugins/bots');
 const row=page.locator('.conversation-item').filter({has:page.getByRole('link',{name:'Researcher',exact:true})});await expect(row.getByRole('button',{name:'Hide Researcher',exact:true})).toBeEnabled();
 let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);let reads=0,writes=0;
 await page.route('**/api/v1/plugins/bots/queries/describe',async route=>{reads++;await gate;await route.continue();});
 await page.route('**/api/v1/plugins/bots/actions',route=>{writes++;return route.continue();});
 async function drag(dx:number,cancel=false){
  const content=row.locator('.conversation-item-content');
  // A new gesture starts after the cancelled row has returned. Start in the
  // padding so consecutive mouse gestures cannot drag selected avatar text.
  await expect.poll(()=>content.evaluate(node=>new DOMMatrix(getComputedStyle(node).transform).m41)).toBe(0);
  await row.evaluate(node=>node.scrollIntoView({block:'center',behavior:'instant'}));
  const box=(await row.boundingBox())!,x=box.x+8,y=box.y+box.height/2;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y,{steps:10});
  if(await row.getAttribute('aria-busy')!=='true')await expect.poll(()=>content.evaluate(node=>new DOMMatrix(getComputedStyle(node).transform).m41)).toBe(dx);
  if(cancel)await row.dispatchEvent('pointercancel',{pointerId:1});await page.mouse.up();
 }
 try{
  await drag(35);await drag(130,true);expect(reads).toBe(0);await expect(page.getByRole('dialog')).toHaveCount(0);
  await drag(130);await expect(row).toHaveAttribute('aria-busy','true');await expect.poll(()=>reads).toBe(1);await drag(130);expect(reads).toBe(1);
 }finally{release();}
 await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByLabel('Bot name',{exact:true})).toHaveValue('Researcher');await expect(page).toHaveURL(/#\/plugins\/bots$/);
 await page.getByLabel('Bot name',{exact:true}).fill('Unsent swipe edit');await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 await expect(row).toHaveAttribute('aria-busy','false');await drag(130);await expect(page.getByLabel('Bot name',{exact:true})).toHaveValue('Unsent swipe edit');expect(writes).toBe(0);
});
});

test('short forms keep submission errors visible and focused above the footer',async({page})=>{
 await page.setViewportSize({width:320,height:480});await page.goto('/#/plugins/bots/research/routines');await page.getByRole('button',{name:'New routine',exact:true}).click();await page.getByLabel('Name',{exact:true}).fill('Rejected routine');await page.getByRole('textbox',{name:'Instructions',exact:true}).fill('Synthetic instructions.');
 await page.route('**/api/v1/plugins/bots/actions',route=>route.fulfill({json:{id:route.request().postDataJSON().id,pluginId:'bots',command:'routine',state:'failed',createdAt:Date.now(),error:'Synthetic save failure. Keep these instructions and retry.'}}));
 await page.getByRole('button',{name:'Save routine',exact:true}).click();const error=page.locator('.form-dialog-footer [role="alert"]');await expect(error).toBeFocused();const box=(await error.boundingBox())!;expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(480);await expect(page.getByRole('textbox',{name:'Instructions',exact:true})).toHaveValue('Synthetic instructions.');await page.screenshot({path:'test-results/bots-form-error-320.png'});
});

test('routine drafts from an older app cannot borrow a newer revision silently',async({page})=>{
 await page.goto('/#/plugins/bots/research/routines');await expect(page.getByRole('group',{name:'research briefing',exact:true})).toBeVisible();
 await page.evaluate(async()=>{const sdk=(globalThis as any).__HERTS_PLUGIN_RUNTIME__.sdk;await sdk.pluginLocal('bots').drafts.put({id:'routine:research:daily',fields:{name:'Old saved title',prompt:'Old saved instructions',frequency:'daily',time:'09:00',deliver:'bot-chat'}});});
 await page.getByRole('button',{name:/Old saved title/}).click();await page.getByRole('button',{name:'Save routine',exact:true}).click();await expect(page.getByRole('alert')).toContainText('older draft');await expect(page.getByRole('textbox',{name:'Instructions',exact:true})).toHaveValue('Old saved instructions');await page.getByRole('button',{name:'Review current routine'}).click();await page.getByRole('button',{name:'Use current values'}).click();await expect(page.getByRole('textbox',{name:'Instructions',exact:true})).toHaveValue('Write a short briefing.');
});

test('visibility recovery shows the actual bot state and never repeats Hide',async({page})=>{
 await page.goto('/#/plugins/bots');let submissions=0;
 await page.route('**/api/v1/plugins/bots/actions',async route=>{const body=route.request().postDataJSON();if(body.command!=='configure')return route.continue();submissions++;await route.fetch();await route.fulfill({json:{id:body.id,pluginId:'bots',command:'configure',state:'unknown',createdAt:Date.now(),subject:{profile:'research',operation:'hide'}}});});
 const hide=page.getByRole('button',{name:'Hide Researcher',exact:true});await expect(hide).toBeEnabled();await hide.focus();await hide.press('Enter');await expect(page.getByRole('link',{name:'Researcher',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Review current values'}).click();await expect(page.getByText('Researcher: Hidden in the shared roster.',{exact:true})).toBeVisible();expect(submissions).toBe(1);
});

test('reviewing an uncertain routine run includes current settings and recent run evidence',async({page})=>{
 await page.route('**/api/v1/plugins/bots/actions?*',route=>route.fulfill({json:[{id:'synthetic-unknown-run',pluginId:'bots',command:'routine',state:'unknown',createdAt:Date.now(),subject:{profile:'research',routineId:'daily',title:'Research briefing',operation:'run'}}]}));
 await page.goto('/#/plugins/bots/research/routines');await page.getByRole('button',{name:'Recent actions'}).click();await page.getByRole('button',{name:'Review action',exact:true}).click();const current=page.locator('.reviewed-values');await expect(current).toContainText('Write a short briefing.');await expect(current).toContainText('Recent recorded runs:');await expect(current).toContainText('A useful briefing.');await expect(page.getByRole('link',{name:'Inspect routine',exact:true})).toHaveAttribute('href','#/plugins/bots/research/routines/daily');await expect(page.getByRole('button',{name:'Mark reviewed',exact:true})).toBeDisabled();
});
