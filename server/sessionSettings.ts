import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { Conflict, type Action, type Binding } from '../shared/core.js';
import { efforts, settingKeys, sameSetting, hasSettings, type ModelChoice, type SessionValues, type SettingsView, type ModelOption, type SettingsRecord, type SendSettings, type SettingKey } from '../shared/sessionSettings.js';
import { Gateway, GatewayError } from './gateway.js';
import { Store } from './store.js';

const text = z.string().trim().min(1).max(1000).refine(s => !/[\x00-\x1f\x7f]/.test(s), 'Control characters are not allowed.');
export const valuesSchema = z.object({ model: z.object({ provider: text, id: text }).strict().optional(), effort: z.enum(efforts).optional(), fast: z.boolean().optional(), cwd: text.optional() }).strict();
const recordInput = z.object({ id: z.string().uuid(), revision: z.number().int().nonnegative(), values: valuesSchema, baseline: valuesSchema.optional(), reviewed: z.boolean().optional() }).strict();
const blank = (): SettingsRecord => ({ revision: 0, values: {} });
function modelSwitchValue(model: ModelChoice) {
  // Hermes splits this value on whitespace; shell quotes are literal characters.
  // Keep each identifier a single non-flag token, including Hermes' smart-dash flags.
  if ([model.id, model.provider].some(value => !value || /\s/u.test(value) || /^[-\u2012-\u2015]/u.test(value))) {
    throw new GatewayError('Hermes cannot switch to this model/provider name. Choose another model in conversation settings.');
  }
  return `${model.id} --provider ${model.provider} --session`;
}
function object(value: unknown): any { if (typeof value === 'string') { try { return JSON.parse(value); } catch { return {}; } } return value && typeof value === 'object' ? value : {}; }
export function sessionValues(info: any, stored = false): SessionValues {
  const cfg = stored ? object(info.model_config) : info;
  const model = cfg.model || info.model, provider = cfg.provider || info.provider;
  const reasoning = object(cfg.reasoning_config);
  const effort = cfg.reasoning_effort || (reasoning.enabled === false ? 'none' : reasoning.effort);
  const tier = cfg.service_tier;
  return { ...(typeof model === 'string' && model && typeof provider === 'string' && provider ? { model: { id: model, provider } } : {}),
    ...(efforts.includes(effort) ? { effort } : {}),
    ...(typeof cfg.fast === 'boolean' ? { fast: cfg.fast } : tier !== undefined && ['priority', 'normal', '', null].includes(tier) ? { fast: tier === 'priority' } : {}),
    ...(typeof info.cwd === 'string' && info.cwd ? { cwd: info.cwd } : {}) };
}

export class SessionSettings {
  observed = new Map<string, { values: SessionValues; wire?: string; epoch: string; runtime: string; at: number }>();
  private catalogue?: { at: number; models: ModelOption[]; profile: SessionValues };
  private loading?: Promise<{ models: ModelOption[]; profile: SessionValues }>;
  constructor(readonly store: Store, readonly gateway: Gateway) {}
  observe(id: string, info: any, binding: Binding) {
    if (!info || info.lazy || info.profile_name !== this.gateway.profile || !info.model || !info.provider) return;
    this.observed.set(id, { values: sessionValues(info), wire: typeof info.reasoning_effort_wire === 'string' ? info.reasoning_effort_wire : undefined, epoch: binding.epoch, runtime: binding.runtimeId, at: Date.now() });
  }
  record(id: string) { return this.store.sessionSettings().conversations[id] || blank(); }
  uncertain(id: string, revision = this.record(id).revision) { return this.store.actions(id).filter(a => a.settings?.inFlight && a.settings.revision === revision); }
  busy(id: string) { return this.store.actions(id).some(a => a.kind === 'send' && a.receipt === 'pending'); }
  save(id: string | undefined, input: z.infer<typeof recordInput>) {
    const payload = { scope: id || 'defaults', ...input };
    this.store.db.transaction(() => {
      if (this.store.receipt(input.id, payload)) return;
      if (id && !this.store.context(id)) throw new Conflict('Sync this conversation before saving settings.');
      if (id && this.busy(id)) throw new Conflict('Wait for this message to finish sending before changing its settings.');
      const state = this.store.sessionSettings(), old = id ? this.record(id) : state.defaults;
      if (old.revision !== input.revision) throw new Conflict('Settings changed on another device. Refresh and review them before saving.');
      if (id && this.uncertain(id).length && !input.reviewed) throw new Conflict('A settings change is unconfirmed. Review the current settings before saving your choices again.');
      const next: SettingsRecord = { revision: old.revision + 1, values: input.values, ...(input.baseline ? { baseline: input.baseline } : {}) };
      if (id) state.conversations[id] = next; else state.defaults = next;
      this.store.saveSessionSettings(state); this.store.saveReceipt(input.id, payload, { accepted: true });
    })();
    return { snapshot: this.store.coreSnapshot() };
  }
  async catalogueRead(force = false) {
    if (!force && this.catalogue && Date.now() - this.catalogue.at < 60_000) return this.catalogue;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const profile = this.gateway.profile;
      const options = await this.gateway.rpc('model.options', { profile, include_unconfigured: false, refresh: force });
      if (!Array.isArray(options.providers)) throw new GatewayError('This Hermes version does not provide model settings.');
      const models: ModelOption[] = options.providers.flatMap((p: any) => typeof p.slug !== 'string' || !Array.isArray(p.models) ? [] : p.models.filter((m: unknown) => typeof m === 'string').map((id: string) => {
        const cap = p.capabilities?.[id] || {};
        return { provider: p.slug, providerName: typeof p.name === 'string' ? p.name : p.slug, id,
          ...(typeof cap.reasoning === 'boolean' ? { reasoning: cap.reasoning } : {}), ...(typeof cap.fast === 'boolean' ? { fast: cap.fast } : {}),
          ...(typeof cap.can_disable_reasoning === 'boolean' ? { canDisableReasoning: cap.can_disable_reasoning } : {}), available: p.authenticated !== false && !(p.unavailable_models || []).includes(id) };
      }));
      const extra = await Promise.allSettled(['reasoning', 'fast', 'project'].map(key => this.gateway.rpc('config.get', { profile, key })));
      const get = (n: number): any => extra[n].status === 'fulfilled' ? extra[n].value : {};
      const defaults: SessionValues = { ...(typeof options.model === 'string' && options.model && typeof options.provider === 'string' && options.provider ? { model: { id: options.model, provider: options.provider } } : {}),
        ...(efforts.includes(get(0).value) ? { effort: get(0).value } : {}), ...(['fast', 'normal'].includes(get(1).value) ? { fast: get(1).value === 'fast' } : {}),
        ...(typeof get(2).cwd === 'string' && get(2).cwd ? { cwd: get(2).cwd } : {}) };
      this.catalogue = { at: Date.now(), models, profile: defaults }; return this.catalogue;
    })();
    try { return await this.loading; } finally { this.loading = undefined; }
  }
  async stored(id: string): Promise<SessionValues> {
    const context = this.store.context(id); if (!context?.link) return {};
    const conversation = await this.gateway.conversation(context.link.storedId);
    const row = await this.gateway.http(`/api/sessions/${encodeURIComponent(conversation.id)}?profile=${encodeURIComponent(this.gateway.profile)}`);
    if (row.id !== conversation.id || row.profile !== this.gateway.profile) throw new GatewayError('Conversation settings identity could not be verified.');
    return sessionValues(row, true);
  }
  async view(id?: string, force = false): Promise<SettingsView> {
    const context = id ? this.store.context(id) : undefined, state = this.store.sessionSettings();
    let current: SessionValues = {}, source: SettingsView['source'] = context?.link ? 'unknown' : 'profile', wireEffort: string | undefined, error = '';
    let catalogue: { models: ModelOption[]; profile: SessionValues } | undefined = this.catalogue;
    try { catalogue = await this.catalogueRead(force); } catch (e) { error = (e as Error).message; }
    if (context?.link) {
      try { current = await this.stored(context.id); source = hasSettings(current) ? 'saved' : 'unknown'; } catch (e) { error ||= (e as Error).message; }
      const live = this.observed.get(context.id), b = this.store.binding(context.id);
      if (live && b && this.gateway.online && b.epoch === this.gateway.epoch && live.epoch === b.epoch && live.runtime === b.runtimeId && Date.now() - live.at < 15_000) { current = { ...current, ...live.values }; source = 'live'; wireEffort = live.wire; }
    }
    return { defaults: state.defaults, pending: id ? this.record(id) : blank(), current, profile: catalogue?.profile || {}, source, wireEffort,
      models: catalogue?.models || [], available: !error && !!catalogue, ...(error ? { error } : {}), uncertain: !!id && this.uncertain(id).length > 0 };
  }
  async directories(path?: string) {
    const query = new URLSearchParams({ profile: this.gateway.profile }); if (path) query.set('path', path);
    const data = await this.gateway.http(`/api/files?${query}`);
    if (typeof data.path !== 'string' || !Array.isArray(data.entries)) throw new GatewayError('This Hermes version does not provide folder browsing.');
    return { path: data.path, parent: typeof data.parent === 'string' ? data.parent : null,
      directories: data.entries.filter((e: any) => e.is_directory && typeof e.name === 'string' && typeof e.path === 'string').map((e: any) => ({ name: e.name, path: e.path })) };
  }
  freeze(id: string, revisions: { settingsRevision?: number; defaultsRevision?: number; settingsConfirmation?: string }): SendSettings | undefined {
    const context = this.store.context(id)!, state = this.store.sessionSettings(); let record = this.record(id);
    if (revisions.settingsRevision !== undefined && revisions.settingsRevision !== record.revision) throw new Conflict('Conversation settings changed. Review them before sending.');
    if (!context.link && revisions.defaultsRevision !== undefined && revisions.defaultsRevision !== state.defaults.revision) throw new Conflict('New conversation defaults changed. Review them before sending.');
    const values = { ...(!context.link ? state.defaults.values : {}), ...record.values };
    if (!hasSettings(values)) return;
    if (!context.link && !sameSetting(values, record.values)) {
      record = { revision: record.revision + 1, values }; state.conversations[id] = record; this.store.saveSessionSettings(state);
    }
    let confirmedModel = false;
    if (revisions.settingsConfirmation) {
      const prior = this.store.action(revisions.settingsConfirmation);
      if (!prior || prior.taskId !== id || !prior.settings?.confirmation || prior.settings.revision !== record.revision || settingKeys.some(k => values[k] !== undefined && !sameSetting(prior.settings!.values[k], values[k]))) throw new Conflict('The model confirmation is stale. Review the settings and send again.');
      confirmedModel = true;
    }
    return { revision: record.revision, values: structuredClone(values), baseline: record.baseline, applied: [], confirmedModel };
  }
  async validate(values: SessionValues, current: SessionValues = {}) {
    const { models, profile } = await this.catalogueRead(); const effective = { ...profile, ...current, ...values };
    const model = effective.model, row = model && models.find(m => sameSetting({ id: m.id, provider: m.provider }, model));
    if (values.model && (!row || !row.available)) throw new GatewayError('The selected model is unavailable. Choose an available model in conversation settings.');
    if (values.effort !== undefined && (!row || row.reasoning !== true || (values.effort === 'none' && row.canDisableReasoning === false))) throw new GatewayError('The selected model does not support this reasoning choice. Review conversation settings.');
    if ((values.fast === true || (values.model && effective.fast === true)) && row?.fast !== true) throw new GatewayError('Fast mode is unavailable for the selected model. Turn it off before sending.');
    if (values.cwd) { const folder = await this.directories(values.cwd); if (folder.path !== values.cwd) throw new GatewayError('Select the full, normalized folder path from the folder browser before sending.'); }
  }
  async beforeCreate(action: Action) {
    if (!action.settings) return;
    try { await this.validate(action.settings.values); }
    catch (e) { throw new GatewayError((e as Error).message); } // A read failure did not create a session.
  }
  createParams(action: Action) {
    const v = action.settings?.values;
    return v ? { ...(v.model ? { model: v.model.id, provider: v.model.provider } : {}), ...(v.effort ? { reasoning_effort: v.effort } : {}), ...(v.fast !== undefined ? { fast: v.fast } : {}), ...(v.cwd ? { cwd: v.cwd } : {}) } : {};
  }
  async apply(action: Action, binding: Binding, live: any, ready: () => Promise<any>, step: (phase: string, method: string, params: any) => Promise<any>) {
    const settings = action.settings; if (!settings) return;
    const save = () => { Object.assign(action, this.store.action(action.id)); action.settings = settings; this.store.saveAction(action); };
    this.observe(action.taskId, live.info, binding);
    let current = sessionValues(live.info || {});
    if (live.info?.lazy) current = {}; // Lazy headers may report profile defaults, not the draft's overrides.
    await this.validate(settings.values, current);
    for (const old of this.uncertain(action.taskId, settings.revision)) {
      if (old.id === action.id) continue;
      const key = old.settings!.inFlight!;
      if (!sameSetting(current[key], old.settings!.values[key])) throw new GatewayError('A previous settings change is unconfirmed. Open conversation settings, refresh and review your choices before sending again.');
      delete old.settings!.inFlight; this.store.saveAction(old);
    }
    for (const key of settingKeys) if (settings.values[key] !== undefined && settings.baseline?.[key] !== undefined && !sameSetting(current[key], settings.values[key]) && !sameSetting(current[key], settings.baseline[key])) throw new GatewayError('This conversation’s settings changed in Hermes. Open settings and review your choices before sending.');
    if (settings.values.model && !sameSetting(settings.values.model, current.model)) {
      const row = (await this.catalogueRead()).models.find(m => m.id === settings.values.model!.id && m.provider === settings.values.model!.provider);
      // Hermes can reset dependent options during a switch. Retain the session's
      // current choices unless the user changed them or the new model lacks them.
      if (settings.values.effort === undefined && current.effort && row?.reasoning && !(current.effort === 'none' && row.canDisableReasoning === false)) settings.values.effort = current.effort;
      if (settings.values.fast === undefined && current.fast !== undefined && (row?.fast || !current.fast)) settings.values.fast = current.fast;
      const state = this.store.sessionSettings(), pending = this.record(action.taskId);
      if (pending.revision === settings.revision && !sameSetting(pending.values, settings.values)) {
        settings.revision++;
        state.conversations[action.taskId] = { ...pending, revision: settings.revision, values: structuredClone(settings.values) };
        this.store.saveSessionSettings(state);
      }
      save();
    }
    for (const key of settingKeys) {
      const desired = settings.values[key]; if (desired === undefined) continue;
      if (sameSetting(current[key], desired)) { settings.applied.push(key); continue; }
      const modelValue = key === 'model' ? modelSwitchValue(settings.values.model!) : undefined;
      await ready(); // Never modify an earlier/recovered active turn.
      settings.inFlight = key; save();
      try {
        const result = key === 'cwd'
          ? await step('setting working folder', 'session.cwd.set', { session_id: binding.runtimeId, cwd: desired })
          : await step(`setting ${key === 'effort' ? 'reasoning effort' : key}`, 'config.set', {
            session_id: binding.runtimeId, profile: this.gateway.profile, key: key === 'effort' ? 'reasoning' : key,
            value: key === 'model' ? modelValue : key === 'fast' ? desired ? 'fast' : 'normal' : desired,
            ...(key === 'effort' ? { scope: 'session' } : {}), ...(key === 'model' && settings.confirmedModel ? { confirm_expensive_model: true } : {}) });
        if (result.confirm_required) { delete settings.inFlight; settings.confirmation = String(result.confirm_message || result.warning || 'Hermes asks you to confirm this model switch.'); save(); throw new GatewayError(settings.confirmation!); }
        if (result.deferred) throw new GatewayError('Hermes deferred the settings change while work was active. Review its status before sending again.', true);
        const expected = key === 'cwd' ? result.cwd : key === 'model' ? result.value : key === 'fast' ? result.value === 'fast' ? true : result.value === 'normal' ? false : undefined : result.value;
        if (!sameSetting(expected, key === 'model' ? settings.values.model!.id : desired)) throw new GatewayError('The settings change could not be confirmed. Review conversation settings.', true);
        delete settings.inFlight; settings.applied.push(key); save();
        // A model change can reset dependent settings. Read again before applying the next field.
        const checked = await ready(); current = sessionValues(checked.info || {}); this.observe(action.taskId, checked.info, binding);
      } catch (e) {
        // Hermes wraps this pre-switch validation failure in its generic 5001 code.
        // It did not change the model; other 5001 failures remain uncertain.
        if (key === 'model' && e instanceof GatewayError && e.code === 5001 && e.message.startsWith(`Unknown provider '${settings.values.model!.provider}'. Check 'hermes model'`)) {
          e = new GatewayError(e.message, false, e.code);
        }
        if (e instanceof GatewayError && !e.uncertain) { delete settings.inFlight; save(); }
        throw e;
      }
    }
    const state = this.store.sessionSettings(), record = this.record(action.taskId);
    if (record.revision === settings.revision) { state.conversations[action.taskId] = { revision: record.revision + 1, values: {} }; this.store.saveSessionSettings(state); }
  }
}

export function registerSessionSettings(app: FastifyInstance, settings: SessionSettings) {
  app.get('/api/v1/session-settings', async req => {
    const q = z.object({ contextId: z.string().uuid().optional(), refresh: z.enum(['true', 'false']).optional() }).parse(req.query);
    return settings.view(q.contextId, q.refresh === 'true');
  });
  app.post('/api/v1/session-defaults', async req => settings.save(undefined, recordInput.parse(req.body)));
  app.post('/api/v1/contexts/:id/settings', async req => settings.save(z.string().uuid().parse((req.params as any).id), recordInput.parse(req.body)));
  app.get('/api/v1/session-directories', async req => settings.directories(z.object({ path: text.optional() }).parse(req.query).path));
}
