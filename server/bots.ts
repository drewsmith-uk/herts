import { z } from 'zod';
import { Gateway, GatewayError, personalSources } from './gateway.js';
import { digest, type Store } from './store.js';
import type { Actions } from './actions.js';
import type { ActionEffects, Bot, BotDetails, BotSettings, HermesServices, Routine, RoutineInput, RoutineRun } from '../shared/bots.js';
import type { ConversationContext } from '../shared/conversations.js';
import { Conflict, messageText } from '../shared/core.js';

const nameSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const settingsSchema = z.object({ name: nameSchema, title: z.string().trim().min(1).max(100), description: z.string().max(4000), soul: z.string().max(100000).optional(), model: z.string().max(1000).optional(), provider: z.string().max(1000).optional(), cloneFrom: nameSchema.optional(), mirrorCredentials: z.boolean().optional(), revision: z.number().int().nonnegative().optional(), hidden: z.boolean().optional() }).strict();
const scheduleText = (s: any): string => typeof s === 'string' ? s : s?.kind === 'once' ? s.run_at : s?.kind === 'interval' ? `every ${s.minutes}m` : s?.expr || s?.display || '';

export class Bots implements HermesServices {
  private routineChanges = new Map<string, Promise<unknown>>();
  private openings = new Map<string, Promise<ConversationContext>>();
  constructor(private store: Store, private gateway: Gateway, private actions: Actions) {}
  onChange(listener: () => void) {
    const event = (value: { type?: string }) => { if (['sessions.changed', 'profiles.changed', 'cron.changed', 'message.complete', 'session.info'].includes(value.type || '')) listener(); };
    this.gateway.on('event', event); this.gateway.on('connected', listener);
    return () => { this.gateway.off('event', event); this.gateway.off('connected', listener); };
  }
  private async roster(): Promise<any[]> {
    const r = await this.gateway.rpc('profiles.list', { include_sessions: true });
    if (!Array.isArray(r.profiles) || r.bot_mode_protocol !== true) throw new GatewayError('Update Hermes: this backend does not provide the required Bot Mode interface.');
    return r.profiles.filter((p: any) => nameSchema.safeParse(p.name).success);
  }
  private async owner(name: string) {
    nameSchema.parse(name);
    const row = (await this.roster()).find(p => p.name === name);
    if (!row) throw new GatewayError('This bot profile is no longer available.', false, 404);
    return row;
  }
  private bot(row: any): Bot {
    const meta = row.ui_meta?.['hermes-bots'] || {}, session = row.canonical_session;
    const context = this.store.contexts().find(c => c.botChat && c.profile === row.name);
    const active = context && this.store.actions(context.id).some(a => ['running', 'preparing', 'awaiting_input', 'stopping'].includes(a.state));
    return { name: row.name, title: String(meta.title || row.display_name || (row.name === 'default' ? 'Hermes' : row.name)), description: String(row.description || ''),
      model: String(row.model || ''), provider: String(row.provider || ''), hidden: !!meta.hidden, hasAvatar: !!row.has_avatar,
      contextId: context?.id, preview: String(session?.preview || ''), updatedAt: Number(session?.last_active || 0) * 1000,
      active: !!active || Number(row.worker_session?.last_active || 0) * 1000 > Date.now() - 90000 };
  }
  async bots() { return (await this.roster()).map(row => this.bot(row)); }
  async describeBot(name: string): Promise<BotDetails> {
    const row = await this.owner(name), detail = await this.gateway.rpc('profiles.describe', { name });
    if (detail.name !== name) throw new GatewayError('Profile identity could not be verified.');
    return { ...this.bot(row), soul: String(detail.soul || ''), model: String(detail.model?.default || ''), provider: String(detail.model?.provider || ''), revision: row.ui_meta_revisions?.['hermes-bots'] || 0 };
  }
  async botAvatar(name: string) {
    await this.owner(name);
    const r = await this.gateway.rpc('profiles.get_asset', { name, asset: 'avatar' });
    const data = r.data_url || r.data;
    return typeof data === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(data) && data.length < 3000000 ? data : undefined;
  }
  async models(name = this.gateway.defaultProfile) {
    await this.owner(name);
    return this.gateway.withProfile(name, async () => (await this.actions.settings.catalogueRead()).models.map(({ id, provider, providerName, available }) => ({ id, provider, providerName, available })));
  }
  async openBot(name: string, effects: ActionEffects) {
    const prior = this.openings.get(name); if (prior) return prior;
    const work = this.gateway.withProfile(name, () => this.openCanonical(name, effects));
    this.openings.set(name, work);
    try { return await work; } finally { this.openings.delete(name); }
  }
  private async openCanonical(name: string, effects: ActionEffects): Promise<ConversationContext> {
    const row = await this.owner(name);
    if (!row.ui_meta?.['hermes-bots']) {
      if (!row.ui_meta_revisions) throw new GatewayError('Update Hermes before registering this profile for Bot Mode.');
      const enrolled = await effects.effect('profile.enroll', () => this.gateway.rpc('profiles.configure', {
        name, ui_meta: { 'hermes-bots': { title: this.bot(row).title } }, ui_meta_expected_revisions: { 'hermes-bots': row.ui_meta_revisions['hermes-bots'] || 0 },
      }));
      if (enrolled.applied?.ui_meta !== true) throw new GatewayError('Bot Mode metadata was not saved. Refresh before opening the bot.');
    }
    const existingContext = this.store.contexts().find(c => c.profile === name && c.botChat);
    const lookup = async () => {
      const r = await this.gateway.rpc('session.list', { profile: name, title: 'Bot Chat', include_hidden: true, limit: 200 });
      if (!Array.isArray(r.sessions)) throw new GatewayError('The Bot Chat registry could not be verified.');
      const matches = r.sessions.filter((s: any) => s.title === 'Bot Chat');
      if (matches.length > 1 || matches.some((s: any) => s.profile && s.profile !== name)) throw new GatewayError('The Bot Chat identity is ambiguous.');
      if (matches.some((s: any) => !personalSources.includes(String(s.source || '').toLowerCase()) || s.room_plumbing)) throw new GatewayError('The Bot Chat source could not be verified.');
      return matches[0];
    };
    let chat = await lookup();
    const creationKey = `bot-chat-creation:${name}`;
    if (!chat) {
      if (row.canonical_session?.id || existingContext?.link) throw new GatewayError('The existing Bot Chat could not be found. Refresh after Hermes recovers; no replacement was created.');
      if (this.store.getMeta(creationKey)) throw new GatewayError('An earlier Bot Chat creation is unconfirmed. Open this bot in Hermes Desktop to reconcile it, then refresh here. No creation was repeated.', true);
      effects.check(); this.store.setMeta(creationKey, { actionId: effects.id });
      let created: any;
      try { created = await effects.effect('chat.create', () => this.gateway.rpc('session.create', { profile: name, source: 'desktop', title: 'Bot Chat', hidden: true, follow_profile_config: true, close_on_disconnect: false })); }
      catch (error) { if (error instanceof GatewayError && !error.uncertain) this.store.setMeta(creationKey, null); throw error; }
      if (!created.session_id || !created.stored_session_id || created.info?.profile_name !== name) throw new GatewayError('Bot Chat creation identity is unconfirmed.', true);
      try {
        const titled = await effects.effect('chat.title', () => this.gateway.rpc('session.title', { session_id: created.session_id, title: 'Bot Chat' }));
        if (titled.title !== 'Bot Chat' || titled.pending) throw new GatewayError('Hermes did not materialise the Bot Chat. Update Hermes before retrying.', true);
      } catch (e) {
        if (!(e instanceof GatewayError) || e.uncertain || !/already in use/i.test(e.message)) throw e;
        chat = await lookup(); if (!chat) throw e;
      }
      chat ||= await lookup();
      if (!chat) throw new GatewayError('Bot Chat creation could not be confirmed. Refresh before taking another action.', true);
    }
    effects.check();
    const id = this.gateway.ref(chat.resolved_id || chat.id, name), key = this.gateway.ref(chat.id, name);
    const aliases = [...new Set<string>([key, id, ...(chat.lineage_ids || chat._lineage_ids || []).map((s: string) => this.gateway.ref(s, name))])];
    if (existingContext?.link && !aliases.some(alias => existingContext.aliases.includes(alias))) throw new GatewayError('The permanent Bot Chat identity changed. Its saved conversation was retained; no replacement was linked.');
    const context = this.store.ensureContext({ profile: name, botChat: true, key, storedId: id, title: 'Bot Chat', source: 'desktop' }, aliases, existingContext?.id);
    const saved = this.store.saveContext({ ...context, title: this.bot(row).title, botChat: true, profile: name });
    this.store.setMeta(creationKey, null);
    this.store.bumpRevision(); this.store.emit('change', { type: 'contexts' });
    return saved;
  }
  async createBot(value: BotSettings, effects: ActionEffects) {
    const input = settingsSchema.parse(value);
    if ((await this.roster()).some(row => row.name === input.name)) throw new Conflict('That profile already exists. Open it from the roster.');
    if (input.cloneFrom) await this.owner(input.cloneFrom);
    const created = await effects.effect('profile.create', () => this.gateway.rpc('profiles.create', {
      name: input.name, description: input.description, ...(input.cloneFrom ? { clone_from: input.cloneFrom, clone_all: true, clone_channels: false } : {}),
      ...(input.soul ? { soul: input.soul } : {}), ...(input.model && input.provider ? { model: input.model, provider: input.provider } : {}),
      mirror_credentials: input.mirrorCredentials !== false, no_alias: true,
    }));
    if (!created.ok || created.name !== input.name) throw new GatewayError('Profile creation could not be confirmed. Refresh the roster.', true);
    await this.configureBot({ ...input, revision: undefined }, effects);
    const context = await this.openBot(input.name, effects);
    // The outer action is already durable; the core send has its own durable ID.
    await effects.effect('introduction', async () => this.actions.start({ id: effects.id, contextId: context.id, kind: 'send', text: 'Hey, tell me about yourself!' }));
    return context;
  }
  async configureBot(value: BotSettings, effects: ActionEffects) {
    const input = settingsSchema.parse(value), row = await this.owner(input.name);
    if (!row.ui_meta_revisions) throw new GatewayError('Update Hermes before editing bot metadata safely across devices.');
    const revision = row.ui_meta_revisions['hermes-bots'] || 0;
    if (input.revision !== undefined && input.revision !== revision) throw new Conflict('This bot changed in Hermes. Reload saved values in the editor before saving.');
    const result = await effects.effect('profile.configure', () => this.gateway.rpc('profiles.configure', {
      name: input.name, description: input.description, ...(input.soul !== undefined ? { soul: input.soul } : {}),
      ...(input.model && input.provider ? { model: input.model, provider: input.provider } : {}),
      ui_meta: { 'hermes-bots': { ...row.ui_meta?.['hermes-bots'], title: input.title, ...(input.hidden === undefined ? {} : { hidden: input.hidden }) } },
      ui_meta_expected_revisions: { 'hermes-bots': revision },
    }));
    const required = ['ui_meta', 'description', ...(input.soul !== undefined ? ['soul'] : []), ...(input.model && input.provider ? ['model'] : [])];
    if (result.confirm_required || required.some(key => result.applied?.[key] !== true)) throw new GatewayError(`Some profile changes were not applied. ${result.confirm_message || 'Reload the editor to inspect the saved values.'}`);
    effects.check();
    for (const c of this.store.contexts().filter(c => c.botChat && c.profile === input.name)) this.store.saveContext({ ...c, title: input.title });
    this.store.bumpRevision(); this.store.emit('change', { type: 'contexts' });
  }
  private async jobs(profile: string): Promise<any[]> {
    await this.owner(profile);
    const result = await this.gateway.http(`/api/cron/jobs?profile=${encodeURIComponent(profile)}`);
    if (!Array.isArray(result) || result.some(j => (j.profile_name || j.profile) !== profile)) throw new GatewayError('Hermes did not confirm routine profile ownership. Update Hermes before managing routines.');
    return result;
  }
  private routine(row: any, profile: string): Routine {
    return { revision: digest({name:row.name,prompt:row.prompt,schedule:scheduleText(row.schedule),deliver:row.deliver || 'local'}), id: String(row.id || row.job_id), profile, name: String(row.name || ''), prompt: String(row.prompt || ''), schedule: scheduleText(row.schedule), deliver: String(row.deliver || 'local'), enabled: row.enabled !== false && row.state !== 'paused', nextRun: row.next_run_at, lastRun: row.last_run_at, status: row.last_status, error: row.last_error || row.last_delivery_error || row.last_fire_error };
  }
  async routines(profile: string) {
    const rows = await this.jobs(profile);
    let timezone = 'Hermes server timezone';
    try { const cfg = await this.gateway.http(`/api/config?profile=${encodeURIComponent(profile)}`); const zone = cfg.config?.timezone || cfg.timezone; if (typeof zone === 'string' && zone) timezone = zone; } catch { /* Do not guess the browser timezone. */ }
    return { jobs: rows.map(row => this.routine(row, profile)), timezone };
  }
  async routineRuns(profile: string, id: string): Promise<RoutineRun[]> {
    if (!(await this.jobs(profile)).some(j => (j.id || j.job_id) === id)) throw new Conflict('The routine is no longer in this profile.');
    const r = await this.gateway.http(`/api/cron/jobs/${encodeURIComponent(id)}/runs?profile=${encodeURIComponent(profile)}`);
    if (!Array.isArray(r.runs) || r.runs.some((row: any) => row.profile && row.profile !== profile)) throw new GatewayError('Routine history is unavailable on this Hermes version.');
    return r.runs.map((run: any) => ({ id: String(run.id || run.started_at), title: String(run.title || 'Routine run'), status: String(run.status || (run.is_active ? 'running' : run.ended_at ? 'finished' : 'unknown')), at: typeof run.started_at === 'number' ? new Date(run.started_at * 1000).toISOString() : run.started_at || (typeof run.ended_at === 'number' ? new Date(run.ended_at * 1000).toISOString() : run.ended_at), conversationId:this.gateway.ref(String(run.id),profile), preview: String(run.preview || run.output_preview || '') }));
  }
  async routineResult(profile: string, id: string, run: string, offset = 0) {
    z.number().int().nonnegative().max(100000).parse(offset);
    const runs = await this.routineRuns(profile, id);
    const found = runs.find(row => row.id === run);
    if (!found) throw new Conflict('This run is not in the selected routine history. Refresh its results.');
    if (run.startsWith('cron_output:')) return { text: found.preview + '\n\nHermes exposes only a preview for this script-only run.', hasMore: false, nextOffset: offset };
    const data = await this.gateway.http(`/api/sessions/${encodeURIComponent(run)}/messages?profile=${encodeURIComponent(profile)}&include_compacted=true&order=oldest&limit=200&offset=${offset}`);
    if (data.profile !== profile || !Array.isArray(data.messages)) throw new GatewayError('Routine result profile could not be verified.');
    const messages = data.messages.map((m:any,index:number)=>({...m,index})).filter((m: any) => ['user', 'assistant'].includes(m.role) && m.display_kind !== 'hidden');
    return { conversationId:this.gateway.ref(run,profile), messages: messages.map((m: any) => ({ role: m.role, text: messageText(m), timestamp:m.timestamp, index:m.index })), text: messages.map((m: any) => `${m.role === 'assistant' ? 'Bot' : 'Instructions'}:\n${messageText(m)}`).join('\n\n'), hasMore: data.pagination?.returned === 200, nextOffset: offset + 200 };
  }
  async routineSpeech(profile:string,id:string,run:string,offset:number,index:number) {
    const result=await this.routineResult(profile,id,run,offset);
    const message=result.messages?.find((m:any)=>m.index===index);
    if(!message || message.role!=='assistant')throw new Conflict('This response is no longer available. Refresh the result.');
    return this.gateway.http(`/api/audio/speak?profile=${encodeURIComponent(profile)}`,{text:message.text});
  }
  async changeRoutine(action: 'create' | 'update' | 'pause' | 'resume' | 'remove' | 'run', value: RoutineInput, effects: ActionEffects) {
    const key=`${value.profile}:${value.id || 'new'}`;
    const previous=this.routineChanges.get(key)||Promise.resolve();
    const work=previous.catch(()=>{}).then(()=>this.applyRoutineChange(action,value,effects));
    this.routineChanges.set(key,work);
    try{return await work;}finally{if(this.routineChanges.get(key)===work)this.routineChanges.delete(key);}
  }
  private async applyRoutineChange(action: 'create' | 'update' | 'pause' | 'resume' | 'remove' | 'run', value: RoutineInput, effects: ActionEffects) {
    const input = z.object({ profile: nameSchema, id: z.string().min(1).max(200).optional(), name: z.string().trim().min(1).max(200).optional(), prompt: z.string().trim().min(1).max(100000).optional(), schedule: z.string().trim().min(1).max(200).optional(), deliver: z.enum(['bot-chat', 'local']).optional(), expectedRevision:z.string().max(100).optional() }).strict().parse(value);
    const jobs = await this.jobs(input.profile);
    if (action !== 'create' && !jobs.some(j => (j.id || j.job_id) === input.id)) throw new Conflict('The routine is no longer in this profile.');
    if (['create', 'update'].includes(action) && (!input.name || !input.prompt || !input.schedule)) throw new Conflict('Name, instructions and schedule are required.');
    if(action==='update' && !input.expectedRevision)throw new Conflict('Review the current routine before saving this older draft.');
    if(action==='update' && this.routine(jobs.find(j=>(j.id || j.job_id)===input.id),input.profile).revision!==input.expectedRevision)throw new Conflict('This routine changed in Hermes. Review its current values before saving your draft.');
    const base = `/api/cron/jobs${action === 'create' ? '' : '/' + encodeURIComponent(input.id!)}`;
    const query = `?profile=${encodeURIComponent(input.profile)}`;
    const fields:Record<string,unknown> = { name: input.name, prompt: input.prompt, schedule: input.schedule, ...(input.deliver ? { deliver: input.deliver } : {}) };
    if(action==='update'){const current=this.routine(jobs.find(j=>(j.id||j.job_id)===input.id),input.profile);for(const key of Object.keys(fields))if(fields[key]===current[key as keyof Routine])delete fields[key];}
    const result = await effects.effect(`routine.${action}`, () => this.gateway.http(
      base + (['pause', 'resume', 'run'].includes(action) ? '/' + (action === 'run' ? 'trigger' : action) : '') + query,
      action === 'create' ? fields : action === 'update' ? { updates: fields } : {},
      action === 'update' ? 'PUT' : action === 'remove' ? 'DELETE' : 'POST'));
    if (result?.error || result?.success === false) throw new GatewayError(String(result.error || 'Routine action failed.'));
    return result;
  }
}
