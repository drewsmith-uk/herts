import { test, expect, type Page } from '@playwright/test';
const headers={'x-tasks-request':'1'};
async function browserPush(page:Page, existing=false, permission='granted', realWorker=false) {
  await page.addInitScript(({existing,permission,realWorker})=>{
    const key='fixture-push-sub';
    if(!sessionStorage.getItem('push-fixture-initialised')){
      if(existing)localStorage.setItem(key,JSON.stringify({endpoint:`https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`}));
      localStorage.setItem('fixture-permission',permission);sessionStorage.setItem('push-fixture-initialised','1');
    }
    Object.defineProperty(Notification,'permission',{get:()=>localStorage.getItem('fixture-permission')});
    Notification.requestPermission=async()=>{localStorage.setItem('fixture-permission','granted');return 'granted';};
    function sub(){
      const saved=JSON.parse(localStorage.getItem(key)||'null');if(!saved)return null;
      return {endpoint:saved.endpoint,expirationTime:null,options:{applicationServerKey:saved.key?new Uint8Array(saved.key).buffer:null},
        toJSON:()=>({endpoint:saved.endpoint,keys:{p256dh:'fixture',auth:'fixture'}}),
        unsubscribe:async()=>{localStorage.removeItem(key);return true;}};
    }
    const registration={addEventListener:()=>{},removeEventListener:()=>{},update:async()=>{},pushManager:{getSubscription:async()=>sub(),subscribe:async(options:any)=>{
      localStorage.setItem(key,JSON.stringify({endpoint:`https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`,key:Array.from(options.applicationServerKey)}));return sub();
    }}};
    if(realWorker){PushManager.prototype.getSubscription=registration.pushManager.getSubscription as any;PushManager.prototype.subscribe=registration.pushManager.subscribe as any;}
    else Object.defineProperty(navigator,'serviceWorker',{value:{addEventListener:()=>{},getRegistration:async()=>registration,register:async()=>registration,ready:Promise.resolve(registration)}});
  },{existing,permission,realWorker});
}
const settings=(page:Page)=>page.getByRole('heading',{name:'Notifications on this device'}).locator('../..');

test('detects the stale enabled setting, repairs it, confirms a test and persists the repaired registration',async({page,request})=>{
  await request.post('/__test/push-status',{headers,data:{status:201}});
  await page.setViewportSize({width:390,height:844});await browserPush(page,true);await page.goto('/#/settings');
  await expect(settings(page)).toContainText('Notifications need repair');await expect(page.getByRole('button',{name:'Send test notification'})).toHaveCount(0);
  const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture-push-sub')!).endpoint);
  await page.getByRole('button',{name:'Repair notifications',exact:true}).click();await expect(settings(page)).toContainText('Notifications are registered on this device.');
  await expect(page.getByRole('button',{name:'Repair notifications',exact:true})).toHaveCount(0);
  const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture-push-sub')!).endpoint);expect(after).not.toBe(before);
  const status=async(endpoint:string)=>(await(await request.post('/api/v1/notifications/status',{headers,data:{endpoint}})).json());
  expect((await status(after)).registered).toBe(true);expect((await status(before)).registered).toBe(false);
  await page.reload();await expect(page.getByRole('button',{name:'Send test notification'})).toBeEnabled();
  await page.getByRole('button',{name:'Send test notification'}).click();await expect(settings(page)).toContainText('Waiting for this device');
  const {id}=await page.evaluate(()=>JSON.parse(localStorage.getItem('tasks:last-notification-test')!));
  expect((await(await request.get(`/api/v1/notifications/tests/${id}`)).json()).state).toBe('accepted');
  await page.evaluate(()=>{const t=JSON.parse(localStorage.getItem('tasks:last-notification-test')!);t.at=Date.now()-25_000;localStorage.setItem('tasks:last-notification-test',JSON.stringify(t));});await page.reload();
  await expect(settings(page)).toContainText('The push service accepted the test, but this device has not confirmed showing it.');
  await request.post(`/api/v1/notifications/tests/${id}/shown`,{headers,data:{}});await expect(settings(page)).toContainText('This device confirmed showing the test notification.');
  await page.reload();await expect(settings(page)).toContainText('This device confirmed showing the test notification.');
  await expect(page.getByRole('button',{name:'Repair notifications',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Turn off notifications'}).click();await expect(settings(page)).toContainText('Notifications are off on this device.');expect((await status(after)).registered).toBe(false);
});

test('an expired provider subscription becomes repairable, and a test never silently retries',async({page,request})=>{
  await request.post('/__test/push-status',{headers,data:{status:410}});
  try {
    await browserPush(page);await page.goto('/#/settings');await page.getByRole('button',{name:'Enable notifications',exact:true}).click();
    await page.getByRole('button',{name:'Send test notification'}).click();await expect(settings(page)).toContainText('expired');await expect(settings(page)).toContainText('Notifications need repair');
    await expect(page.getByRole('button',{name:'Repair notifications',exact:true})).toBeVisible();
    const {id}=await page.evaluate(()=>JSON.parse(localStorage.getItem('tasks:last-notification-test')!));
    const calls=async()=>(await(await request.get('/__test/push-calls')).json()).filter((c:any)=>c.id===id);
    expect(await calls()).toHaveLength(1);await page.reload();await expect(settings(page)).toContainText('expired');expect(await calls()).toHaveLength(1);
    await request.post('/__test/push-status',{headers,data:{status:201}});
    await page.getByRole('button',{name:'Repair notifications',exact:true}).click();await expect(page.getByRole('button',{name:'Send test notification'})).toBeEnabled();
  }finally{await request.post('/__test/push-status',{headers,data:{status:201}});}
});

test('checks permission and never reports enabled when verification fails',async({page})=>{
  await browserPush(page,true,'denied');await page.goto('/#/settings');await expect(settings(page)).toContainText('Notifications are blocked');await expect(page.getByRole('button',{name:'Send test notification'})).toHaveCount(0);
  await page.evaluate(()=>localStorage.setItem('fixture-permission','granted'));await page.route('**/api/v1/notifications/status',route=>route.abort());await page.reload();
  await expect(settings(page)).toContainText('Notification registration could not be verified');await expect(page.getByRole('button',{name:'Send test notification'})).toHaveCount(0);
  await page.unroute('**/api/v1/notifications/status');await page.getByRole('button',{name:'Check again'}).click();await expect(page.getByRole('button',{name:'Repair notifications',exact:true})).toBeVisible();
});

test('a lost test response is recovered by its ID without submitting another push',async({page,request})=>{
  await browserPush(page);await page.goto('/#/settings');await page.getByRole('button',{name:'Enable notifications',exact:true}).click();
  await page.route('**/api/v1/notifications/test',async route=>{await route.fetch();await route.abort();});
  await page.getByRole('button',{name:'Send test notification'}).click();await expect(settings(page)).toContainText('Connection lost');
  const {id}=await page.evaluate(()=>JSON.parse(localStorage.getItem('tasks:last-notification-test')!));
  await page.reload();await expect(settings(page)).toContainText('Waiting for this device');
  expect((await(await request.get('/__test/push-calls')).json()).filter((c:any)=>c.id===id)).toHaveLength(1);
});

test('repairs an app with an older active worker, then shows and confirms a real service-worker push',async({page,context,request})=>{
  await context.grantPermissions(['notifications']);await browserPush(page,false,'granted',true);
  await page.goto('/manifest.webmanifest');await page.evaluate(async()=>{await navigator.serviceWorker.register('/__test/old-sw.js',{scope:'/'});await navigator.serviceWorker.ready;});
  const cdp=await context.newCDPSession(page),registrations=new Map<string,string>();
  cdp.on('ServiceWorker.workerRegistrationUpdated',({registrations:rows})=>{for(const row of rows)if(!row.isDeleted)registrations.set(row.scopeURL,row.registrationId);});
  await cdp.send('ServiceWorker.enable');await page.goto('/#/settings');await page.evaluate(()=>navigator.serviceWorker.ready.then(()=>true));
  await expect.poll(()=>registrations.get('http://127.0.0.1:8790/')).toBeTruthy();
  await expect.poll(()=>page.evaluate(async()=>(await navigator.serviceWorker.getRegistration())?.waiting?.scriptURL.endsWith('/sw.js'))).toBe(true);
  await page.getByRole('button',{name:'Enable notifications',exact:true}).click();await expect(page.getByRole('button',{name:'Send test notification'})).toBeEnabled();
  expect(await page.evaluate(async()=>(await navigator.serviceWorker.getRegistration())?.active?.scriptURL.endsWith('/sw.js'))).toBe(true);
  const id=crypto.randomUUID(),subscription={endpoint:`https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`,keys:{p256dh:'fixture',auth:'fixture'}};
  expect((await request.post('/api/v1/notifications/subscribe',{headers,data:subscription})).ok()).toBe(true);
  expect((await request.post('/api/v1/notifications/test',{headers,data:{endpoint:subscription.endpoint,id}})).ok()).toBe(true);
  await cdp.send('ServiceWorker.deliverPushMessage',{origin:'http://127.0.0.1:8790',registrationId:registrations.get('http://127.0.0.1:8790/')!,data:JSON.stringify({id,kind:'test'})});
  await expect.poll(async()=>(await(await request.get(`/api/v1/notifications/tests/${id}`)).json()).shownAt).toBeTruthy();
  const notices=await page.evaluate(async id=>(await(await navigator.serviceWorker.ready).getNotifications({tag:id})).map(n=>({title:n.title,body:n.body,data:n.data})),id);
  expect(notices).toEqual([{title:'Herts',body:'Test notification — reminders can reach this device.',data:{id,kind:'test'}}]);
  const taskId=crypto.randomUUID(),at=Date.now(),taskTitle='Fixture reminder: review sample notes';
  await request.post('/api/v1/sync',{headers,data:{id:crypto.randomUUID(),taskId,kind:'create',title:taskTitle,at}});
  await request.post('/api/v1/sync',{headers,data:{id:crypto.randomUUID(),taskId,kind:'snooze',baseStatus:'inbox',baseSnoozeId:null,snoozedUntil:at+60_000,at}});
  const wake=await(await request.post('/__test/wake-snoozed',{headers,data:{at:at+60_000}})).json(),reminderId=wake.notices.find((n:any)=>n.task_id===taskId).id;
  let reminder:any;
  await expect.poll(async()=>{reminder=(await(await request.get('/__test/push-calls')).json()).find((p:any)=>p.id===reminderId);return reminder?.taskTitle;}).toBe(taskTitle);
  await cdp.send('ServiceWorker.deliverPushMessage',{origin:'http://127.0.0.1:8790',registrationId:registrations.get('http://127.0.0.1:8790/')!,data:JSON.stringify(reminder)});
  await expect.poll(()=>page.evaluate(async id=>(await(await navigator.serviceWorker.ready).getNotifications({tag:id})).map(n=>({title:n.title,body:n.body,data:n.data})),reminderId)).toEqual([{title:'Herts · Reminder',body:taskTitle,data:{id:reminderId}}]);

});
