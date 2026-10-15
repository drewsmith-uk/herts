import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  class Utterance {text:string;lang='';voice:unknown;onstart?:()=>void;onend?:()=>void;onerror?:()=>void;constructor(text:string){this.text=text;}}
  const state={utterances:[] as Utterance[],cancelled:0};
  Object.assign(window,{deviceSpeech:state,SpeechSynthesisUtterance:Utterance});
  Object.defineProperty(window,'speechSynthesis',{value:{
   getVoices:()=>[{lang:'en-US',localService:true}],
   speak:(utterance:Utterance)=>{state.utterances.push(utterance);setTimeout(()=>utterance.onstart?.(),10);},
   cancel:()=>{state.cancelled++;},
  }});
 });
});
test('reads offline with device speech, stops, retries failures, and preserves the draft',async({page,context})=>{
 let requests=0;await page.route('**/api/v1/audio/speak',route=>{requests++;return route.abort();});
 await page.goto('/#/conversation/existing');
 await page.getByLabel('Message Hermes').fill('Keep this draft while reading.');
 await context.setOffline(true);
 await page.getByRole('button',{name:'Read response aloud',exact:true}).click();
 await expect(page.getByRole('button',{name:'Stop reading aloud',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Stop reading aloud',exact:true}).click();
 await expect(page.getByRole('button',{name:'Read response aloud',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Read response aloud',exact:true}).click();
 await page.evaluate(()=>(window as any).deviceSpeech.utterances.at(-1).onerror());
 await expect(page.getByRole('alert')).toContainText('Device speech could not play');
 await page.getByRole('button',{name:'Read response aloud',exact:true}).click();
 await expect(page.getByRole('button',{name:'Stop reading aloud',exact:true})).toBeVisible();
 await page.evaluate(()=>(window as any).deviceSpeech.utterances.at(-1).onend());
 await expect(page.getByRole('button',{name:'Read response aloud',exact:true})).toBeVisible();
 await expect(page.getByLabel('Message Hermes')).toHaveValue('Keep this draft while reading.');expect(requests).toBe(0);
});
test('saves the voice choice on this device and uses Hermes only when selected',async({page})=>{
 await page.goto('/#/settings');const select=page.getByLabel('Voice on this device');
 await expect(select).toHaveValue('device');await select.selectOption('hermes');await page.reload();
 await expect(select).toHaveValue('hermes');
 let requests=0;await page.route('**/api/v1/audio/speak',route=>{requests++;return route.fulfill({status:503,json:{error:'Synthetic provider failure.'}});});
 await page.goto('/#/conversation/existing');await page.getByRole('button',{name:'Read response aloud',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Synthetic provider failure');expect(requests).toBe(1);
 await page.goto('/#/settings');await select.selectOption('device');
 await page.goto('/#/conversation/existing');await page.getByRole('button',{name:'Read response aloud',exact:true}).click();
 await expect(page.getByRole('button',{name:'Stop reading aloud',exact:true})).toBeVisible();expect(requests).toBe(1);
});
test('reports preference storage failure without changing the selection',async({page})=>{
 await page.goto('/#/settings');
 await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new DOMException('Storage unavailable','QuotaExceededError');};});
 await page.getByLabel('Voice on this device').selectOption('hermes');
 await expect(page.getByRole('alert')).toContainText('voice setting could not be saved');
 await expect(page.getByLabel('Voice on this device')).toHaveValue('device');
});
