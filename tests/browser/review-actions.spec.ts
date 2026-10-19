import {test,expect} from '@playwright/test';
import {detailsField,saveTitle,closePageActions} from './composer-helpers';

test.describe('rename request handling', () => {
 test.use({ serviceWorkers: 'block' });

test('rename cancels safely and retains failed edits until an explicit retry',async({page})=>{
 await page.goto('/#/conversation/existing');
 await expect(page.locator('.conversation-compact-title')).toHaveText('Plan the autumn trip');
 const original=await page.locator('.conversation-compact-title').innerText();
 await (await detailsField(page,'Conversation title')).fill('Do not save this');
 await expect(page.getByRole('dialog',{name:'Page actions',exact:true})).toBeHidden();
 await expect(page.locator('dialog[open]')).toHaveCount(1);
 await page.keyboard.press('Escape');
 await expect(page.getByRole('button',{name:'Actions',exact:true}).first()).toBeFocused();
 await expect(page.locator('.conversation-compact-title')).toHaveText(original);
 let requests=0;
 await page.route('**/api/v1/contexts/*/title',async route=>{requests++;await route.fulfill({status:503,json:{error:'Title service unavailable'}})});
 await (await detailsField(page,'Conversation title')).fill('Retain this title');
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Title service unavailable');
 await expect(page.getByLabel('Conversation title',{exact:true})).toHaveValue('Retain this title');
 expect(requests).toBe(1);
 await page.unroute('**/api/v1/contexts/*/title');
 await saveTitle(page);await expect(page.locator('.conversation-compact-title')).toHaveText('Retain this title');
 await expect(page.getByRole('button',{name:'Actions',exact:true}).first()).toBeFocused();
});

test('delayed rename locks its editor and preserves the conversation draft',async({page})=>{
 await page.goto('/#/conversation/existing');
 await page.getByLabel('Message Hermes',{exact:true}).fill('Keep this unsent message');
 let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);let started=false;
 await page.route('**/api/v1/contexts/*/title',async route=>{started=true;await held;await route.continue()});
 try {
 await (await detailsField(page,'Conversation title')).fill('Acknowledged title');
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await expect.poll(()=>started).toBe(true);
 await expect(page.getByLabel('Conversation title',{exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Cancel',exact:true})).toBeDisabled();
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'Rename conversation',exact:true})).toBeVisible();
 release();await expect(page.getByRole('dialog',{name:'Rename conversation',exact:true})).toBeHidden();
 await closePageActions(page);await expect(page.getByLabel('Message Hermes',{exact:true})).toHaveValue('Keep this unsent message');
 } finally { release(); }
});
});

test('reading list opens a saved article and remembers an explicit discussion choice',async({page,request,context})=>{
 const itemId=crypto.randomUUID(),title='An available article';
 await request.post('/api/v1/reading/sync',{headers:{'x-herts-request':'1'},data:{id:crypto.randomUUID(),itemId,contextId:crypto.randomUUID(),kind:'create',title,url:'https://example.com/review-entry',at:Date.now()}});
 await page.goto('/#/reading');
 await expect(page.getByRole('link',{name:title,exact:true})).toHaveAttribute('href',`#/reader/${itemId}`);
 await page.getByRole('link',{name:title,exact:true}).click();await expect(page.getByRole('region',{name:'Article pane'})).toBeVisible();
 await page.getByRole('link',{name:'Discussion',exact:true}).click();
 await page.getByLabel('Message Hermes',{exact:true}).fill('Keep my discussion draft');
 await page.getByRole('link',{name:'Back to Reading list',exact:true}).click();
 await page.getByRole('link',{name:title,exact:true}).click();await expect(page.getByRole('region',{name:'Discussion pane'})).toBeVisible();
 await expect(page.getByLabel('Message Hermes',{exact:true})).toHaveValue('Keep my discussion draft');
 await context.setOffline(true);await page.getByRole('link',{name:'Article',exact:true}).click();await page.getByRole('link',{name:'Discussion',exact:true}).click();
 await expect(page.getByLabel('Message Hermes',{exact:true})).toHaveValue('Keep my discussion draft');
});
