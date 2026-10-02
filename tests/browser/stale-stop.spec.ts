import { test, expect, type APIRequestContext } from '@playwright/test';

const headers={'x-herts-request':'1'};
const workCalls=async(request:APIRequestContext)=>(await(await request.get('http://127.0.0.1:8791/calls')).json() as string[]).filter(method=>['session.create','session.resume','prompt.submit','session.interrupt'].includes(method));

for(const width of [390,1280])test(`Stop retires a missing completed session without duplicate errors at ${width}px`,async({page,request})=>{
  await page.setViewportSize({width,height:844});
  const id=`stale-stop-${width}`;
  const fixture=await(await request.post('/__test/stale-stop',{headers,data:{id}})).json();
  const before=await workCalls(request);
  await page.goto(`/#/conversation/${id}`);
  await expect(page.getByRole('alert').filter({hasText:'session not found'})).toHaveCount(1);
  await page.getByLabel('Message Hermes').fill('My next question');
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase','complete');
  await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0);
  await expect(page.locator('.conversation-attention')).toHaveCount(0);
  await expect(page.getByLabel('Message Hermes')).toHaveValue('My next question');
  await expect(page.getByRole('button',{name:'Send',exact:true})).toBeEnabled();
  expect(await workCalls(request)).toEqual(before);
  // An older client cannot keep creating failed Stop receipts.
  const repeat=await request.post('/api/v1/actions',{headers,data:{id:crypto.randomUUID(),contextId:fixture.contextId,targetId:fixture.mainId,generation:fixture.generation,kind:'stop'}});
  expect(repeat.status()).toBe(409);
  const state=await(await request.get('/api/v1/state')).json();
  expect(state.actions.filter((a:any)=>a.targetId===fixture.mainId&&a.kind==='stop')).toHaveLength(5);
  expect(state.actions.find((a:any)=>a.id===fixture.mainId)).toMatchObject({state:'finished',receipt:'accepted',terminal:'complete'});
  await page.reload();
  await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0);
  await expect(page.getByLabel('Message Hermes')).toHaveValue('My next question');
  expect(await workCalls(request)).toEqual(before);
  await page.getByLabel('Message Hermes').focus(); await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect.poll(async()=>(await workCalls(request)).slice(before.length)).toEqual(['session.resume','prompt.submit']);
  await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase','complete');
  expect((await workCalls(request)).slice(before.length)).toEqual(['session.resume','prompt.submit']);
  await expect(page.locator('.conversation-attention')).toHaveCount(0);
});

test('a missing session with no terminal evidence shows one explanation without claiming it stopped',async({page,request})=>{
  const id='stale-stop-uncertain';
  const fixture=await(await request.post('/__test/stale-stop',{headers,data:{id,completed:false}})).json();
  const before=await workCalls(request);
  await page.goto(`/#/conversation/${id}`);
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0);
  await expect(page.locator('.conversation-attention [role="alert"]')).toHaveCount(1);
  await expect(page.locator('.conversation-attention')).toContainText('The previous Hermes session is no longer available. Check the conversation history');
  await expect(page.getByText('session not found',{exact:true})).toHaveCount(0);
  const state=await(await request.get('/api/v1/state')).json();
  expect(state.actions.find((a:any)=>a.id===fixture.mainId)).toMatchObject({state:'unknown',receipt:'accepted'});
  expect(state.actions.find((a:any)=>a.id===fixture.mainId).terminal).toBeUndefined();
  expect(await workCalls(request)).toEqual(before);
});
