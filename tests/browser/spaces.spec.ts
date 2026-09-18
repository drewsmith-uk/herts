import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { originalSpaceId, spacePath } from '../../shared/model';
const spaceTab = (page: Page, id: string) => page.getByRole('navigation', {name:'Task spaces',exact:true}).locator(`[data-drop-space="${id}"]`);
async function state(request: APIRequestContext) { return (await (await request.get('/api/v1/state')).json()).snapshot; }
async function resetDefault(request: APIRequestContext) { const s=await state(request); if(s.defaultSpaceId!==originalSpaceId) await request.post('/api/v1/spaces/sync',{headers:{'x-tasks-request':'1'},data:{id:crypto.randomUUID(),spaceId:originalSpaceId,kind:'default',baseDefaultSpaceId:s.defaultSpaceId,at:Date.now()}}); }
test.afterEach(async ({request})=>resetDefault(request));
async function addSpace(page: Page, name: string) { await page.goto('/#/settings');await page.getByRole('textbox',{name:'New space name',exact:true}).fill(name);await page.getByRole('button',{name:'Create space',exact:true}).click();await expect(page.getByRole('textbox',{name:`Name of ${name} space`,exact:true})).toBeVisible(); }
async function capture(page: Page,title:string) { await page.getByRole('textbox',{name:'New task title',exact:true}).fill(title);await page.getByRole('button',{name:'Add task',exact:true}).click();await expect(page.getByRole('link',{name:title,exact:true})).toBeVisible(); }
async function idFor(page:Page,name:string) { return page.getByRole('combobox',{name:'Default space',exact:true}).locator('option').filter({hasText:name}).getAttribute('value') as Promise<string>; }
const agentCalls=async(request:APIRequestContext)=>(await(await request.get('http://127.0.0.1:8791/calls')).json() as string[]).filter(m=>['session.create','session.resume','prompt.submit','session.interrupt'].includes(m));

test('phone spaces keep captures, ordering and drafts separate; moving Done reopens at the destination top',async({page,request})=>{
  await page.setViewportSize({width:390,height:844});const before=await agentCalls(request);
  await addSpace(page,'Space flow work');const work=await idFor(page,'Space flow work');
  await page.goto('/#/tasks/inbox');await page.getByLabel('New task title',{exact:true}).fill('Personal draft');
  await spaceTab(page,work).click();await expect(page.getByLabel('New task title',{exact:true})).toHaveValue('');
  await capture(page,'Work first');await capture(page,'Work second');
  await page.getByRole('button',{name:'Edit list',exact:true}).click();await page.getByRole('button',{name:'Move Work second down',exact:true}).click();await page.getByRole('button',{name:'Finish editing',exact:true}).click();await expect(page.locator('.task-title').first()).toHaveText('Work first');
  await page.getByLabel('New task title',{exact:true}).fill('Work draft');await spaceTab(page,originalSpaceId).click();await expect(page.getByLabel('New task title',{exact:true})).toHaveValue('Personal draft');
  await capture(page,'Personal existing');await expect(page.getByRole('link',{name:'Work first',exact:true})).toHaveCount(0);
  await spaceTab(page,work).click();await expect(page.getByLabel('New task title',{exact:true})).toHaveValue('Work draft');
  await page.getByRole('link',{name:'Work first',exact:true}).click();const taskUrl=page.url();await page.getByRole('button',{name:'Complete task',exact:true}).click();await expect(page.getByLabel('Task list',{exact:true})).toHaveValue('done');
  await page.getByLabel('Task space',{exact:true}).selectOption(originalSpaceId);await expect(page.getByLabel('Task list',{exact:true})).toHaveValue('inbox');await expect(page).toHaveURL(taskUrl);
  await page.locator('.mobile-nav').getByRole('link',{name:'Tasks',exact:true}).click();await expect(page.locator('.task-title').first()).toHaveText('Work first');
  await spaceTab(page,work).click();await page.goto('/#/reading');await page.locator('.mobile-nav').getByRole('link',{name:'Tasks',exact:true}).click();await expect(spaceTab(page,work)).toHaveAttribute('aria-current','page');
  await page.goto('/#/settings');const row=page.locator('.space-name-form').filter({has:page.getByLabel('Name of Space flow work space',{exact:true})});await row.getByRole('textbox').fill('Space flow family');await row.getByRole('button',{name:'Rename',exact:true}).click();await expect(page.getByLabel('Name of Space flow family space',{exact:true})).toBeVisible();
  await page.goto(`#${spacePath(work)}`);await expect(spaceTab(page,work)).toHaveAttribute('aria-current','page');await expect(page.getByRole('link',{name:'Work second',exact:true})).toBeVisible();
  expect(await agentCalls(request)).toEqual(before);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/phone-spaces.png'});
});

test('conversation conversion uses the default Inbox and a fresh-device voice shortcut does too',async({page,browser,request})=>{
  await page.setViewportSize({width:390,height:844});await addSpace(page,'Default work');const work=await idFor(page,'Default work');await page.getByLabel('Default space',{exact:true}).selectOption(work);await expect(page.locator('.save-state')).toContainText('All changes saved');
  await page.goto('/#/tasks/next');await page.getByLabel('New task title',{exact:true}).fill('Capture stays personal');await page.getByRole('button',{name:'Add task',exact:true}).click();await page.goto('/#/tasks/inbox');await expect(page.getByRole('link',{name:'Capture stays personal',exact:true})).toBeVisible();
  await page.goto('/#/conversations');await page.getByRole('link',{name:/Shared spaces conversation/}).click();await page.getByRole('button',{name:'Make a task',exact:true}).click();await expect(page.locator('.create-from-chat')).toContainText('Default work Inbox');await page.getByRole('button',{name:'Create task',exact:true}).click();await expect(page.getByLabel('Task space',{exact:true})).toHaveValue(work);await expect(page.getByLabel('Task list',{exact:true})).toHaveValue('inbox');
  await page.goto('/#/conversations');await expect(page.getByRole('link',{name:/Shared spaces conversation/})).toHaveCount(0);await page.getByLabel('Show linked conversations').check();await expect(page.getByRole('link',{name:/Shared spaces conversation/})).toBeVisible();
  const fresh=await browser.newContext({viewport:{width:390,height:844}});
  try {const voice=await fresh.newPage();await voice.goto('/#/tasks/inbox/record');await expect(voice.getByRole('button',{name:'Stop recording and transcribe'})).toBeVisible();await expect(spaceTab(voice,work)).toHaveAttribute('aria-current','page');await voice.getByRole('button',{name:'Cancel dictation',exact:true}).click();await voice.reload();await expect(voice.getByRole('button',{name:'Dictate',exact:true})).toBeEnabled();await expect(voice.getByRole('button',{name:'Stop recording and transcribe'})).toHaveCount(0);}finally{await fresh.close();}
  const s=await state(request);expect(s.tasks.find((t:any)=>t.title==='Capture stays personal').spaceId).toBe(originalSpaceId);
});

test('offline-created spaces and tasks survive reload and sync in dependency order',async({page,context,request})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/#/settings');await expect(page.locator('.save-state')).toContainText('All changes saved');await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();
  await context.setOffline(true);await page.getByLabel('New space name',{exact:true}).fill('Offline work');await page.getByRole('button',{name:'Create space',exact:true}).click();const work=await idFor(page,'Offline work');await page.getByLabel('Default space',{exact:true}).selectOption(work);
  await page.goto(`#${spacePath(work)}`);await capture(page,'Saved in offline space');await page.reload();await expect(page.getByRole('link',{name:'Saved in offline space',exact:true})).toBeVisible();
  await context.setOffline(false);await expect(page.locator('.save-state')).toContainText('All changes saved');const s=await state(request);expect(s.defaultSpaceId).toBe(work);expect(s.tasks.find((t:any)=>t.title==='Saved in offline space').spaceId).toBe(work);
});

test('a duplicate offline space can be renamed without losing its pending tasks',async({page,context,request})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/#/settings');await expect(page.locator('.save-state')).toContainText('All changes saved');await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await context.setOffline(true);
  await page.getByLabel('New space name',{exact:true}).fill('Concurrent space');await page.getByRole('button',{name:'Create space',exact:true}).click();const local=await idFor(page,'Concurrent space');await page.goto(`#${spacePath(local)}`);await capture(page,'Keep this pending task');
  await request.post('/api/v1/spaces/sync',{headers:{'x-tasks-request':'1'},data:{id:crypto.randomUUID(),spaceId:crypto.randomUUID(),kind:'create',name:'Concurrent space',at:Date.now()}});
  await context.setOffline(false);await expect(page.getByText('A space change needs your choice',{exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Keep this pending task',exact:true})).toBeVisible();await page.getByLabel('Resolve space name',{exact:true}).fill('Concurrent space recovered');await page.getByRole('button',{name:'Retry with this name',exact:true}).click();await expect(page.locator('.save-state')).toContainText('All changes saved');
  const s=await state(request);expect(s.spaces.find((v:any)=>v.id===local).name).toBe('Concurrent space recovered');expect(s.tasks.find((t:any)=>t.title==='Keep this pending task').spaceId).toBe(local);
});

test('cross-device moves conflict instead of pulling a task back silently',async({page,context,browser,request})=>{
  await page.setViewportSize({width:390,height:844});await addSpace(page,'Concurrent move work');const work=await idFor(page,'Concurrent move work');await page.goto('/#/tasks/inbox');await capture(page,'Concurrent move task');await expect(page.locator('.save-state')).toContainText('All changes saved');await page.getByRole('link',{name:'Concurrent move task',exact:true}).click();const url=page.url();
  const second=await browser.newContext();const other=await second.newPage();
  try{await other.goto(url);await expect(other.getByLabel('Task space',{exact:true})).toHaveValue(originalSpaceId);await expect(other.locator('.save-state')).toContainText('All changes saved');await second.setOffline(true);await other.getByLabel('Task list',{exact:true}).selectOption('waiting');await page.getByLabel('Task space',{exact:true}).selectOption(work);await expect(page.locator('.save-state')).toContainText('All changes saved');await second.setOffline(false);await expect(other.getByText('A change needs your choice',{exact:true})).toBeVisible();await other.getByRole('button',{name:'Use synced version',exact:true}).click();await expect(other.getByLabel('Task space',{exact:true})).toHaveValue(work);await expect(other.getByLabel('Task list',{exact:true})).toHaveValue('inbox');}finally{await second.close();await context.setOffline(false);}
});

test('version-two device migration retains capture audio, context drafts and exact pending payloads',async({page,request})=>{
  const snapshot=await state(request);delete snapshot.spaces;delete snapshot.spaceLists;delete snapshot.defaultSpaceId;
  snapshot.tasks=snapshot.tasks.filter((t:any)=>t.spaceId===originalSpaceId).map(({spaceId,...t}:any)=>t);
  const pending={id:crypto.randomUUID(),taskId:crypto.randomUUID(),kind:'create',title:'Legacy offline task',at:Date.now()};
  await page.route('**/migration-seed',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Migration fixture</title>'}));
  await page.goto('/migration-seed');
  await page.evaluate(async({snapshot,pending})=>{
    const database=await new Promise<IDBDatabase>((resolve,reject)=>{const open=indexedDB.open('hermes-tasks',20);open.onerror=()=>reject(open.error);open.onupgradeneeded=()=>{
      const db=open.result;db.createObjectStore('kv',{keyPath:'key'});const tasks=db.createObjectStore('pending',{keyPath:'id'});tasks.createIndex('order','order');tasks.createIndex('op.taskId','op.taskId');
      for(const store of ['drafts','files','submissions'])db.createObjectStore(store,{keyPath:'id'});
      db.createObjectStore('recordings',{keyPath:'id'}).createIndex('owner','owner');db.createObjectStore('articles',{keyPath:'itemId'});db.createObjectStore('readingPending',{keyPath:'op.id'}).createIndex('order','order');
    };open.onsuccess=()=>resolve(open.result);});
    await new Promise<void>((resolve,reject)=>{const tx=database.transaction([...database.objectStoreNames],'readwrite');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
      tx.objectStore('kv').put({key:'state',value:{snapshot,actions:[]}});
      tx.objectStore('kv').put({key:'link-intent:legacy-chat',value:{id:'legacy-intent',taskId:pending.taskId,title:'Legacy link',at:1}});
      tx.objectStore('pending').put({id:pending.id,op:pending,order:1});
      tx.objectStore('drafts').put({id:'capture',text:'Saved before Spaces',files:[]});tx.objectStore('drafts').put({id:'context-draft',text:'Conversation draft retained',files:['attachment']});
      tx.objectStore('files').put({id:'attachment',name:'note.txt',type:'text/plain',blob:new Blob(['Saved attachment'])});
      tx.objectStore('recordings').put({id:'legacy-audio',owner:'capture',chunks:[new Blob(['saved audio'],{type:'audio/webm'})],type:'audio/webm',at:1,complete:true});
      tx.objectStore('submissions').put({id:'legacy-submission',input:{id:'legacy-submission',taskId:pending.taskId,kind:'send',text:'Saved submitted text'},at:1,confirmed:false});
    });database.close();
  },{snapshot,pending});
  await page.route('**/api/v1/**',route=>route.abort());await page.goto('/#/tasks/inbox');
  await expect(page.getByLabel('New task title',{exact:true})).toHaveValue('Saved before Spaces');await expect(page.getByRole('button',{name:'Transcribe saved recording',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Legacy offline task',exact:true})).toBeVisible();
  const saved=await page.evaluate(async()=>{const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('hermes-tasks');r.onsuccess=()=>resolve(r.result);});const rows:Record<string,any>={version:db.version};for(const name of ['kv','pending','drafts','recordings','submissions','files'])rows[name]=await new Promise(resolve=>{const r=db.transaction(name).objectStore(name).getAll();r.onsuccess=()=>resolve(r.result);});rows.audio=await rows.recordings[0].chunks[0].text();rows.file=await rows.files[0].blob.text();db.close();return rows;});
  expect(saved.version).toBe(30);expect(saved.pending[0].op).toEqual(pending);expect(saved.drafts.find((d:any)=>d.id==='capture')).toBeUndefined();expect(saved.recordings[0].owner).toBe(`capture:${originalSpaceId}`);expect(saved.audio).toBe('saved audio');expect(saved.file).toBe('Saved attachment');expect(saved.drafts.find((d:any)=>d.id==='context-draft').files).toEqual(['attachment']);expect(saved.submissions[0].input.text).toBe('Saved submitted text');expect(saved.kv.find((r:any)=>r.key==='link-intent:legacy-chat').value.spaceId).toBeUndefined();expect(saved.kv.find((r:any)=>r.key==='state').value.snapshot.spaces[0].id).toBe(originalSpaceId);
});

test('an unconfirmed conversion keeps and displays its saved destination after the default changes',async({page,request})=>{
  await addSpace(page,'Pinned destination');const work=await idFor(page,'Pinned destination');await page.getByLabel('Default space',{exact:true}).selectOption(work);await expect(page.locator('.save-state')).toContainText('All changes saved');
  await page.goto('/#/conversations');await page.getByRole('link',{name:/Space retry conversation/}).click();await page.getByRole('button',{name:'Make a task',exact:true}).click();
  const payloads:any[]=[];await page.route('**/api/v1/conversations/spaces-retry/task',route=>{payloads.push(route.request().postDataJSON());return payloads.length===1?route.abort():route.continue();});
  await page.getByRole('button',{name:'Create task',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Connection lost');await resetDefault(request);await page.reload();await expect(page.locator('.save-state')).toContainText('All changes saved');await page.getByRole('button',{name:'Make a task',exact:true}).click();await expect(page.locator('.create-from-chat')).toContainText('Pinned destination Inbox');await page.getByRole('button',{name:'Create task',exact:true}).click();await expect(page.getByLabel('Task space',{exact:true})).toHaveValue(work);expect(payloads).toHaveLength(2);expect(payloads[1]).toEqual(payloads[0]);
});
