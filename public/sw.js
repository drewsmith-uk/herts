// Preserve the cache namespace used by installed clients during upgrades.
// Theme fonts use immutable content hashes, including when a theme is updated.
self.addEventListener('fetch', event => {
 const url = new URL(event.request.url);
 if (url.origin !== self.location.origin || event.request.method !== 'GET' || !/^\/_themes\/[a-f0-9]{64}\.woff2$/.test(url.pathname)) return;
 event.respondWith((async () => {
  const cache = await caches.open('herts-theme-fonts-v1');
  const saved = await cache.match(event.request);
  if (saved) return saved;
  const response = await fetch(event.request);
  if (response.ok) await cache.put(event.request, response.clone());
  return response;
 })());
});
const CACHE='tasks-shell-dev';
const PRECACHE=['/index.html','/icon.svg','/manifest.webmanifest'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PRECACHE)));});
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_UPDATE')event.waitUntil(self.skipWaiting());});
self.addEventListener('message',event=>{if(event.data?.type==='GET_VERSION')event.ports[0]?.postMessage({version:CACHE});});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{const keys=(await caches.keys()).filter(k=>k.startsWith('tasks-shell-'));for(const k of keys.slice(0,-2))if(k!==CACHE)await caches.delete(k);await self.clients.claim();})());});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);if(url.origin!==self.location.origin||event.request.method!=='GET'||url.pathname.startsWith('/api/'))return;
 if(url.pathname==='/THIRD_PARTY_NOTICES.txt'){event.respondWith(caches.open(CACHE).then(c=>c.match(url.pathname)).then(cached=>cached||fetch(event.request)));return;}
 if(event.request.mode==='navigate'){event.respondWith(fetch(event.request).catch(()=>caches.open(CACHE).then(c=>c.match('/index.html')).then(r=>r||Response.error())));return;}
 if(url.pathname==='/manifest.webmanifest'){event.respondWith(fetch(event.request).catch(()=>caches.open(CACHE).then(c=>c.match('/manifest.webmanifest')).then(r=>r||Response.error())));return;}
 if(PRECACHE.includes(url.pathname))event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
});
self.addEventListener('push',event=>{event.waitUntil((async()=>{
 let data;try{data=event.data.json();}catch{return;}if(typeof data.id!=='string')return;
 const seen=await caches.open('tasks-notification-receipts');const key=new Request(`${self.location.origin}/__notice/${encodeURIComponent(data.id)}`);if(await seen.match(key)){await confirmTest(data);return;}
 const taskTitle=data.kind!=='test'&&typeof data.taskTitle==='string'?data.taskTitle.trim():'';
 const eventTitle={reminder:'Reminder',approval:'Approval needed',failure:'Work needs attention',completion:'Work finished'}[data.kind];
 const title=data.kind==='plugin'&&typeof data.title==='string'?`Herts · ${data.title}`:taskTitle&&eventTitle?`Herts · ${eventTitle}`:'Herts';
 const body=(data.kind==='plugin'&&typeof data.body==='string'?data.body:'')||taskTitle||(data.kind==='test'?'Test notification — reminders can reach this device.':data.kind==='reminder'?'A snoozed task is back in your Inbox.':data.kind==='approval'?'Hermes needs your input.':data.kind==='failure'?'Hermes work needs attention.':'Hermes work has finished.');
 await self.registration.showNotification(title,{body,tag:data.id,renotify:false,icon:'/icon-192.png',data:{id:data.id,...(data.kind==='test'?{kind:'test'}:{})}});
 await seen.put(key,new Response('shown'));const keys=await seen.keys();for(const k of keys.slice(0,-1000))await seen.delete(k);
 await confirmTest(data);
})());});
async function confirmTest(data){if(data.kind!=='test')return;try{await fetch(`/api/v1/notifications/tests/${encodeURIComponent(data.id)}/shown`,{method:'POST',headers:{'Content-Type':'application/json','X-Herts-Request':'1'},body:'{}',credentials:'same-origin',signal:AbortSignal.timeout(10000)});}catch{/* The notification can arrive while Tailscale is disconnected. */}}
self.addEventListener('notificationclick',event=>{
 if(event.notification.data?.kind==='device-plugin'){
  event.waitUntil(pluginNotificationQueue(async()=>{
   const data=event.notification.data,record=await readPluginNotification(data);
   if(!record){event.notification.close();return;}
   await openNotification({...data,route:record.route});
   await displayPluginNotification(data,record);
  }));
 }else{event.notification.close();event.waitUntil(openNotification(event.notification.data));}
});
async function openNotification(data){
 const url=data?.kind==='device-plugin'&&validPluginNotificationRoute(data.route)?`/#${data.route}`:data?.kind==='test'?'/#/settings':typeof data?.id==='string'&&data.id?`/?notice=${encodeURIComponent(data.id)}`:'/';
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
  try{client.postMessage({type:'OPEN_NOTIFICATION',...(data?.kind==='device-plugin'&&validPluginNotificationRoute(data.route)?{kind:'device-plugin',route:data.route}:data?.kind==='test'?{kind:'test'}:typeof data?.id==='string'?{id:data.id}:{})},[channel.port2]);}
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

// Prepared plugin assets are immutable and cached independently of the shell.
// A package update gets a new hash; an interrupted update cannot mix its files.
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(url.origin!==self.location.origin||event.request.method!=='GET'||!url.pathname.startsWith('/_plugins/'))return;
 event.respondWith((async()=>{const cache=await caches.open('herts-plugin-assets-v1');const cached=await cache.match(event.request);if(cached)return cached;const response=await fetch(event.request);if(response.ok)await cache.put(event.request,response.clone());return response;})());
});

self.addEventListener('install',event=>event.waitUntil((async()=>{
 const response=await fetch('/api/v1/plugins',{cache:'no-store'});
 if(!response.ok)throw new Error('Could not prepare plugin packages for this update.');
 const {catalogue}=await response.json(),cache=await caches.open('herts-plugin-assets-v1');
 for(const entry of catalogue.entries)if(entry.enabled&&entry.hash&&entry.manifest.client){
  await cache.add(`/_plugins/${entry.manifest.id}/${entry.hash}/${entry.manifest.client}`);
 }
 await cache.put('/__herts_plugin_catalogue',new Response(JSON.stringify(catalogue),{headers:{'Content-Type':'application/json'}}));
})()));

// Device notifications use the same plugin namespace and reset generation as local records.
let pluginNotificationWork = Promise.resolve();
function pluginNotificationQueue(work) {
 const result = pluginNotificationWork.then(() => self.navigator?.locks ? self.navigator.locks.request('herts-device-notifications', work) : work());
 pluginNotificationWork = result.catch(() => {});
 return result;
}
function validPluginNotificationRoute(value) {
 return typeof value === 'string' && /^\/[a-z][a-z0-9-]*(?:\/[^?#\\\s]*)?$/.test(value)
  && value.length <= 8192 && !/[\u0000-\u001f\u007f]/.test(value);
}
function pluginNotificationKey(data) { return `${data.pluginId}:${data.generation}:notification:${data.key}`; }
function pluginNotificationTag(data) { return `herts-plugin:${data.pluginId}:${data.generation}:${encodeURIComponent(data.key)}`; }
function pluginRequest(request) {
 return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
async function pluginNotificationStorage(mode, work) {
 const database = await new Promise((resolve, reject) => {
  const request = indexedDB.open('hermes-tasks');
  request.onupgradeneeded = () => request.transaction.abort();
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(new Error('Open Herts to prepare notification storage.'));
 });
 try {
  const transaction = database.transaction(['kv', 'pluginLocal'], mode);
  const complete = new Promise((resolve, reject) => {
   transaction.oncomplete = resolve;
   transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('Notification storage could not be saved.'));
  });
  const store = {
   catalogue: async () => (await pluginRequest(transaction.objectStore('kv').get('plugins')))?.value?.catalogue,
   get: async key => (await pluginRequest(transaction.objectStore('pluginLocal').get(key)))?.value,
   all: prefix => pluginRequest(transaction.objectStore('pluginLocal').getAll(IDBKeyRange.bound(prefix, prefix + '\uffff'))),
   put: (key, value) => pluginRequest(transaction.objectStore('pluginLocal').put({ key, value })),
   remove: key => pluginRequest(transaction.objectStore('pluginLocal').delete(key)),
  };
  let result;
  try { result = await work(store); }
  catch (error) { try { transaction.abort(); } catch {} await complete.catch(() => {}); throw error; }
  await complete;
  return result;
 } finally { database.close(); }
}
function notificationPlugin(catalogue, data, checkHash = false) {
 const entry = catalogue?.entries?.find(entry => entry.manifest.id === data.pluginId);
 return entry?.enabled && entry.available && entry.generation === data.generation
  && (!checkHash || entry.hash === data.hash) ? entry : undefined;
}
async function readPluginNotification(data) {
 return pluginNotificationStorage('readonly', async store => {
  if (!notificationPlugin(await store.catalogue(), data)) return;
  return store.get(pluginNotificationKey(data));
 });
}
async function closePluginNotification(data, revision) {
 const notifications = await self.registration.getNotifications({ tag: pluginNotificationTag(data) });
 for (const notification of notifications) if (!revision || notification.data?.revision === revision) notification.close();
}
async function pluginNotificationsChanged() {
 for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
  if (new URL(client.url).origin === self.location.origin) client.postMessage({ type: 'PLUGIN_NOTIFICATIONS_CHANGED' });
 }
}
async function displayPluginNotification(data, record, onlyMissing = false) {
 let error;
 try {
  const current = await readPluginNotification(data);
  if (!current || current.revision !== record.revision) return;
  const present = await self.registration.getNotifications({ tag: pluginNotificationTag(data) });
  if (!onlyMissing || !present.some(notification => notification.data?.revision === record.revision)) {
   await self.registration.showNotification(record.title, {
    body: record.body || '', icon: '/icon-192.png', tag: pluginNotificationTag(data),
    silent: true, renotify: false, requireInteraction: true,
    data: { kind: 'device-plugin', pluginId: data.pluginId, generation: data.generation, key: data.key, revision: record.revision },
   });
  }
 } catch {
  error = typeof Notification !== 'undefined' && Notification.permission !== 'granted'
   ? 'Allow notifications in your browser settings, then select Retry.'
   : 'The notification could not be shown. Select Retry to try again.';
 }
 // Catalogue changes can commit while the browser displays a notification.
 const retained = await pluginNotificationStorage('readwrite', async store => {
  const current = await store.get(pluginNotificationKey(data));
  if (!notificationPlugin(await store.catalogue(), data) || current?.revision !== record.revision) return false;
  if (current.displayError !== error) await store.put(pluginNotificationKey(data), { ...current, displayError: error });
  return true;
 });
 if (!retained) await closePluginNotification(data, record.revision);
 await pluginNotificationsChanged();
}
async function reconcilePluginNotifications() {
 const records = await pluginNotificationStorage('readonly', async store => {
  const catalogue = await store.catalogue();
  const rows = (await Promise.all((catalogue?.entries || []).filter(entry => entry.enabled && entry.available)
   .map(entry => store.all(`${entry.manifest.id}:${entry.generation}:notification:`)))).flat();
  return rows.flatMap(row => {
   const match = /^([a-z][a-z0-9-]*):(\d+):notification:(.+)$/.exec(row.key);
   if (!match) return [];
   const data = { pluginId: match[1], generation: Number(match[2]), key: match[3] };
   return notificationPlugin(catalogue, data) ? [{ data, record: row.value }] : [];
  });
 });
 const desired = new Set(records.map(({ data }) => pluginNotificationTag(data)));
 for (const notification of await self.registration.getNotifications()) {
  if (notification.data?.kind === 'device-plugin' && !desired.has(notification.tag)) notification.close();
 }
 for (const { data, record } of records) if (record.restoreOnDismiss) await displayPluginNotification(data, record, true);
}
async function handlePluginNotification(data) {
 if (data.version !== 1) throw new Error('Update Herts to use device notifications.');
 if (data.command === 'reconcile') return reconcilePluginNotifications();
 if (!/^[a-z][a-z0-9-]{0,63}$/.test(data.pluginId) || !Number.isSafeInteger(data.generation)) throw new Error('Invalid plugin identity.');
 const result = await pluginNotificationStorage('readwrite', async store => {
  if (!notificationPlugin(await store.catalogue(), data, true)) throw new Error('This plugin changed. Reload before changing notifications.');
  if (data.command === 'check') return;
  if (data.command === 'set') {
   const input = data.input;
   if (!input || typeof input.key !== 'string' || !input.key || input.key.length > 1000
    || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 8192
    || input.body !== undefined && (typeof input.body !== 'string' || input.body.length > 8192)
    || typeof input.restoreOnDismiss !== 'boolean' || !validPluginNotificationRoute(input.route)
    || JSON.stringify(input).length > 65536) throw new Error('Invalid device notification.');
   data.key = input.key;
   const previous = await store.get(pluginNotificationKey(data));
   if ((previous?.revision ?? null) !== data.expectedRevision) throw new Error('This notification changed. Reload its saved state before editing.');
   const record = { ...input, revision: crypto.randomUUID(), createdAt: previous?.createdAt ?? Date.now() };
   await store.put(pluginNotificationKey(data), record);
   return record;
  }
  if (typeof data.key !== 'string' || !data.key) throw new Error('A notification key is required.');
  if (data.command === 'remove') { await store.remove(pluginNotificationKey(data)); return; }
  if (data.command === 'retry') return store.get(pluginNotificationKey(data));
  throw new Error('Unknown notification operation.');
 });
 if (data.command === 'remove') await closePluginNotification(data);
 if (result) await displayPluginNotification(data, result);
 await pluginNotificationsChanged();
 return result ? readPluginNotification(data) : undefined;
}
self.addEventListener('message', event => {
 if (event.data?.type !== 'PLUGIN_NOTIFICATIONS') return;
 if (!event.source?.url || new URL(event.source.url).origin !== self.location.origin) return;
 event.waitUntil(pluginNotificationQueue(async () => {
  try { event.ports[0]?.postMessage({ version: 1, result: await handlePluginNotification(event.data) }); }
  catch (error) { event.ports[0]?.postMessage({ version: 1, error: error.message || 'The notification operation failed.' }); }
 }));
});
self.addEventListener('notificationclose', event => {
 const data = event.notification.data;
 if (data?.kind !== 'device-plugin') return;
 event.waitUntil(pluginNotificationQueue(async () => {
  const record = await readPluginNotification(data);
  if (record?.restoreOnDismiss) await displayPluginNotification(data, record);
 }).catch(() => {}));
});
