import { test, expect } from '@playwright/test';

test('one Send prepares a busy conversation and accepted work survives closing the page',async({page,context,request})=>{
  const before=await (await request.get('http://127.0.0.1:8791/calls')).json();
  await page.goto('/#/conversations'); await page.getByRole('link',{name:/Interrupted conversation/}).click();
  await page.getByLabel('Message Hermes').fill('Change direction and use this new instruction.');
  await expect(page.getByRole('button',{name:'Continue',exact:true})).toHaveCount(0);
  const viewed=await (await request.get('http://127.0.0.1:8791/calls')).json();
  expect(viewed.slice(before.length).filter((m:string)=>['session.resume','session.create','prompt.submit'].includes(m))).toEqual([]);
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect.poll(async()=>{const state=await (await request.get('/api/v1/state')).json();return state.actions.find((a:any)=>a.text==='Change direction and use this new instruction.')?.receipt;}).toBe('accepted');
  const url=page.url(); await page.close(); const next=await context.newPage(); await next.goto(url);
  await expect(next.locator('.conversation-panel')).toHaveAttribute('data-phase','complete');
  await expect(next.getByText('Your work continued after leaving the app.',{exact:false})).toBeVisible();
  const after=await (await request.get('http://127.0.0.1:8791/calls')).json();
  expect(after.slice(before.length).filter((m:string)=>['session.resume','session.create','prompt.submit'].includes(m))).toEqual(['session.resume','prompt.submit']);
});

test('unconfirmed preparation preserves the unsent message and never resumes on reload',async({page,request})=>{
  await page.goto('/#/conversations'); await page.getByRole('link',{name:/Unavailable conversation/}).click();
  const before=await (await request.get('http://127.0.0.1:8791/calls')).json();
  await page.getByLabel('Message Hermes').fill('Preserve this message if preparation fails.'); await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.locator('.conversation-attention')).toContainText('Your message was not sent');
  await page.reload();
  await page.getByText('Saved message · not sent',{exact:false}).click();
  await expect(page.locator('.saved-message pre')).toHaveText('Preserve this message if preparation fails.');
  const after=await (await request.get('http://127.0.0.1:8791/calls')).json();
  expect(after.slice(before.length).filter((m:string)=>['session.resume','session.create','prompt.submit'].includes(m))).toEqual(['session.resume']);
});

test('a failed run remains visible even when Hermes supplies no error message', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/conversation/existing');
  await page.getByLabel('Message Hermes').fill('Report a failed run');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.conversation-panel')).toHaveAttribute('data-phase', 'error');
  await expect(page.locator('.conversation-status')).toContainText('Conversation failed');
  await expect(page.locator('.conversation-attention')).toContainText('Hermes reported that this run failed.');
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.conversation-status')).toContainText('Conversation failed');
  await page.getByRole('button', { name: 'Conversation failed: view details', exact: true }).click();
  await expect(page.locator('.conversation-attention')).toBeInViewport();
});
