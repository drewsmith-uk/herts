import { BotBackend } from './bots-fixture';
import webpush from 'web-push';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, cp, mkdir, rm } from 'node:fs/promises';
import { WebSocketServer } from 'ws';
import { createApp } from '../server/app';
const browserRoot = process.env.HERTS_BROWSER_ROOT || process.env.TASKS_BROWSER_ROOT;
if (browserRoot) process.chdir(browserRoot);
const botBackend = new BotBackend();
const calls: string[] = [];
const callDetails: { method: string; params: any }[] = [];
const profileSettings = { model: 'profile-model', provider: 'configured', reasoning_effort: 'medium', fast: false, cwd: '/projects' };
const info = (r: any) => ({ profile_name: 'default', ...r.settings });
const rows = new Map<string, any>([['existing', { id: 'existing', title: 'Plan the autumn trip', source: 'telegram', preview: 'A quiet week away', started_at: Date.now()/1000, messages: [{ id: 1, role: 'user', content: 'Help me plan a trip.' }, { id: 2, role: 'assistant', content: 'We could visit the coast.\n\nA slower pace sounds good.' }] }]]);
rows.set('task-preview', { ...rows.get('existing'), id: 'task-preview', title: 'Preview conversion example', messages: structuredClone(rows.get('existing').messages) });
rows.set('long-history', { id: 'long-history', title: 'Long conversation', source: 'desktop', started_at: Date.now()/1000, messages: Array.from({length:450}, (_, i) => ({id:i+1,role:i%2 ? 'assistant' : 'user',content:`History message ${i+1}. ${'Conversation detail. '.repeat(8)}`})) });
for (const width of [390,1280]) rows.set(`unified-history-${width}`, { ...rows.get('long-history'), id: `unified-history-${width}`, title: `Reviewed history ${width}`, messages: structuredClone(rows.get('long-history').messages) });
for (const width of [390,1280]) rows.set(`live-history-${width}`, { ...rows.get('long-history'), id: `live-history-${width}`, title: `Live history ${width}`, messages: structuredClone(rows.get('long-history').messages) });
rows.set('header-history', { ...rows.get('long-history'), id: 'header-history', title: 'Header conversation' });
for (const width of [390,1280,'fieldwork','press','nocturne']) rows.set(`controls-${width}`, { ...rows.get('long-history'), id: `controls-${width}`, title: `Conversation controls ${width}`, messages: [...structuredClone(rows.get('long-history').messages), { id: 451, role: 'assistant', content: `Read [the article](https://example.com/controls-${width}).` }] });
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
rows.set('background-activity', { id: 'background-activity', title: 'Background review', source: 'desktop', started_at: Date.now()/1000, messages: [
  {id:1,role:'user',content:'Please review the changes.'},
  {id:2,role:'assistant',content:'The background review is running.'},
  {id:3,role:'user',display_kind:'async_delegation_complete',content:'[ASYNC DELEGATION BATCH COMPLETE — fixture]\n\nThe background review found no issues.',timestamp:1800000000},
  {id:4,role:'assistant',content:'',tool_calls:[{id:'review-check',type:'function',function:{name:'terminal',arguments:'{}'}}]},
  {id:5,role:'tool',tool_call_id:'review-check',content:'All checks passed.'},
  {id:6,role:'assistant',content:'The review is complete.'},
  {id:7,role:'user',display_kind:'process_complete',content:'The background process finished successfully.'},
  {id:8,role:'user',content:'[ASYNC DELEGATION BATCH COMPLETE — pasted]\nWhat does this notice mean?'}
] });
rows.set('reading-links', {id:'reading-links',title:'Links for reading',source:'telegram',started_at:Date.now()/1000,messages:[{id:1,role:'assistant',content:'Read [first article](https://example.com/one), [second article](https://example.com/two) or the [first again](https://example.com/one).'}]});
rows.set('spaces-retry', { id: 'spaces-retry', title: 'Space retry conversation', source: 'telegram', started_at: Date.now()/1000, messages: [{ id: 1, role: 'assistant', content: 'A saved task destination.' }] });
rows.set('spaces-conversation', {id:'spaces-conversation',title:'Shared spaces conversation',source:'telegram',started_at:Date.now()/1000,messages:[{id:1,role:'assistant',content:'This conversation is shared across task spaces.'}]});
for (const id of ['settings-390', 'settings-1280', 'settings-shared', 'settings-confirm', 'settings-offline']) rows.set(id, { id, title: id, source: 'telegram', started_at: Date.now()/1000, settings: { ...profileSettings, model: 'existing-model', reasoning_effort: 'high', cwd: '/projects/existing' }, messages: [{ id: 1, role: 'assistant', content: 'A saved [article](https://example.com/settings-shared).' }] });
rows.get('settings-confirm').messages = structuredClone(rows.get('long-history').messages);
const runtimes = new Map<string, any>();
const liveTranscriptSteps = new Map<string, { next: () => void; finish: () => void }>();
let hermesUnavailable = false;
let modernPrompts = false;
// Playwright reuses its fixture-probe connection across long UI interactions.
// Keep it until the client closes it, avoiding a race with Node's idle timeout.
const server = createServer({ keepAliveTimeout: 0 }, async (req, res) => {
  const url = new URL(req.url!, 'http://localhost'); res.setHeader('Content-Type', 'application/json');
  if (url.pathname === '/calls') return res.end(JSON.stringify(calls));
  if (url.pathname === '/call-details') return res.end(JSON.stringify(callDetails));
  if (req.headers['x-hermes-session-token'] !== 'fixture-token') { res.statusCode = 403; return res.end('{}'); }
  if (hermesUnavailable) { res.statusCode = 503; return res.end('{}'); }
  if (botBackend.ownsHttp(url)) {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    try { return res.end(JSON.stringify(await botBackend.http(url.pathname + url.search, chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined, req.method))); }
    catch { res.statusCode = 404; return res.end('{}'); }
  }
  if (url.pathname === '/api/sessions') return res.end(JSON.stringify({ sessions: [...rows.values()], total: rows.size }));
  if (url.pathname === '/api/sessions/search') {
    const query = (url.searchParams.get('q') || '').toLowerCase();
    return res.end(JSON.stringify({ results: [...rows.values()].filter(row => `${row.title} ${JSON.stringify(row.messages)}`.toLowerCase().includes(query)).map(row => ({ session_id: row.id })) }));
  }
  if (url.pathname === '/api/files') { const path = url.searchParams.get('path') || '/projects'; if (path === '/missing') { res.statusCode = 404; return res.end(JSON.stringify({ detail: 'Folder not found' })); } return res.end(JSON.stringify({ path, parent: path === '/projects' ? null : '/projects', entries: path === '/projects' ? [{ name: 'work', path: '/projects/work', is_directory: true }, { name: 'private.txt', path: '/projects/private.txt', is_directory: false }] : [] })); }
  const id = url.pathname.split('/')[3];
  if (req.method === 'GET' && url.pathname === `/api/sessions/${id}` && rows.has(id)) { const row = rows.get(id), settings = row.settings || profileSettings; return res.end(JSON.stringify({ ...row, profile: 'default', model: settings.model, cwd: settings.cwd, model_config: { provider: settings.provider, reasoning_config: { effort: settings.reasoning_effort }, service_tier: settings.fast ? 'priority' : 'normal' } })); }
  if (req.method === 'PATCH' && url.pathname.startsWith('/api/sessions/')) {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const { title, profile } = JSON.parse(Buffer.concat(chunks).toString());
    const row = rows.get(id), duplicate = [...rows.values()].find(other => other.id !== id && other.title === title);
    if (!row || profile !== 'default') { res.statusCode = 404; return res.end('{}'); }
    if (duplicate) { res.statusCode = 400; return res.end(JSON.stringify({ detail: `Title '${title}' is already in use by session ${duplicate.id}` })); }
    row.title = title; return res.end(JSON.stringify({ ok: true, title }));
  }
  if (url.pathname.endsWith('/messages')) { const all = rows.get(id)?.messages || [], offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 200); const start = url.searchParams.get('order') === 'latest' ? Math.max(0, all.length - offset - limit) : offset; const end = url.searchParams.get('order') === 'latest' ? Math.max(0, all.length - offset) : offset + limit; const messages = all.slice(start, end); return res.end(JSON.stringify({ session_id: id, profile: 'default', messages, pagination: { returned: messages.length } })); }
  if (url.pathname === '/api/audio/transcribe') return res.end(JSON.stringify({ transcript: 'Please draft a packing list.' }));
  res.statusCode = 404; res.end('{}');
});
const wss = new WebSocketServer({ server });
wss.on('connection', ws => {
  if (hermesUnavailable) { ws.close(); return; }
  const modern = modernPrompts; let promptCapable = false;
  const emit = (type: string, id?: string, payload: any = {}) => {
    const r = id && runtimes.get(id); const event = { type, session_id: id, payload, ...(r ? { seq: ++r.seq } : {}) }; if (r) r.events.push(event);
    if (ws.readyState === 1) ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: event }));
  };
  emit('gateway.ready', undefined, { replay_epoch: 'fixture-epoch' });
  const finish = (id: string) => { const r = runtimes.get(id); r.running = false; r.approvals = []; const text = 'Here is your answer. Your work continued after leaving the app.'; rows.get(r.stored).messages.push({ id: Date.now(), role: 'assistant', content: text, timestamp: Date.now()/1000 }); emit('message.complete', id, { status: 'complete', text }); emit('session.info', id, info(r)); };
  const prompt = (sid: string, method: string, params: any) => {
    if (!promptCapable) throw new Error('Fixture client failed to negotiate prompts before starting work');
    const r = runtimes.get(sid), frame = { id: `srq-${crypto.randomUUID()}`, method, params: { session_id: sid, ...params } };
    (r.openRequests ||= []).push(frame); ws.send(JSON.stringify({ jsonrpc: '2.0', ...frame }));
    return frame;
  };
  ws.on('message', raw => {
    const frame = JSON.parse(raw.toString());
    const { id, method, params: p } = frame;
    if (!method) {
      callDetails.push({ method: 'server-response', params: frame });
      for (const [sid, r] of runtimes) if (r.openRequests?.some((q: any) => q.id === id)) { r.openRequests = r.openRequests.filter((q: any) => q.id !== id); setTimeout(() => finish(sid), 100); }
      return;
    }
    calls.push(method); callDetails.push({ method, params: p }); let result: any = {};
    if (method === 'client.capabilities') {
      promptCapable = modern && p.server_requests === true;
      ws.send(JSON.stringify({ id, ...(modern ? { result: { server_requests: ['approval', 'clarify', 'sudo'] } } : { error: { code: -32601, message: 'Method not found' } }) })); return;
    }
    if (method === 'request.answer') {
      const entry = [...runtimes.entries()].find(([, r]) => r.openRequests?.some((q: any) => q.id === p.id));
      if (entry) { const [sid, r] = entry; r.openRequests = r.openRequests.filter((q: any) => q.id !== p.id); r.approvals = []; r.clarification = undefined; setTimeout(() => finish(sid), 100); }
      ws.send(JSON.stringify({ id, result: { status: entry ? 'ok' : 'expired' } })); return;
    }
    if (botBackend.owns(method, p)) {
      void botBackend.rpc(method, p).then(result => {
        if (ws.readyState !== 1) return;
        ws.send(JSON.stringify({ jsonrpc: '2.0', id, result }));
        if (method === 'prompt.submit') setTimeout(() => {
          if (ws.readyState === 1) ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'message.complete', session_id: p.session_id, seq: Date.now(), payload: { status: 'complete' } } }));
        }, 80);
      }).catch(error => { if (ws.readyState === 1) ws.send(JSON.stringify({ jsonrpc: '2.0', id, error: { code: 4002, message: error.message } })); });
      return;
    }
    const r = runtimes.get(p.session_id);
    if (!r && ['session.activate','session.events.since','approval.pending','session.control.read','session.interrupt'].includes(method)) {
      ws.send(JSON.stringify({jsonrpc:'2.0',id,error:{code:4001,message:'session not found'}})); return;
    }
    if (method === 'session.create' || method === 'session.resume') {
      const stored = p.session_id || `stored-${rows.size}`, runtime = `runtime-${stored}`;
      if(stored==='resume-failure') { ws.send(JSON.stringify({jsonrpc:'2.0',id,error:{code:5001,message:'Preparation could not be confirmed.'}})); return; }
      if (!rows.has(stored)) rows.set(stored, { id: stored, title: p.title, source: 'desktop', started_at: Date.now()/1000, settings: { ...profileSettings, ...Object.fromEntries(['model', 'provider', 'reasoning_effort', 'fast', 'cwd'].filter(k => p[k] !== undefined).map(k => [k, p[k]])) }, messages: [] });
      if (!runtimes.has(runtime)) runtimes.set(runtime, { stored, running: false, seq: 0, events: [], approvals: [], settings: rows.get(stored).settings ||= { ...profileSettings } });
      const resumed=runtimes.get(runtime);
      if(stored==='resume-busy') {resumed.running=true;emit('message.start',runtime);emit('message.delta',runtime,{text:'Resuming earlier work.'});}
      result = { session_id: runtime, stored_session_id: stored, session_key: stored, info: info(resumed), messages_omitted: true, resumed: true, running: resumed.running, inflight: null, status: resumed.running?'working':'idle',...(resumed.running?{auto_continue:{attempt:1}}:{}) };
    } else if (method === 'session.title') {
      const duplicate = [...rows.values()].find(row => row.id !== r.stored && row.title === p.title);
      if (duplicate) { ws.send(JSON.stringify({ jsonrpc: '2.0', id, error: { code: 4022, message: `Title '${p.title}' is already in use by session ${duplicate.id}` } })); return; }
      rows.get(r.stored).title = p.title; result = { title: p.title, pending: false };
    }
    else if (method === 'model.options') result = { model: profileSettings.model, provider: profileSettings.provider, providers: [{ slug: 'configured', name: 'Configured provider', authenticated: true, models: ['profile-model', 'existing-model', 'chosen-model', 'confirm-model', 'simple-model'], capabilities: Object.fromEntries(['profile-model', 'existing-model', 'chosen-model', 'confirm-model', 'simple-model'].map(model => [model, { reasoning: model !== 'simple-model', fast: model !== 'simple-model', can_disable_reasoning: true }])) }] };
    else if (method === 'config.get') result = p.key === 'reasoning' ? { value: profileSettings.reasoning_effort } : p.key === 'fast' ? { value: profileSettings.fast ? 'fast' : 'normal' } : { cwd: profileSettings.cwd };
    else if (method === 'config.set') {
      // Hermes tokenizes by whitespace; quotes remain part of model/provider names.
      const modelArgs = p.key === 'model' ? p.value.split(/\s+/) : [];
      if (p.key === 'model' && (modelArgs.length !== 4 || modelArgs[1] !== '--provider' || modelArgs[2] !== 'configured' || modelArgs[3] !== '--session')) {
        ws.send(JSON.stringify({ jsonrpc: '2.0', id, error: { code: 5001, message: `Unknown provider '${modelArgs[2]}'. Check 'hermes model' for available providers, or define it in config.yaml under 'providers:'.` } })); return;
      }
      if (p.key === 'model' && p.value.includes('confirm-model') && !p.confirm_expensive_model) result = { confirm_required: true, confirm_message: 'This model switch needs confirmation from Hermes.' };
      else { if (p.key === 'model') { r.settings.model = modelArgs[0]; r.settings.provider = modelArgs[2]; r.settings.reasoning_effort = 'medium'; r.settings.fast = false; } if (p.key === 'reasoning') r.settings.reasoning_effort = p.value; if (p.key === 'fast') r.settings.fast = p.value === 'fast'; result = { value: p.key === 'model' ? r.settings.model : p.value, scope: 'session' }; emit('session.info', p.session_id, info(r)); }
    }
    else if (method === 'session.cwd.set') { r.settings.cwd = p.cwd; result = info(r); emit('session.info', p.session_id, info(r)); }
    else if (method === 'session.activate') result = { session_id: p.session_id, session_key: r.stored, info: info(r), running: r.running, pending_clarify: r.clarification, ...(modern && r.openRequests?.length ? { open_requests: r.openRequests } : {}), status: r.running ? 'working' : 'idle',queued:r.queued?{text:r.queued}:undefined };
    else if (method === 'approval.pending') result = { approvals: r.approvals };
    else if (method === 'session.control.read') result = { control: {} };
    else if (method === 'session.events.since') result = { epoch: 'fixture-epoch', events: r.events.filter((e: any) => e.seq > p.last_seen), ...(modern && r.openRequests?.length ? { open_requests: r.openRequests } : {}), latest_seq: r.seq, truncated: false };
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
        setTimeout(() => round(1), 3300);
        // Let the test expand the first round before introducing the next one.
        // Fixed timers can race browser rendering on a busy CI worker.
        let advanced = false;
        liveTranscriptSteps.set(r.stored, {
          next: () => { if (!advanced) { advanced = true; round(2); } },
          finish: () => { finish(p.session_id); liveTranscriptSteps.delete(r.stored); },
        });
        ws.send(JSON.stringify({jsonrpc:'2.0',id,result:{status:'streaming'}})); return;
      }

      if(r.stored==='resume-busy') {
        r.queued=p.text;
        setTimeout(()=>{r.running=false;emit('message.complete',p.session_id,{status:'interrupted',text:'Earlier work stopped.'});emit('session.info',p.session_id);},200);
        setTimeout(()=>{r.running=true;r.queued=undefined;rows.get(r.stored).messages.push({id:Date.now(),role:'user',content:p.text});emit('message.start',p.session_id);emit('message.delta',p.session_id,{text:'Working on your new message.'});setTimeout(()=>finish(p.session_id),1200);},900);
        ws.send(JSON.stringify({jsonrpc:'2.0',id,result:{status:'queued'}})); return;
      }
      r.running = true; rows.get(r.stored).messages.push({ id: Date.now(), role: 'user', content: p.text, timestamp: Date.now()/1000 }); emit('message.start', p.session_id); emit('message.delta', p.session_id, { text: 'Here is your answer.' });
      if (p.text.includes('ask approval')) { r.approvals = [{ request_id: `approval-${id}`, command: 'echo approved', description: 'Allow this command?' }]; if (modern) {
          const q = prompt(p.session_id, 'approval', { ...r.approvals[0], choices: ['once', 'deny'] });
          if (p.text.includes('expire')) setTimeout(() => { r.openRequests = r.openRequests.filter((x: any) => x.id !== q.id); r.approvals = []; emit('request.cancel', p.session_id, { id: q.id, method: 'approval', reason: 'timeout' }); finish(p.session_id); }, 3000);
        } else emit('approval.request', p.session_id, r.approvals[0]); }
      else if (modern && p.text.includes('ask batch')) prompt(p.session_id, 'clarify', { questions: [{ qid: 'a', question: 'Which folder?', choices: ['Home', 'Work'] }, { qid: 'b', question: 'Which checks?', choices: ['Files', 'Storage'], multi_select: true }], answers: { a: 'Work' } });
      else if (modern && p.text.includes('ask unsupported')) prompt(p.session_id, 'sudo', { command: 'fixture command' });
      else if (modern && p.text.includes('ask preview read')) prompt(p.session_id, 'preview.read', { start: 0, count: 1000 });
      else if (p.text.includes('ask clarification')) { r.clarification = { request_id: `question-${id}`, question: 'Which detail should I check first?' }; if (modern) prompt(p.session_id, 'clarify', { question: r.clarification.question, choices: ['Article', 'Notes'] }); else emit('session.info', p.session_id, info(r)); }
      else if (p.text === 'Report a failed run') { r.running = false; emit('message.complete', p.session_id, { status: 'error' }); emit('session.info', p.session_id, info(r)); }
      else if (p.text !== 'Standalone wait for stop') setTimeout(() => finish(p.session_id), 1800);
      result = { status: 'streaming' };
    } else if (method === 'approval.respond') { r.approvals = []; result = { resolved: 1 }; setTimeout(() => finish(p.session_id), 100); }
    else if (method === 'clarify.respond') { r.clarification = undefined; result = { resolved: 1 }; setTimeout(() => finish(p.session_id), 100); }
    else if (method === 'session.interrupt') { result = { status: 'interrupted' }; setTimeout(() => { r.running = false; emit('message.complete', p.session_id, { status: 'interrupted' }); emit('session.info', p.session_id); }, 300); }
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, result }));
  });
});
await new Promise<void>(resolve => server.listen(8791, '127.0.0.1', resolve));
// Push traffic is simulated inside this isolated fixture, never sent to a vendor.
let pushStatus=201;
let pushFailureKind:string|undefined;
const pushCalls:{id:string;kind:string}[]=[];
webpush.sendNotification=async(_subscription,payload)=>{
  const notice=JSON.parse(String(payload));pushCalls.push(notice);
  if(pushStatus!==201&&(!pushFailureKind||notice.kind===pushFailureKind))throw Object.assign(new Error('Fixture push failure'),{statusCode:pushStatus});
  return {statusCode:201,headers:{},body:''};
};
const fixtureRoot=await mkdtemp('/tmp/herts-browser-');
const themesDir=fixtureRoot+'/themes';await mkdir(themesDir);
const pluginsDir=fixtureRoot+'/plugins';await mkdir(pluginsDir);
for(const id of ['tasks','reading','bots'])await cp('plugins/'+id,pluginsDir+'/'+id,{recursive:true});
const { app, articles, store, plugins, gateway } = await createApp({ staticDir: process.env.HERTS_TEST_DIST_DIR, dataDir: fixtureRoot+'/data', pluginsDir, themesDir, origin: 'http://127.0.0.1:8790', identity: 'fixture', dev: true, hermesBase: 'http://127.0.0.1:8791', hermesToken: 'fixture-token' });
app.post('/__test/prompt-protocol', async req => {
  modernPrompts = (req.body as { modern: boolean }).modern;
  for (const ws of wss.clients) ws.terminate();
  return { ok: true };
});
// Recovery fixtures never affect a real Hermes instance or submit agent work.
app.post('/__test/live-transcript/:id/:step', async (req, reply) => {
  const { id, step } = req.params as { id: string; step: string };
  const run = liveTranscriptSteps.get(id);
  if (!run || !['next', 'finish'].includes(step)) return reply.code(404).send({ error: 'Fixture step unavailable' });
  run[step as 'next' | 'finish'](); return { ok: true };
});
app.post('/__test/saved-message', async req => {
  const { contextId, text, uploadIds = [], submitted = false } = req.body as { contextId: string; text: string; uploadIds?: string[]; submitted?: boolean };
  const action = { id: crypto.randomUUID(), taskId: contextId, kind: 'send' as const, text, uploadIds, createdAt: Date.now(), updatedAt: Date.now(), state: 'unknown' as const, phase: 'unknown', receipt: 'unknown' as const, sendStage: submitted ? 'submitted' as const : 'preparing' as const };
  store.saveAction(action); return { action };
});
app.post('/__test/missing-setup', async req => {
  const { id, submitted = false } = req.body as { id: string; submitted?: boolean };
  const context = store.openConversation({ key: id, storedId: id, title: 'Saved reading conversation', source: 'desktop' }, [id]);
  store.saveBinding(context.id, { runtimeId: `missing-${id}`, storedId: id, epoch: gateway.epoch, generation: crypto.randomUUID(), seq: 0, ready: false, known: false, monitored: false, unavailable: true });
  const action = { id: crypto.randomUUID(), taskId: context.id, kind: 'send' as const, text: 'The original saved message', uploadIds: [], createdAt: Date.now(), updatedAt: Date.now(), state: 'unknown' as const, receipt: 'unknown' as const, phase: 'setup failed', sendStage: submitted ? 'submitting' as const : 'preparing' as const, errorCode: 404, error: 'The linked Hermes session could not be found. Your saved messages are still available.' };
  store.saveAction(action); gateway.metadata = undefined;
  return { contextId: context.id, actionId: action.id };
});
app.post('/__test/stale-stop', async req => {
  const { id, completed = true } = req.body as { id: string; completed?: boolean };
  const title = `Expired conversation ${id}`;
  rows.set(id,{id,title,source:'desktop',started_at:Date.now()/1000,messages:[{id:1,role:'user',content:'The original request.'},{id:2,role:'assistant',content:completed?'The original work is complete.':'The last saved progress update.'}]});
  const context=store.openConversation({key:id,storedId:id,title,source:'desktop'},[id]);
  const binding={runtimeId:`missing-${id}`,storedId:id,generation:crypto.randomUUID(),epoch:gateway.epoch,seq:1,ready:false,known:true,monitored:false};
  store.saveBinding(context.id,binding);
  const main={id:crypto.randomUUID(),taskId:context.id,kind:'send' as const,state:'running' as const,receipt:'accepted' as const,sendStage:'submitted' as const,phase:'working',text:'The original request.',uploadIds:[],createdAt:Date.now(),updatedAt:Date.now(),binding,...(completed?{terminal:'complete'}:{})};
  store.saveAction(main);
  for(let n=0;n<4;n++)store.saveAction({id:crypto.randomUUID(),taskId:context.id,targetId:main.id,kind:'stop',state:'failed',receipt:'rejected',phase:'saved',error:'session not found',text:'',uploadIds:[],createdAt:Date.now(),updatedAt:Date.now()});
  gateway.metadata=undefined;return {contextId:context.id,mainId:main.id,generation:binding.generation};
});
app.post('/__test/hermes-connection', async req => {
  hermesUnavailable = !(req.body as { online: boolean }).online;
  if (hermesUnavailable) for (const ws of wss.clients) ws.terminate();
  else void gateway.connect().catch(() => {});
  return { ok: true };
});
app.post('/__test/conversation-message', async req => {
  const { id, title, text } = req.body as { id: string; title: string; text: string };
  if (!rows.has(id)) rows.set(id, { id, title, source: 'telegram', started_at: Date.now()/1000, messages: [] });
  rows.get(id).messages.push({ id: Date.now(), role: 'assistant', content: text });
  if (!hermesUnavailable) gateway.metadata = undefined;
  return { ok: true };
});
await plugins.activate('tasks');await plugins.activate('reading');plugins.reorder(['tasks','conversations','reading','bots']);
// Simulate a client on a previous release without intercepting browser traffic
// while real service workers install and take control. Their cached index stays new.
app.get('/', async (req, reply) => {
  let html = await readFile((process.env.HERTS_TEST_DIST_DIR || 'dist') + '/index.html', 'utf8');
  if (req.headers.cookie?.split(';').some(c => c.trim() === 'fixture-old-page=1')) {
    html = html.replace(/(<meta name="herts-build" content=")[^"]+/, '$1tasks-shell-fixture-previous');
    reply.header('Set-Cookie', 'fixture-old-page=; Max-Age=0; Path=/');
  }
  return reply.header('Cache-Control', 'no-store').type('text/html').send(html);
});
app.get('/__test/old-sw.js',async(_req,reply)=>reply.type('application/javascript').header('Service-Worker-Allowed','/').send("self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));"));
app.get('/__test/failed-sw.js',async(_req,reply)=>reply.type('application/javascript').header('Service-Worker-Allowed','/').send("self.addEventListener('install',event=>event.waitUntil(Promise.reject(new Error('Fixture install failure'))));"));
// Theme files live only in this temporary fixture, never the installation folder.
app.post('/__test/theme-file',async req=>{const {content}=req.body as {content:string|null};if(content===null)await rm(themesDir+'/custom.json',{force:true});else await writeFile(themesDir+'/custom.json',content);return{ok:true};});
app.post('/__test/notes',async req=>{if((req.body as any).present)await cp('examples/notes',pluginsDir+'/notes',{recursive:true});else await rm(pluginsDir+'/notes',{recursive:true,force:true});await plugins.scan();return{ok:true};});
app.post('/__test/push-status',async req=>{const input=req.body as {status:number;kind?:string};pushStatus=input.status;pushFailureKind=input.kind;return{ok:true};});
app.get('/__test/push-calls',async()=>pushCalls);
// Isolated browser-fixture clock control; this route is never in the app server.
app.post('/__test/wake-snoozed', async req => { const at = (req.body as { at: number }).at; return { woke: store.wakeSnoozed(at), notices: store.db.prepare("SELECT id, task_id FROM notices WHERE kind='reminder'").all() }; });
// Keep delayed notification replies on the fixture server: browser interception
// can miss a request while the real service worker takes control of the page.
const notificationReplies = new Map<string, { started: number; gate: Promise<void>; release: () => void }>();
app.addHook('onSend', async (req, _reply, payload) => {
  const match = /^\/api\/v1\/notifications\/([^/?]+)$/.exec(req.url);
  const held = req.method === 'GET' && match ? notificationReplies.get(decodeURIComponent(match[1])) : undefined;
  if (held) { held.started++; await held.gate; }
  return payload;
});
app.post('/__test/notification-reply', async req => {
  const { id, hold } = req.body as { id: string; hold: boolean };
  notificationReplies.get(id)?.release(); notificationReplies.delete(id);
  if (hold) {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    notificationReplies.set(id, { started: 0, gate, release });
  }
  return { ok: true };
});
app.get('/__test/notification-reply/:id', async req => ({ started: notificationReplies.get((req.params as { id: string }).id)?.started || 0 }));
articles.fetchHtml = async url => ({ url, html: `<html><head><title>Fixture article</title></head><body><article><h1>Fixture article</h1>${Array.from({length:8},(_,i)=>`<p>Article paragraph ${i}. ${'A detailed and useful piece of writing for offline reading. '.repeat(12)}</p>`).join('')}</article></body></html>` });
await app.listen({ host: '127.0.0.1', port: 8790 });
process.on('SIGTERM', () => { for (const reply of notificationReplies.values()) reply.release(); void app.close().then(() => { wss.close(); server.close(); process.exit(0); }); });
