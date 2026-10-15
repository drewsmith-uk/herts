import {test,expect} from '@playwright/test';

function tone(){
 const samples=4000,bytes=Buffer.alloc(44+samples*2);
 bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);
 bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(8000,24);bytes.writeUInt32LE(16000,28);
 bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(samples*2,40);
 for(let i=0;i<samples;i++)bytes.writeInt16LE(Math.round(1000*Math.sin(2*Math.PI*440*i/8000)),44+i*2);
 return {data_url:`data:audio/wav;base64,${bytes.toString('base64')}`};
}
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  localStorage.setItem('herts:speech-provider','hermes');
  const NativeAudio=window.Audio;
  (window as any).speechEvents=[];
  window.Audio=class extends NativeAudio {
   constructor(){super();this.addEventListener('playing',()=>{if(this.duration>.1)(window as any).speechEvents.push('playing');});}
  };
 });
});
test('plays delayed audio, restores the button, and plays cached audio offline',async({page,context})=>{
 let release!:()=>void,calls=0;
 const gate=new Promise<void>(yes=>{release=yes;});
 await page.route('**/api/v1/audio/speak',async route=>{calls++;await gate;await route.fulfill({json:tone()});});
 await page.goto('/#/conversation/existing');
 await page.getByRole('button',{name:'Read response aloud',exact:true}).click();
 await expect(page.getByRole('button',{name:'Cancel audio preparation',exact:true})).toBeVisible();
 release();
 await expect.poll(()=>page.evaluate(()=>(window as any).speechEvents.length)).toBe(1);
 await expect(page.getByRole('button',{name:'Read response aloud',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Read response aloud',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).speechEvents.length)).toBe(2);
 await expect(page.getByRole('button',{name:'Read response aloud',exact:true})).toBeVisible();
 expect(calls).toBe(1);
 await page.unroute('**/api/v1/audio/speak');await context.setOffline(true);
 await page.getByRole('button',{name:'Read response aloud',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).speechEvents.length)).toBe(3);
});
test('rejects missing audio and recovers on an explicit retry',async({page})=>{
 let calls=0;
 await page.route('**/api/v1/audio/speak',route=>route.fulfill({json:++calls===1?{}:tone()}));
 await page.goto('/#/conversation/existing');
 await page.getByRole('button',{name:'Read response aloud',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Hermes returned no playable audio');
 expect(calls).toBe(1);
 await page.getByRole('button',{name:'Read response aloud',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).speechEvents.length)).toBe(1);
 expect(calls).toBe(2);
});
test('cancels delayed playback without changing the message draft',async({page})=>{
 let release!:()=>void,requested=false;
 const gate=new Promise<void>(yes=>{release=yes;});
 await page.route('**/api/v1/audio/speak',async route=>{requested=true;await gate;await route.fulfill({json:tone()});});
 await page.goto('/#/conversation/existing');
 await page.getByLabel('Message Hermes').fill('Keep this unsent draft.');
 await page.getByRole('button',{name:'Read response aloud',exact:true}).click();
 await expect.poll(()=>requested).toBe(true);
 await page.getByRole('button',{name:'Cancel audio preparation',exact:true}).click();
 const response=page.waitForResponse('**/api/v1/audio/speak');release();await response;
 await expect(page.getByRole('button',{name:'Read response aloud',exact:true})).toBeVisible();
 await expect(page.getByLabel('Message Hermes')).toHaveValue('Keep this unsent draft.');
 expect(await page.evaluate(()=>(window as any).speechEvents)).toEqual([]);
});

for(const viewport of [{width:390,height:700},{width:320,height:480},{width:1280,height:480}])test(`keeps speech errors visible after history refresh at ${viewport.width}px`,async({page})=>{
 await page.setViewportSize(viewport);
 await page.route('**/api/v1/audio/speak',route=>route.fulfill({status:503,json:{error:'Synthetic speech provider unavailable.'}}));
 await page.goto('/#/conversation/long-history');
 const message=page.locator('.message').filter({has:page.locator('button.read-aloud')}).last();
 await message.getByRole('button',{name:'Read response aloud',exact:true}).evaluate(async button=>{
  const view=button.closest<HTMLElement>('.conversation-scroll')!;
  view.scrollTop+=button.getBoundingClientRect().bottom-view.getBoundingClientRect().bottom+8;
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 });
 await message.getByRole('button',{name:'Read response aloud',exact:true}).click();
 const error=message.getByRole('alert');
 await expect(error).toContainText('Synthetic speech provider unavailable.');
 await expect(error).toBeInViewport();
 await page.getByRole('button',{name:'Refresh conversation history',exact:true}).click();
 await expect(error).toContainText('Synthetic speech provider unavailable.');
 await expect(error).toBeInViewport();
 await expect(page.getByRole('button',{name:'Cancel audio preparation',exact:true})).toHaveCount(0);
});

test('a delayed speech error does not move a reader who scrolled away',async({page})=>{
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/v1/audio/speak',async route=>{await gate;await route.fulfill({status:503,json:{error:'Delayed synthetic failure.'}});});
 await page.goto('/#/conversation/long-history');
 const message=page.locator('.message').filter({has:page.locator('button.read-aloud')}).last();
 await message.getByRole('button',{name:'Read response aloud',exact:true}).click();
 await expect(message.getByRole('status')).toHaveText('Preparing audio…');
 const view=page.locator('.conversation-scroll');
 await view.evaluate(async element=>{element.scrollTop=0;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
 release();await expect(message.getByRole('alert')).toContainText('Delayed synthetic failure.');
 await expect.poll(()=>view.evaluate(element=>element.scrollTop)).toBe(0);
 await expect(message.getByRole('alert')).not.toBeInViewport();
});
