// Preserve the cache namespace used by installed clients during upgrades.
const CACHE='tasks-shell-dev';
const PRECACHE=['/index.html','/icon.svg','/manifest.webmanifest'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PRECACHE)));});
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_UPDATE')event.waitUntil(self.skipWaiting());});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{const keys=(await caches.keys()).filter(k=>k.startsWith('tasks-shell-'));for(const k of keys.slice(0,-2))if(k!==CACHE)await caches.delete(k);await self.clients.claim();})());});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);if(url.origin!==self.location.origin||event.request.method!=='GET'||url.pathname.startsWith('/api/'))return;
 if(event.request.mode==='navigate'){event.respondWith(fetch(event.request).catch(()=>caches.open(CACHE).then(c=>c.match('/index.html')).then(r=>r||Response.error())));return;}
 if(url.pathname==='/manifest.webmanifest'){event.respondWith(fetch(event.request).catch(()=>caches.open(CACHE).then(c=>c.match('/manifest.webmanifest')).then(r=>r||Response.error())));return;}
 if(PRECACHE.includes(url.pathname))event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
});
self.addEventListener('push',event=>{event.waitUntil((async()=>{
 let data;try{data=event.data.json();}catch{return;}if(typeof data.id!=='string')return;
 const seen=await caches.open('tasks-notification-receipts');const key=new Request(`${self.location.origin}/__notice/${encodeURIComponent(data.id)}`);if(await seen.match(key)){await confirmTest(data);return;}
 const taskTitle=data.kind!=='test'&&typeof data.taskTitle==='string'?data.taskTitle.trim():'';
 const eventTitle={reminder:'Reminder',approval:'Approval needed',failure:'Work needs attention',completion:'Work finished'}[data.kind];
 const title=taskTitle&&eventTitle?`Herts · ${eventTitle}`:'Herts';
 const body=taskTitle||(data.kind==='test'?'Test notification — reminders can reach this device.':data.kind==='reminder'?'A snoozed task is back in your Inbox.':data.kind==='approval'?'Hermes needs your input.':data.kind==='failure'?'Hermes work needs attention.':'Hermes work has finished.');
 await self.registration.showNotification(title,{body,tag:data.id,renotify:false,icon:'/icon-192.png',data:{id:data.id,...(data.kind==='test'?{kind:'test'}:{})}});
 await seen.put(key,new Response('shown'));const keys=await seen.keys();for(const k of keys.slice(0,-1000))await seen.delete(k);
 await confirmTest(data);
})());});
async function confirmTest(data){if(data.kind!=='test')return;try{await fetch(`/api/v1/notifications/tests/${encodeURIComponent(data.id)}/shown`,{method:'POST',headers:{'Content-Type':'application/json','X-Herts-Request':'1'},body:'{}',credentials:'same-origin',signal:AbortSignal.timeout(10000)});}catch{/* The notification can arrive while Tailscale is disconnected. */}}
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(openNotification(event.notification.data));});
async function openNotification(data){
 const url=data?.kind==='test'?'/#/settings':typeof data?.id==='string'&&data.id?`/?notice=${encodeURIComponent(data.id)}`:'/';
 let windows=[];
 try{windows=(await self.clients.matchAll({type:'window',includeUncontrolled:true})).filter(c=>c.frameType==='top-level'&&new URL(c.url).origin===self.location.origin);}catch{/* Window enumeration must not prevent launching the app. */}
 windows.sort((a,b)=>Number(b.focused)-Number(a.focused));
 for(const window of windows)try{
  // Let a responsive app replace the old screen before bringing it forward.
  // A suspended page may need focus to process the message: never wait for a
  // network lookup or the full legacy-page timeout before requesting focus.
  const routed=routeNotification(window,data);
  let preparationTimer;
  try{await Promise.race([routed,new Promise(resolve=>{preparationTimer=setTimeout(resolve,100);})]);}
  finally{clearTimeout(preparationTimer);}
  const focused=await window.focus();
  if(!focused)continue;
  if(await routed)return;
  // An older app may not understand the message yet. Focus has already happened,
  // so a one-time page load can update it without using a stale client afterwards.
  if(await focused.navigate(url))return;
 }catch{/* Try another surviving app window. */}
 // A closed app needs a normal launch. openWindow already activates it.
 await self.clients.openWindow(url);
}
function routeNotification(client,data){
 return new Promise(resolve=>{
  const channel=new MessageChannel();
  const finish=accepted=>{clearTimeout(timer);channel.port1.close();channel.port2.close();resolve(accepted);};
  const timer=setTimeout(()=>finish(false),1500);
  channel.port1.onmessage=event=>finish(event.data?.accepted===true);
  try{client.postMessage({type:'OPEN_NOTIFICATION',...(data?.kind==='test'?{kind:'test'}:typeof data?.id==='string'?{id:data.id}:{})},[channel.port2]);}
  catch{finish(false);}
 });
}
self.addEventListener('pushsubscriptionchange',event=>{event.waitUntil((async()=>{
 // Browsers can rotate a subscription independently of the app. Preserve the
 // existing opt-in, and register the replacement before retiring the old one.
 const sub=event.newSubscription||(event.oldSubscription&&await self.registration.pushManager.subscribe(event.oldSubscription.options));if(!sub)return;
 const response=await fetch('/api/v1/notifications/subscribe',{method:'POST',headers:{'Content-Type':'application/json','X-Herts-Request':'1'},body:JSON.stringify(sub.toJSON()),credentials:'same-origin',signal:AbortSignal.timeout(10000)});
 if(response.ok&&event.oldSubscription&&event.oldSubscription.endpoint!==sub.endpoint)await fetch('/api/v1/notifications/unsubscribe',{method:'POST',headers:{'Content-Type':'application/json','X-Herts-Request':'1'},body:JSON.stringify({endpoint:event.oldSubscription.endpoint}),credentials:'same-origin',signal:AbortSignal.timeout(10000)});
})().catch(()=>{/* Settings verifies both ends and offers repair after a failed renewal. */}));});
