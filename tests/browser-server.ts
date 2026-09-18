import webpush from 'web-push';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { WebSocketServer } from 'ws';
import { createApp } from '../server/app';
const browserRoot = process.env.HERTS_BROWSER_ROOT || process.env.TASKS_BROWSER_ROOT;
if (browserRoot) process.chdir(browserRoot);
const calls: string[] = [];
const rows = new Map<string, any>([['existing', { id: 'existing', title: 'Plan the autumn trip', source: 'telegram', preview: 'A quiet week away', started_at: Date.now()/1000, messages: [{ id: 1, role: 'user', content: 'Help me plan a trip.' }, { id: 2, role: 'assistant', content: 'We could visit the coast.\n\nA slower pace sounds good.' }] }]]);
rows.set('long-history', { id: 'long-history', title: 'Long conversation', source: 'desktop', started_at: Date.now()/1000, messages: Array.from({length:450}, (_, i) => ({id:i+1,role:i%2 ? 'assistant' : 'user',content:`History message ${i+1}. ${'Conversation detail. '.repeat(8)}`})) });
for (const width of [390,1280]) rows.set(`live-history-${width}`, { ...rows.get('long-history'), id: `live-history-${width}`, title: `Live history ${width}`, messages: structuredClone(rows.get('long-history').messages) });
rows.set('header-history', { ...rows.get('long-history'), id: 'header-history', title: 'Header conversation' });
rows.set('standalone-unavailable', { ...rows.get('long-history'), id: 'standalone-unavailable', title: 'Conversation retry' });
for (const width of [390,1280]) rows.set(`filter-${width}`, { id: `filter-${width}`, title: `Filter conversation ${width}`, source: 'desktop', started_at: Date.now()/1000, messages: [{ id: 1, role: 'assistant', content: `Saved filter response ${width}` }] });
for (const id of ['standalone-390', 'standalone-1280', 'standalone-shared', 'standalone-recovery']) rows.set(id, { id, title: `Direct conversation ${id}`, source: 'telegram', started_at: Date.now()/1000, messages: [{ id: 1, role: 'assistant', content: `Continue this conversation or bookmark [this article](https://example.com/${id}).` }] });
for (const [id, title] of [['swipe-first', 'Swipe conversation one'], ['swipe-second', 'Swipe conversation two'], ['swipe-third', 'Swipe conversation three'], ['hidden-offline', 'Offline triage conversation'], ['triage-receipt', 'Receipt triage conversation']]) rows.set(id, { id, title, source: 'desktop', started_at: Date.now()/1000, messages: [{ id: 1, role: 'assistant', content: `History for ${title}.` }] });
for (const id of ['resume-busy','resume-failure']) rows.set(id,{id,title:id==='resume-busy'?'Interrupted conversation':'Unavailable conversation',source:'desktop',started_at:Date.now()/1000,messages:[{id:1,role:'user',content:'The earlier request.'}]});
rows.set('tool-activity', { id: 'tool-activity', title: 'Conversation with tool activity', source: 'desktop', started_at: Date.now()/1000, messages: [
  {id:1,role:'user',content:'Please check these files.'},
  ...Array.from({length:110}, (_, i) => [
    {id:i*2+2,role:'assistant',content:'',tool_calls:[{id:`call-${i}`,type:'function',function:{name:'terminal',arguments:JSON.stringify({command:`cat fixture-${i}.txt`})}}]},
    {id:i*2+3,role:'tool',tool_call_id:`call-${i}`,content:`Output ${i+1}\n${'File detail.\n'.repeat(60)}`}
  ]).flat(),
  {id:222,role:'assistant',content:'All files have been checked.'}
] });
rows.set('reading-links', {id:'reading-links',title:'Links for reading',source:'telegram',started_at:Date.now()/1000,messages:[{id:1,role:'assistant',content:'Read [first article](https://example.com/one), [second article](https://example.com/two) or the [first again](https://example.com/one).'}]});
rows.set('spaces-retry', { id: 'spaces-retry', title: 'Space retry conversation', source: 'telegram', started_at: Date.now()/1000, messages: [{ id: 1, role: 'assistant', content: 'A saved task destination.' }] });
rows.set('spaces-conversation', {id:'spaces-conversation',title:'Shared spaces conversation',source:'telegram',started_at:Date.now()/1000,messages:[{id:1,role:'assistant',content:'This conversation is shared across task spaces.'}]});
const runtimes = new Map<string, any>();
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://localhost'); res.setHeader('Content-Type', 'application/json');
  if (url.pathname === '/calls') return res.end(JSON.stringify(calls));
  if (req.headers['x-hermes-session-token'] !== 'fixture-token') { res.statusCode = 403; return res.end('{}'); }
  if (url.pathname === '/api/sessions') return res.end(JSON.stringify({ sessions: [...rows.values()], total: rows.size }));
  if (url.pathname === '/api/sessions/search') {
    const query = (url.searchParams.get('q') || '').toLowerCase();
    return res.end(JSON.stringify({ results: [...rows.values()].filter(row => `${row.title} ${JSON.stringify(row.messages)}`.toLowerCase().includes(query)).map(row => ({ session_id: row.id })) }));
  }
  const id = url.pathname.split('/')[3];
  if (url.pathname.endsWith('/messages')) { const all = rows.get(id)?.messages || [], offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 200); const start = url.searchParams.get('order') === 'latest' ? Math.max(0, all.length - offset - limit) : offset; const end = url.searchParams.get('order') === 'latest' ? Math.max(0, all.length - offset) : offset + limit; const messages = all.slice(start, end); return res.end(JSON.stringify({ session_id: id, profile: 'default', messages, pagination: { returned: messages.length } })); }
  if (url.pathname === '/api/audio/transcribe') return res.end(JSON.stringify({ transcript: 'Please draft a packing list.' }));
  res.statusCode = 404; res.end('{}');
});
const wss = new WebSocketServer({ server });
wss.on('connection', ws => {
  const emit = (type: string, id?: string, payload: any = {}) => {
    const r = id && runtimes.get(id); const event = { type, session_id: id, payload, ...(r ? { seq: ++r.seq } : {}) }; if (r) r.events.push(event);
    if (ws.readyState === 1) ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: event }));
  };
  emit('gateway.ready', undefined, { replay_epoch: 'fixture-epoch' });
  const finish = (id: string) => { const r = runtimes.get(id); r.running = false; r.approvals = []; const text = 'Here is your answer. Your work continued after leaving the app.'; rows.get(r.stored).messages.push({ id: Date.now(), role: 'assistant', content: text, timestamp: Date.now()/1000 }); emit('message.complete', id, { status: 'complete', text }); emit('session.info', id); };
  ws.on('message', raw => {
    const { id, method, params: p } = JSON.parse(raw.toString()); calls.push(method); let result: any = {};
    const r = runtimes.get(p.session_id);
    if (method === 'session.create' || method === 'session.resume') {
      const stored = p.session_id || `stored-${rows.size}`, runtime = `runtime-${stored}`;
      if(stored==='resume-failure') { ws.send(JSON.stringify({jsonrpc:'2.0',id,error:{code:5001,message:'Preparation could not be confirmed.'}})); return; }
      if (!rows.has(stored)) rows.set(stored, { id: stored, title: p.title, source: 'desktop', started_at: Date.now()/1000, messages: [] });
      if (!runtimes.has(runtime)) runtimes.set(runtime, { stored, running: false, seq: 0, events: [], approvals: [] });
      const resumed=runtimes.get(runtime);
      if(stored==='resume-busy') {resumed.running=true;emit('message.start',runtime);emit('message.delta',runtime,{text:'Resuming earlier work.'});}
      result = { session_id: runtime, stored_session_id: stored, session_key: stored, info: { profile_name: 'default' }, messages_omitted: true, resumed: true, running: resumed.running, inflight: null, status: resumed.running?'working':'idle',...(resumed.running?{auto_continue:{attempt:1}}:{}) };
    } else if (method === 'session.title') result = { title: p.title, pending: false };
    else if (method === 'session.activate') result = { session_id: p.session_id, session_key: r.stored, info: { profile_name: 'default' }, running: r.running, status: r.running ? 'working' : 'idle',queued:r.queued?{text:r.queued}:undefined };
    else if (method === 'approval.pending') result = { approvals: r.approvals };
    else if (method === 'session.control.read') result = { control: {} };
    else if (method === 'session.events.since') result = { epoch: 'fixture-epoch', events: r.events.filter((e: any) => e.seq > p.last_seen), latest_seq: r.seq, truncated: false };
    else if (method === 'file.attach') result = { ref_text: `@file:/tmp/${p.name}`, path: `/tmp/${p.name}` };
    else if (method === 'prompt.submit') {
      if (p.text.startsWith('Live transcript')) {
        r.running = true; emit('message.start', p.session_id);
        // Accept before the durable transcript catches up; exercise tool-only
        // rounds with no assistant text and a long-running response.
        setTimeout(() => emit('tool.start', p.session_id, { name: 'terminal' }), 200);
        setTimeout(() => rows.get(r.stored).messages.push({ id: Date.now(), role: 'user', content: p.text, timestamp: Date.now()/1000 }), 2500);
        const round = (n: number) => { const callId = `live-call-${n}`, at=Date.now(); rows.get(r.stored).messages.push(
          { id: at, role: 'assistant', content: '', tool_calls: [{ id: callId, type: 'function', function: { name: 'terminal', arguments: JSON.stringify({ command: `check step ${n}` }) } }], timestamp: at/1000 },
          { id: at+1, role: 'tool', tool_call_id: callId, content: `Step ${n} finished.\n${'Saved tool detail.\n'.repeat(40)}`, timestamp: at/1000 }); emit('tool.end',p.session_id,{name:'terminal'}); };
        setTimeout(() => round(1), 3300); setTimeout(() => round(2), 6500);
        setTimeout(() => finish(p.session_id), 14000);
        ws.send(JSON.stringify({jsonrpc:'2.0',id,result:{status:'streaming'}})); return;
      }

      if(r.stored==='resume-busy') {
        r.queued=p.text;
        setTimeout(()=>{r.running=false;emit('message.complete',p.session_id,{status:'interrupted',text:'Earlier work stopped.'});emit('session.info',p.session_id);},200);
        setTimeout(()=>{r.running=true;r.queued=undefined;rows.get(r.stored).messages.push({id:Date.now(),role:'user',content:p.text});emit('message.start',p.session_id);emit('message.delta',p.session_id,{text:'Working on your new message.'});setTimeout(()=>finish(p.session_id),1200);},900);
        ws.send(JSON.stringify({jsonrpc:'2.0',id,result:{status:'queued'}})); return;
      }
      r.running = true; rows.get(r.stored).messages.push({ id: Date.now(), role: 'user', content: p.text, timestamp: Date.now()/1000 }); emit('message.start', p.session_id); emit('message.delta', p.session_id, { text: 'Here is your answer.' });
      if (p.text.includes('ask approval')) { r.approvals = [{ request_id: `approval-${id}`, command: 'echo approved', description: 'Allow this command?' }]; emit('approval.request', p.session_id, r.approvals[0]); }
      else if (p.text !== 'Standalone wait for stop') setTimeout(() => finish(p.session_id), 1800);
      result = { status: 'streaming' };
    } else if (method === 'approval.respond') { r.approvals = []; result = { resolved: 1 }; setTimeout(() => finish(p.session_id), 100); }
    else if (method === 'session.interrupt') { result = { status: 'interrupted' }; setTimeout(() => { r.running = false; emit('message.complete', p.session_id, { status: 'interrupted' }); emit('session.info', p.session_id); }, 300); }
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, result }));
  });
});
await new Promise<void>(resolve => server.listen(8791, '127.0.0.1', resolve));
// Push traffic is simulated inside this isolated fixture, never sent to a vendor.
let pushStatus=201;
const pushCalls:{id:string;kind:string}[]=[];
webpush.sendNotification=async(_subscription,payload)=>{
  pushCalls.push(JSON.parse(String(payload)));
  if(pushStatus!==201)throw Object.assign(new Error('Fixture push failure'),{statusCode:pushStatus});
  return {statusCode:201,headers:{},body:''};
};
const { app, articles, store } = await createApp({ dataDir: await mkdtemp('/tmp/herts-browser-'), origin: 'http://127.0.0.1:8790', identity: 'fixture', dev: true, hermesBase: 'http://127.0.0.1:8791', hermesToken: 'fixture-token' });
// Simulate a client on a previous release without intercepting browser traffic
// while real service workers install and take control. Their cached index stays new.
app.get('/', async (req, reply) => {
  let html = await readFile('dist/index.html', 'utf8');
  if (req.headers.cookie?.split(';').some(c => c.trim() === 'fixture-old-page=1')) {
    html = html.replace(/(<meta name="herts-build" content=")[^"]+/, '$1tasks-shell-fixture-previous');
    reply.header('Set-Cookie', 'fixture-old-page=; Max-Age=0; Path=/');
  }
  return reply.header('Cache-Control', 'no-store').type('text/html').send(html);
});
app.get('/__test/old-sw.js',async(_req,reply)=>reply.type('application/javascript').header('Service-Worker-Allowed','/').send("self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));"));
app.get('/__test/failed-sw.js',async(_req,reply)=>reply.type('application/javascript').header('Service-Worker-Allowed','/').send("self.addEventListener('install',event=>event.waitUntil(Promise.reject(new Error('Fixture install failure'))));"));
app.post('/__test/push-status',async req=>{pushStatus=(req.body as {status:number}).status;return{ok:true};});
app.get('/__test/push-calls',async()=>pushCalls);
// Isolated browser-fixture clock control; this route is never in the app server.
app.post('/__test/wake-snoozed', async req => { const at = (req.body as { at: number }).at; return { woke: store.wakeSnoozed(at), notices: store.db.prepare("SELECT id, task_id FROM notices WHERE kind='reminder'").all() }; });
articles.fetchHtml = async url => ({ url, html: `<html><head><title>Fixture article</title></head><body><article><h1>Fixture article</h1>${Array.from({length:8},(_,i)=>`<p>Article paragraph ${i}. ${'A detailed and useful piece of writing for offline reading. '.repeat(12)}</p>`).join('')}</article></body></html>` });
await app.listen({ host: '127.0.0.1', port: 8790 });
process.on('SIGTERM', () => { void app.close().then(() => { wss.close(); server.close(); process.exit(0); }); });
