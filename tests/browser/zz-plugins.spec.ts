import { detailsField, detailsControl } from './composer-helpers';
import {test,expect,type APIRequestContext} from '@playwright/test';
const headers={'x-herts-request':'1'};
const agentWrites=async(request:APIRequestContext)=>(await(await request.get('http://127.0.0.1:8791/calls')).json() as string[]).filter(method=>['session.create','session.resume','config.set','session.cwd.set','prompt.submit','session.interrupt'].includes(method));
async function manage(request:APIRequestContext,id:string,action:string,confirmation?:string){
  const {catalogue}=await(await request.get('/api/v1/plugins')).json();
  const response=await request.post(`/api/v1/plugins/${id}/manage`,{headers,data:{action,confirmation,revision:catalogue.revision}});
  expect(response.ok(),await response.text()).toBe(true);
}
async function restore(request:APIRequestContext){
  await manage(request,'tasks','enable');await manage(request,'reading','enable');
  const {catalogue}=await(await request.get('/api/v1/plugins')).json();
  const order=['tasks','conversations','reading',...catalogue.entries.filter((e:any)=>!['tasks','reading'].includes(e.manifest.id)&&!e.manifest.id.startsWith('invalid-')).map((e:any)=>e.manifest.id)];
  expect((await request.post('/api/v1/plugins/order',{headers,data:{order,revision:catalogue.revision}})).ok()).toBe(true);
}
test('core conversations work with every plugin disabled; Settings controls tabs and ordering',async({page,request})=>{
  await page.setViewportSize({width:390,height:844});
  try{
    await page.goto('/#/settings/plugins');
    await page.getByRole('checkbox',{name:'Enable Tasks',exact:true}).click();
    await expect(page.getByRole('checkbox',{name:'Enable Reading',exact:true})).toBeEnabled();
    await page.getByRole('checkbox',{name:'Enable Reading',exact:true}).click();
    await expect(page.getByRole('navigation',{name:'Main navigation'}).getByRole('link')).toHaveCount(1);
    await page.goto('/');await expect(page.getByRole('heading',{name:'Conversations',exact:true})).toBeVisible();
    await page.goto('/#/conversation/reading-links');await expect(page.getByLabel('Message Hermes')).toBeEnabled();
    await expect(page.getByRole('button',{name:'Make a task',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:/Save to reading list/})).toHaveCount(0);
    await page.getByLabel('Message Hermes').fill('Core survives without plugins.');
    await page.getByRole('button',{name:'Send',exact:true}).click();await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase','complete');
    const beforeNew=await agentWrites(request);
    await page.goto('/#/new');await expect(page.getByLabel('Message Hermes')).toBeEnabled();
    expect(await agentWrites(request)).toEqual(beforeNew);
    await page.getByLabel('Message Hermes').fill('A new core-only conversation.');await page.getByRole('button',{name:'Send',exact:true}).click();await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase','complete');
    await page.goto('/#/settings/plugins');await page.getByRole('checkbox',{name:'Enable Tasks',exact:true}).click();
    await page.getByRole('button',{name:'Move Conversations up',exact:true}).click();
    await page.goto('/');await expect(page.getByRole('heading',{name:'Conversations',exact:true})).toBeVisible();
  }finally{await restore(request);}
});
test('a folder plugin is discovered live and embeds conversation hooks from other plugins',async({page,request})=>{
  try{
    await request.post('/__test/notes',{headers,data:{present:true}});
    await page.goto('/#/settings/plugins');await expect(page.getByRole('checkbox',{name:'Enable Notes'})).not.toBeChecked();
    await page.getByRole('checkbox',{name:'Enable Notes'}).click();
    await page.goto('/#/conversation/reading-links');await page.getByRole('button',{name:'Save as note',exact:true}).click();
    await expect(page).toHaveURL(/#\/plugins\/notes\//);
    await expect(page.getByRole('button',{name:'Make a task',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:/^(Save to reading list|Open reading item): https:\/\/example\.com\/one$/}).first()).toBeVisible();
    await page.getByLabel('Message Hermes').fill('Draft from the example plugin');const url=page.url();
    await request.post('/__test/notes',{headers,data:{present:false}});await expect(page.getByRole('heading',{name:'Plugin unavailable'})).toBeVisible();
    await page.goto('/#/conversation/reading-links');await expect(page.getByLabel('Message Hermes')).toHaveValue('Draft from the example plugin');
    await request.post('/__test/notes',{headers,data:{present:true}});await page.goto('/#/settings/plugins');await expect(page.getByRole('checkbox',{name:'Enable Notes'})).not.toBeChecked();
    await page.getByRole('checkbox',{name:'Enable Notes'}).click();await page.goto(url);await expect(page.getByLabel('Message Hermes')).toHaveValue('Draft from the example plugin');
  }finally{await manage(request,'notes','disable');await restore(request);}
});
test('typed reset removes offline plugin edits without erasing core conversation drafts',async({page,context,browser,request})=>{
  const otherContext=await browser.newContext(),other=await otherContext.newPage();
  try{
    await page.goto('/#/tasks');await page.getByLabel('Message Hermes',{exact:true}).fill('Reset race task');await page.getByRole('button',{name:'Save to Inbox',exact:true}).click();
    await page.getByRole('link',{name:'Reset race task',exact:true}).click();await expect(page.locator('.save-state')).toContainText('Changes synced');
    await page.getByLabel('Message Hermes').fill('Core draft must survive reset');
    await page.evaluate(()=>navigator.serviceWorker.ready);await context.setOffline(true);
    await (await detailsField(page, 'Task title')).fill('Late offline rename');await (await detailsField(page, 'Task title')).press('Tab');
    await other.goto('/#/settings/plugins');const card=other.locator('.plugin-card').filter({has:other.getByRole('checkbox',{name:'Enable Tasks',exact:true})});
    await card.getByRole('button',{name:'Reset data',exact:true}).click();
    await expect(other.getByRole('button',{name:'Permanently reset data',exact:true})).toBeDisabled();
    await other.getByLabel('Confirm plugin name').fill('Tasks');
    // The generation changes before reset finishes reloading the plugin.
    // Wait for its response so cleanup cannot race the catalogue revision.
    const resetResponse=other.waitForResponse(response=>response.url().endsWith('/api/v1/plugins/tasks/manage')&&response.request().method()==='POST');
    await other.getByRole('button',{name:'Permanently reset data',exact:true}).click();
    expect((await resetResponse).ok()).toBe(true);
    await expect.poll(async()=>{const {catalogue}=await(await request.get('/api/v1/plugins')).json();return catalogue.entries.find((e:any)=>e.manifest.id==='tasks').generation;}).toBeGreaterThan(0);
    await context.setOffline(false);await expect(page.locator('.save-state')).toContainText('Changes synced');
    await page.goto('/#/tasks');await expect(page.getByRole('link',{name:'Late offline rename',exact:true})).toHaveCount(0);
    const saved=await page.evaluate(async()=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('hermes-tasks');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});const drafts=await new Promise<any[]>((resolve,reject)=>{const r=db.transaction('drafts').objectStore('drafts').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();return drafts.map(d=>d.text);});
    expect(saved).toContain('Core draft must survive reset');
  }finally{await context.setOffline(false);await otherContext.close();await restore(request);}
});
