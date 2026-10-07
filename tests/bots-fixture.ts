/** Synthetic Hermes Bot Mode contract; never touches the user's Hermes home. */
export class BotBackend {
  profiles = new Map<string, any>([['default', { name: 'default', description: 'Main agent' }], ['research', { name: 'research', description: 'Research specialist' }]]);
  chats = new Map<string, any>();
  jobs = new Map<string, any[]>();
  calls: { method: string; params: any }[] = [];
  constructor() {
    for (const [name, row] of this.profiles) {
      Object.assign(row, { model: 'profile-model', provider: 'configured', ui_meta: { 'hermes-bots': { title: name === 'default' ? 'Hermes' : 'Researcher' } }, ui_meta_revisions: { 'hermes-bots': 0 } });
      this.chats.set(name, { id: 'bot-chat', profile: name, title: 'Bot Chat', source: 'desktop', hidden: true, messages: [{ id: 1, role: 'assistant', content: `Hello from ${name}.` }], _lineage_ids: ['bot-chat'] });
      this.jobs.set(name, [{ id: 'daily', name: `${name} briefing`, profile: name, profile_name: name, prompt: 'Write a short briefing.', schedule: { expr: '0 9 * * *' }, enabled: true, deliver: 'bot-chat', last_status: 'success' }]);
    }
  }
  owns(method: string, p: any) { return method.startsWith('profiles.') || method === 'session.list' || (p.profile && p.profile !== 'default') || p.title === 'Bot Chat' || String(p.session_id || '').startsWith('bot-'); }
  info(profile: string) { const p = this.profiles.get(profile); return { profile_name: profile, model: p.model, provider: p.provider, reasoning_effort: 'medium', fast: false, cwd: '/projects' }; }
  async rpc(method: string, p: any): Promise<any> {
    this.calls.push({ method, params: structuredClone(p) });
    const profile = p.profile || String(p.session_id || '').replace(/^bot-runtime:/, '') || 'default';
    const chat = this.chats.get(profile);
    if (method === 'profiles.list') return { bot_mode_protocol: true, profiles: [...this.profiles].map(([name, row]) => ({ ...row, canonical_session: this.chats.has(name) ? { id: 'bot-chat', resolved_id: this.chats.get(name).id, last_active: Date.now() / 1000, preview: `Hello from ${name}.` } : undefined })) };
    if (method === 'profiles.describe') { const row = this.profiles.get(p.name); return { name: p.name, soul: row.soul || '', description: row.description, model: { default: row.model, provider: row.provider } }; }
    if (method === 'profiles.get_asset') return { found: false };
    if (method === 'profiles.create') { if (this.profiles.has(p.name)) throw new Error('Profile already exists'); this.profiles.set(p.name, { name: p.name, description: p.description, soul: p.soul || '', model: p.model || 'profile-model', provider: p.provider || 'configured', ui_meta: {}, ui_meta_revisions: {} }); this.jobs.set(p.name, []); return { ok: true, name: p.name }; }
    if (method === 'profiles.configure') { const row = this.profiles.get(p.name); if (p.ui_meta_expected_revisions['hermes-bots'] !== (row.ui_meta_revisions['hermes-bots'] || 0)) return { ok: false, applied: { ui_meta: false } }; Object.assign(row, { description: p.description, ...(p.soul !== undefined ? { soul: p.soul } : {}), ...(p.model ? { model: p.model, provider: p.provider } : {}), ui_meta: p.ui_meta }); row.ui_meta_revisions['hermes-bots'] = (row.ui_meta_revisions['hermes-bots'] || 0) + 1; return { ok: true, applied: { ui_meta: true, description: true, soul: true, model: true } }; }
    if (method === 'session.list') return { sessions: chat ? [{ ...chat, resolved_id: chat.id }] : [] };
    if (method === 'session.create') { this.chats.set(profile, { id: 'bot-chat', profile, title: p.title, hidden: true, source: 'desktop', messages: [], _lineage_ids: ['bot-chat'] }); return { session_id: `bot-runtime:${profile}`, stored_session_id: 'bot-chat', info: this.info(profile) }; }
    if (method === 'session.title') return { title: 'Bot Chat', pending: false };
    if (method === 'session.resume') return { session_id: `bot-runtime:${profile}`, session_key: chat.id, info: this.info(profile), messages_omitted: true, running: false, status: 'idle' };
    if (method === 'session.activate') return { session_id: p.session_id, session_key: chat.id, info: this.info(profile), running: false };
    if (method === 'session.events.since') return { epoch: 'fixture-epoch', latest_seq: 0, events: [] };
    if (method === 'session.control.read') return { control: {} };
    if (method === 'approval.pending') return { approvals: [] };
    if (method === 'prompt.submit') { chat.messages.push({ id: chat.messages.length + 1, role: 'user', content: p.text }, { id: chat.messages.length + 2, role: 'assistant', content: `Answer from ${profile}.` }); return { status: 'streaming' }; }
    if (method === 'session.interrupt') return { interrupted: true };
    if (method === 'model.options') return { model: 'profile-model', provider: 'configured', providers: [{ slug: 'configured', authenticated: true, models: ['profile-model'], capabilities: { 'profile-model': { reasoning: true, fast: true } } }] };
    if (method === 'config.get') return { value: p.key === 'reasoning' ? 'medium' : 'normal', cwd: '/projects' };
    if (method === 'file.attach') return { ref_text: '@file:/tmp/synthetic.txt' };
    if (method === 'config.set') return { value: p.value };
    throw new Error(`Unsupported fixture method ${method}`);
  }
  ownsHttp(url: URL) { return url.pathname.startsWith('/api/cron/') || url.pathname === '/api/config' || url.searchParams.get('profile') && url.searchParams.get('profile') !== 'default' || /^\/api\/sessions\/bot-/.test(url.pathname); }
  async http(path: string, body?: any, method = body === undefined ? 'GET' : 'POST'): Promise<any> {
    const url = new URL(path, 'http://fixture'), profile = url.searchParams.get('profile') || 'default', chat = this.chats.get(profile);
    this.calls.push({ method: `${method} ${url.pathname}`, params: { profile, body } });
    if (url.pathname === '/api/config') return { timezone: 'Europe/London', provider_secret: 'must-not-reach-browser' };
    if (url.pathname === '/api/sessions') return { sessions: chat ? [chat] : [], total: chat ? 1 : 0 };
    if (url.pathname.endsWith('/messages')) return { session_id: chat.id, profile, messages: chat.messages, pagination: { returned: chat.messages.length } };
    if (url.pathname.startsWith('/api/sessions/')) return { ...chat, model: 'profile-model', model_config: { provider: 'configured' } };
    if (url.pathname === '/api/audio/speak') return { audio: 'synthetic', profile };
    if (url.pathname === '/api/audio/transcribe') return { transcript: `Dictated for ${profile}` };
    if (url.pathname === '/api/fs/read-data-url') return { dataUrl: 'data:text/plain;base64,SGVsbG8=' };
    if (url.pathname === '/api/files') return { path: '/projects', parent: null, entries: [] };
    const jobs = this.jobs.get(profile) || [];
    if (url.pathname === '/api/cron/jobs') {
      if (method === 'GET') return structuredClone(jobs);
      const job = { ...body, id: `job-${jobs.length}`, profile, profile_name: profile, enabled: true }; jobs.push(job); return job;
    }
    const id = decodeURIComponent(url.pathname.split('/')[4]), job = jobs.find(j => j.id === id);
    if (!job) throw new Error('Unknown fixture routine');
    if (url.pathname.endsWith('/runs')) return { runs: [{ id: 'run-1', title: job.name, profile, ended_at: 1, preview: 'A useful briefing.' }] };
    if (method === 'PUT') Object.assign(job, body.updates);
    if (method === 'DELETE') this.jobs.set(profile, jobs.filter(j => j.id !== id));
    if (url.pathname.endsWith('/pause')) job.enabled = false;
    if (url.pathname.endsWith('/resume') || url.pathname.endsWith('/trigger')) job.enabled = true;
    return structuredClone(job);
  }
}
