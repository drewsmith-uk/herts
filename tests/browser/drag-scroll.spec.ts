import { test, expect } from '@playwright/test';

for (const width of [390,1280]) test(`list drop targets remain accurate while dragging scrolls the page on ${width}px`,async({page,request})=>{
  await page.setViewportSize({width,height:844});const headers={'x-tasks-request':'1'},spaceId=crypto.randomUUID(),ids:string[]=[];
  await request.post('/api/v1/spaces/sync',{headers,data:{id:crypto.randomUUID(),spaceId,kind:'create',name:`Drag scroll ${width}`,at:Date.now()}});
  for(let i=0;i<18;i++){const taskId=crypto.randomUUID();ids.push(taskId);await request.post('/api/v1/sync',{headers,data:{id:crypto.randomUUID(),taskId,spaceId,kind:'create',title:`Scroll target ${i}`,at:Date.now()}});}
  await page.goto(`/#/spaces/${spaceId}/inbox`);
  const source=page.locator(`[data-task-id="${ids[5]}"]`);await source.scrollIntoViewIfNeeded();const start=await page.evaluate(()=>scrollY);expect(start).toBeGreaterThan(300);
  const box=(await source.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.waitForTimeout(550);await expect(page.locator('.task-drag-overlay')).toBeVisible();
  // Move towards the top and let automatic scrolling change the document
  // position while the list tabs remain pinned beneath the app's top bar.
  await page.mouse.move(box.x+box.width/2,12,{steps:10});await expect.poll(()=>page.evaluate(()=>scrollY)).toBeLessThan(start-150);
  const target=page.locator('.mobile-lists [data-drop-list="waiting"]'),to=(await target.boundingBox())!;
  await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:6});await expect(target).toHaveClass(/task-drop-over/);await page.mouse.up();
  await expect(source).toHaveCount(0);await expect(page.locator('.save-state')).toContainText('Changes synced');
  const snapshot=(await(await request.get('/api/v1/state')).json()).snapshot;expect(snapshot.tasks.find((t:any)=>t.id===ids[5]).status).toBe('waiting');
});
