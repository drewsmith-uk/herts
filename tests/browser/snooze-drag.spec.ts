import { detailsField, detailsControl } from './composer-helpers';
import { test, expect, type APIRequestContext, type Page, type Locator } from '@playwright/test';
const headers={'x-tasks-request':'1'};
const snapshot=async(request:APIRequestContext)=>(await(await request.get('/api/v1/state')).json()).snapshot;
const agentCalls=async(request:APIRequestContext)=>(await(await request.get('http://127.0.0.1:8791/calls')).json() as string[]).filter(m=>['session.create','session.resume','prompt.submit','session.interrupt'].includes(m));
async function seed(request:APIRequestContext,name:string,count=3){
  const spaceId=crypto.randomUUID(),ids:string[]=[];
  expect((await request.post('/api/v1/spaces/sync',{headers,data:{id:crypto.randomUUID(),spaceId,kind:'create',name:`${name} ${spaceId}`,at:Date.now()}})).ok()).toBe(true);
  for(let i=0;i<count;i++){const taskId=crypto.randomUUID();ids.unshift(taskId);await request.post('/api/v1/sync',{headers,data:{id:crypto.randomUUID(),taskId,spaceId,kind:'create',title:`${name} ${i+1}`,at:Date.now()}});}
  return {spaceId,ids,path:`/#/spaces/${spaceId}/inbox`};
}
const row=(page:Page,id:string)=>page.locator(`[data-task-id="${id}"]`);
async function chooseTime(page:Page,at:number){const value=await page.evaluate(at=>{const d=new Date(at),pad=(v:number)=>String(v).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;},at);await page.getByLabel('Reminder date and time',{exact:true}).fill(value);return Math.floor(at/60000)*60000;}
async function mouseDrag(page:Page,source:Locator,destination:Locator,hold=true){
  await source.scrollIntoViewIfNeeded();await source.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));const from=(await source.boundingBox())!,to=(await destination.boundingBox())!;
  await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();if(hold){await page.waitForTimeout(550);await expect(page.locator('.task-drag-overlay')).toBeVisible();}
  await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:8});await page.mouse.up();
}

test('phone snooze, change time, unsnooze and due reminders persist across devices without Hermes work',async({page,request,browser})=>{
  await page.setViewportSize({width:390,height:844});const before=await agentCalls(request),{spaceId,ids,path}=await seed(request,'Snooze work');await page.goto(path);
  await row(page,ids[1]).getByRole('link').click();await (await detailsControl(page, 'button', 'Snooze')).click();await expect(page.getByRole('dialog')).toBeVisible();
  const at=await chooseTime(page,Date.now()+3600_000);await page.getByRole('dialog').getByRole('button',{name:'Snooze',exact:true}).click();await expect((await detailsField(page, 'Task list'))).toHaveValue('snoozed');await expect(page.locator('.save-state')).toContainText('Changes synced');
  await page.goto(path);await expect(row(page,ids[1])).toHaveCount(0);await page.locator('.mobile-lists [data-drop-list="snoozed"]').click();await expect(row(page,ids[1])).toBeVisible();await expect(page.locator('.drag-handle')).toHaveCount(0);
  const second=await browser.newContext({viewport:{width:1280,height:844}}),other=await second.newPage();
  try{
    await other.goto(`/#/task/${ids[1]}`);await expect((await detailsField(other, 'Task list'))).toHaveValue('snoozed');await other.getByRole('button',{name:'Change reminder',exact:true}).click();const later=await chooseTime(other,at+3600_000);await other.getByRole('button',{name:'Save reminder',exact:true}).click();await expect.poll(async()=>(await snapshot(request)).tasks.find((t:any)=>t.id===ids[1]).snoozedUntil).toBe(later);await expect(other.locator('.save-state')).toContainText('Changes synced');
    expect((await request.post('/__test/wake-snoozed',{headers,data:{at}})).ok()).toBe(true);expect((await snapshot(request)).tasks.find((t:any)=>t.id===ids[1]).status).toBe('snoozed');
    await other.getByRole('button',{name:'Unsnooze',exact:true}).click();await expect((await detailsField(other, 'Task list'))).toHaveValue('inbox');await (await detailsControl(other, 'button', 'Snooze')).click();await chooseTime(other,later);await other.getByRole('dialog').getByRole('button',{name:'Snooze',exact:true}).click();await expect.poll(async()=>(await snapshot(request)).tasks.find((t:any)=>t.id===ids[1]).snoozedUntil).toBe(later);await expect(other.locator('.save-state')).toContainText('Changes synced');await other.close();
    const result=await(await request.post('/__test/wake-snoozed',{headers,data:{at:later}})).json();const notice=result.notices.find((n:any)=>n.task_id===ids[1]);expect(notice).toBeTruthy();
    await expect(row(page,ids[1])).toHaveCount(0);await page.goto(path);await expect(page.locator('.task-item').first()).toHaveAttribute('data-task-id',ids[1]);
    await page.goto(`/?notice=${encodeURIComponent(notice.id)}`);await expect(page).toHaveURL(new RegExp(`#/task/${ids[1]}$`));await expect((await detailsField(page, 'Task space'))).toHaveValue(spaceId);await expect((await detailsField(page, 'Task list'))).toHaveValue('inbox');
    expect(await agentCalls(request)).toEqual(before);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }finally{await second.close();}
});

test('offline snooze survives reload; a lost receipt and a conflicting device cannot silently reschedule it',async({page,context,browser,request})=>{
  const {ids,path}=await seed(request,'Offline snooze');await page.goto(path);await row(page,ids[0]).getByRole('link').click();const url=page.url();await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await expect(page.locator('.save-state')).toContainText('Changes synced');
  await context.setOffline(true);await (await detailsControl(page, 'button', 'Snooze')).click();await expect(page.getByText('The reminder will be scheduled when this change syncs.',{exact:false})).toBeVisible();const at=await chooseTime(page,Date.now()+7200_000);await page.getByRole('dialog').getByRole('button',{name:'Snooze',exact:true}).click();
  // The dialog closes after the device save completes. Reloading on click can
  // unload the page while that IndexedDB transaction is still in progress.
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect((await detailsField(page, 'Task list'))).toHaveValue('snoozed');
  await page.reload();await expect((await detailsField(page, 'Task list'))).toHaveValue('snoozed');
  let dropping=false,dropped=false;await page.route('**/api/v1/plugins/tasks/commands',async route=>{if(!dropping&&route.request().postDataJSON().input.kind==='snooze'){dropping=true;await route.fetch();await route.abort();dropped=true;}else await route.continue();});
  await context.setOffline(false);await expect.poll(()=>dropped).toBe(true);await page.unroute('**/api/v1/plugins/tasks/commands');await page.reload();await expect(page.locator('.save-state')).toContainText('Changes synced');
  const second=await browser.newContext(),other=await second.newPage();
  try{
    await other.goto(url);await expect((await detailsField(other, 'Task list'))).toHaveValue('snoozed');await expect(other.locator('.save-state')).toContainText('Changes synced');await second.setOffline(true);
    await other.getByRole('button',{name:'Change reminder',exact:true}).click();await chooseTime(other,at+3600_000);await other.getByRole('button',{name:'Save reminder',exact:true}).click();
    await (await detailsControl(page, 'button', 'Change reminder')).click();await chooseTime(page,at+7200_000);await page.getByRole('button',{name:'Save reminder',exact:true}).click();await expect(page.locator('.save-state')).toContainText('Changes synced');
    await second.setOffline(false);await expect(other.getByText('The reminder changed on another device.',{exact:true})).toBeVisible();await expect(other.getByText('Your change: Snooze until',{exact:false})).toBeVisible();await other.getByRole('button',{name:'Use synced version',exact:true}).click();await expect(other.locator('.save-state')).toContainText('Changes synced');
    expect((await snapshot(request)).tasks.find((t:any)=>t.id===ids[0]).snoozedUntil).toBe(at+7200_000);
  }finally{await second.close();}
});

test('mouse dragging requires holding, keeps taps usable, and drops into list tabs or the sidebar',async({page,request})=>{
  await page.setViewportSize({width:1280,height:844});const {spaceId,ids,path}=await seed(request,'Hold mouse');await page.goto(path);
  await expect(page.locator('.drag-handle')).toHaveCount(0);await mouseDrag(page,row(page,ids[0]),row(page,ids[2]),false);await expect(page.locator('.task-item').first()).toHaveAttribute('data-task-id',ids[0]);await expect(page.getByRole('dialog')).toHaveCount(0);
  await mouseDrag(page,row(page,ids[0]),row(page,ids[2]));await expect(page.locator('.task-item').last()).toHaveAttribute('data-task-id',ids[0]);await expect(page).toHaveURL(new RegExp(`/spaces/${spaceId}/inbox$`));
  await mouseDrag(page,row(page,ids[0]),page.locator('.mobile-lists [data-drop-list="next"]'));await expect(row(page,ids[0])).toHaveCount(0);
  await mouseDrag(page,row(page,ids[1]),page.locator('.sidebar [data-drop-list="done"]'));await expect(row(page,ids[1])).toHaveCount(0);
  await page.locator('.mobile-lists [data-drop-list="done"]').click();await mouseDrag(page,row(page,ids[1]),page.locator('.mobile-lists [data-drop-list="inbox"]'));await expect(row(page,ids[1])).toHaveCount(0);await page.goto(path);await expect(page.locator('.task-item').first()).toHaveAttribute('data-task-id',ids[1]);
  await mouseDrag(page,row(page,ids[2]),page.locator('.mobile-lists [data-drop-list="snoozed"]'));await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(row(page,ids[2])).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.task-drag-overlay')).toHaveCount(0);
  await row(page,ids[2]).focus();await expect(row(page,ids[2])).toBeFocused();
  await page.keyboard.press('Space');await expect(page.locator('.task-drag-overlay')).toBeVisible();
  // dnd-kit renders the overlay before its deferred keydown listener is attached.
  // Drain that timer before sending the single Escape that must cancel the drag.
  await page.evaluate(()=>new Promise<void>(resolve=>setTimeout(resolve,0)));
  await page.keyboard.press('Escape');await expect(page.locator('.task-drag-overlay')).toHaveCount(0);
  await row(page,ids[2]).getByRole('link').click();await expect((await detailsField(page, 'Task title'))).toHaveValue('Hold mouse 1');
  const s=await snapshot(request);expect(s.tasks.find((t:any)=>t.id===ids[0]).status).toBe('next');expect(s.tasks.find((t:any)=>t.id===ids[1])).toMatchObject({status:'inbox',completedAt:null});
});

test('reading items also require a hold to reorder and keep their ordinary links and controls',async({page,request})=>{
  const ids:string[]=[];
  for(const title of ['Hold reading A','Hold reading B']){const itemId=crypto.randomUUID();ids.unshift(itemId);await request.post('/api/v1/reading/sync',{headers,data:{id:crypto.randomUUID(),itemId,contextId:crypto.randomUUID(),kind:'create',url:`https://example.com/${itemId}`,title,at:Date.now()}});}
  await page.goto('/#/reading');await expect(page.locator('.reading-row .drag-handle')).toHaveCount(0);const first=page.locator('.reading-row').filter({hasText:'Hold reading B'}),second=page.locator('.reading-row').filter({hasText:'Hold reading A'});
  await first.scrollIntoViewIfNeeded();const from=(await first.boundingBox())!,to=(await second.boundingBox())!;
  await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:8});await page.mouse.up();await expect(page.locator('.reading-row .task-title').first()).toHaveText('Hold reading B');
  await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.waitForTimeout(550);await expect(first).toHaveClass(/dragging/);await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:8});await page.mouse.up();await expect(page.locator('.reading-row .task-title').first()).toHaveText('Hold reading A');await expect(page.locator('.save-state')).toContainText('Changes synced');
  expect((await snapshot(request)).reading.unread.ids.slice(0,2)).toEqual([ids[1],ids[0]]);await second.getByRole('link',{name:'Hold reading A',exact:true}).click();await expect(page).toHaveURL(new RegExp(`#/reading-item/${ids[1]}$`));
});

test('touch swiping opens snooze, scrolling stays native, and a held item can move into another list',async({browser,request})=>{
  const {ids,path}=await seed(request,'Hold touch',12),before=await agentCalls(request);const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  try{
    const page=await context.newPage();await page.goto(path);const cdp=await context.newCDPSession(page);
    async function touch(source:Locator,dx:number,dy=0,hold=false,cancel=false){await source.scrollIntoViewIfNeeded();if(!hold)await source.evaluate(node=>node.scrollIntoView({block:'center',behavior:'instant'}));await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));const b=(await source.boundingBox())!,x=b.x+b.width/2,y=b.y+b.height/2;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});if(hold){await page.waitForTimeout(550);await expect(page.locator('.task-drag-overlay')).toBeVisible();}for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/8,y:y+dy*i/8}]});await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});}
    await touch(row(page,ids[0]),30);await expect(page.getByRole('dialog')).toHaveCount(0);
    await touch(row(page,ids[0]),-130,0,false,true);await expect(page.getByRole('dialog')).toHaveCount(0);
    const start=await page.evaluate(()=>scrollY);await touch(row(page,ids[0]),0,-140);await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(start);await expect(page.locator('.task-drag-overlay')).toHaveCount(0);
    await touch(row(page,ids[0]),-130);await expect(page.getByRole('dialog')).toBeVisible();await page.screenshot({path:'test-results/snooze-picker-phone.png'});await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await touch(row(page,ids[0]),130);await chooseTime(page,Date.now()+3600_000);await page.getByRole('dialog').getByRole('button',{name:'Snooze',exact:true}).click();await expect(row(page,ids[0])).toHaveCount(0);
    await page.evaluate(()=>scrollTo(0,0));await row(page,ids[1]).scrollIntoViewIfNeeded();const from=(await row(page,ids[1]).boundingBox())!,target=(await page.locator('.mobile-lists [data-drop-list="waiting"]').boundingBox())!;
    await touch(row(page,ids[1]),target.x+target.width/2-(from.x+from.width/2),target.y+target.height/2-(from.y+from.height/2),true);await expect(row(page,ids[1])).toHaveCount(0);await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await snapshot(request)).tasks.find((t:any)=>t.id===ids[1]).status).toBe('waiting');expect(await agentCalls(request)).toEqual(before);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/hold-drag-phone.png'});
  }finally{await context.close();}
});
