import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { GatewayError } from './gateway.js';
import type { Store } from './store.js';
import type { RemoteSession } from '../shared/core.js';

const counter = z.number().int().nonnegative();
const promptSchema = z.object({ kind: z.enum(['approval', 'clarify']), prompt_id: z.string(), execution_generation: counter,
  choices: z.array(z.string()), command: z.string().nullish(), description: z.string().nullish(), question: z.string().nullish(), multi_select: z.boolean().nullish() }).passthrough();
const receiptSchema = z.object({ admission_id: z.string().min(1), ref: z.object({ profile_id: z.string(), session_id: z.string() }),
  status: z.enum(['queued', 'started', 'unknown', 'terminal']), outcome: z.string().nullable(), authority_epoch: counter,
  execution_generation: counter.nullable(), sequence: counter }).passthrough();
export type AdmissionReceipt = z.infer<typeof receiptSchema>;
const snapshotSchema = z.object({ session_id: z.string(), stored_session_id: z.string(), running: z.boolean(),
  authority_epoch: counter, revision: counter, execution_generation: counter, replay_epoch: z.string().min(1),
  last_sequence: counter, subscription_id: z.string().min(1), pending: z.array(receiptSchema.extend({ input_id: z.string(), text: z.string() })),
  prompts: z.array(promptSchema), info: z.object({ profile_id: z.string().nullish(), profile_name: z.string().nullish() }).passthrough(),
  messages: z.array(z.unknown()), message_count: counter }).passthrough();
type Snapshot = z.infer<typeof snapshotSchema>;
type Request = (method: string, params: Record<string, any>) => Promise<any>;
type State = { remote: RemoteSession; snapshot: Snapshot; profile: string; id: string };

export class CanonicalGateway {
  private identities = new Map<string, string>();
  private owners = new Map<string, { epoch: number; instance?: string }>();
  private states = new Map<string, State>();
  private epochs = new Map<string, string>();
  private buffered: any[] = [];
  private snapshotReads = new Map<string, number>();
  private readSequence = 0;
  private resetSequence = 0;
  constructor(private ref: (id: string, profile: string) => string, private emit: (event: any) => void,
    private restore: (session: string, prompts: unknown[], version: number) => void,
    public store?: Pick<Store, 'getMeta' | 'setMeta'>) {}
  reset() { this.resetSequence++; this.snapshotReads.clear(); this.states.clear(); this.epochs.clear(); this.buffered = []; this.identities.clear(); this.owners.clear(); }
  identify(profile: string, value: any) {
    if (typeof value?.profile_id !== 'string' || !Array.isArray(value.capabilities) ||
        !['durable-admission-v1', 'event-replay-v1'].every(c => value.capabilities.includes(c)))
      throw new GatewayError('Hermes gateway capabilities could not be verified.');
    this.identities.set(profile, value.profile_id);
    if (Number.isSafeInteger(value.authority_epoch)) this.owners.set(profile, { epoch: value.authority_epoch, instance: value.instance_id });
  }
  state(id: string) { return this.states.get(id); }
  private async readSnapshot(profile: string, id: string, request: Request, version: number, instance: string) {
    const key = this.ref(id, profile), read = ++this.readSequence, reset = this.resetSequence;
    const result = await request('session.resume', { session_id: id, profile, source: 'desktop', omit_messages: true });
    if (reset !== this.resetSequence) throw new GatewayError('The gateway connection changed.');
    if (result.session_id !== id && result.stored_session_id !== id) throw new GatewayError('Hermes returned a different session.', true);
    const current = this.states.get(key);
    if (current && read < (this.snapshotReads.get(key) || 0)) return current;
    const state = this.remember(profile, result, version, instance);
    this.snapshotReads.set(key, read);
    return state;
  }
  private retained(key: string, make: () => Record<string, any>) {
    const name = `gateway-operation:${createHash('sha256').update(key).digest('hex')}`;
    const prior = this.store?.getMeta<Record<string, any>>(name);
    if (prior) return prior;
    const value = make(); this.store?.setMeta(name, value); return value;
  }
  private remember(profile: string, raw: unknown, version: number, instance: string): State {
    const parsed = snapshotSchema.safeParse(raw);
    if (!parsed.success || parsed.data.session_id !== parsed.data.stored_session_id) throw new GatewayError('Hermes returned an invalid session snapshot.', true);
    const value = parsed.data, key = this.ref(value.session_id, profile), prior = this.states.get(key);
    if (value.info.profile_name != null && value.info.profile_name !== profile)
      throw new GatewayError('Hermes returned a different profile.', true);
    const profileId = this.identities.get(profile);
    const ownerIdentity = this.owners.get(profile);
    if (ownerIdentity && value.authority_epoch !== ownerIdentity.epoch) throw new GatewayError('The Hermes authority changed. Reconnect before continuing.', true);
    if (!profileId) throw new GatewayError('Hermes did not confirm the profile identity.', true);
    if (value.info.profile_id && value.info.profile_id !== profileId) throw new GatewayError('Hermes returned a different profile identity.', true);
    if (prior && (prior.remote.authorityEpoch > value.authority_epoch || prior.remote.revision > value.revision ||
        (prior.remote.replayEpoch === value.replay_epoch && prior.remote.sequence > value.last_sequence))) return prior;
    const remote: RemoteSession = { protocol: 'hermes-gateway-v1', profileId, instanceId: ownerIdentity?.instance || instance,
      authorityEpoch: value.authority_epoch, revision: value.revision, executionGeneration: value.execution_generation,
      replayEpoch: value.replay_epoch, sequence: value.last_sequence, subscriptionId: value.subscription_id };
    const state = { remote, snapshot: value, profile, id: value.session_id };
    if (prior && prior.remote.replayEpoch !== value.replay_epoch) this.epochs.delete(prior.remote.replayEpoch);
    const owner = this.epochs.get(value.replay_epoch);
    if (owner && owner !== key) throw new GatewayError('Hermes returned an ambiguous event identity.', true);
    this.states.set(key, state); this.epochs.set(value.replay_epoch, key);
    this.restore(key, value.prompts.map(prompt => this.prompt(key, prompt)), version);
    const buffered = this.buffered; this.buffered = [];
    for (const event of buffered) this.event(event);
    return state;
  }
  private prompt(session: string, p: z.infer<typeof promptSchema>) {
    return { id: this.promptId(session, p.prompt_id), method: p.kind, params: { session_id: session, request_id: p.prompt_id,
      command: p.command ?? undefined, description: p.description ?? undefined, choices: p.choices, question: p.question, multi_select: p.multi_select } };
  }
  promptId(session: string, id: string) { return `gateway-prompt:${createHash('sha256').update(JSON.stringify([session, id])).digest('hex')}`; }
  event(event: any) {
    if (!event.session_id) { this.emit(event); return; }
    const key = this.epochs.get(event.replay_epoch || event.payload?.replay_epoch), state = key && this.states.get(key);
    if (!state || state.id !== event.session_id) {
      if (this.buffered.length < 512) this.buffered.push(event);
      return;
    }
    if (event.type === 'session.replay_gap') { this.emit({ ...event, session_id: key, profile: state.profile }); return; }
    const generation = event.type === 'session.updated' ? event.payload?.execution_generation ?? event.execution_generation : event.execution_generation;
    if (!Number.isSafeInteger(event.seq) || event.seq <= state.remote.sequence ||
        (generation !== undefined && (!Number.isSafeInteger(generation) || generation < state.remote.executionGeneration)) ||
        (event.authority_epoch !== undefined && event.authority_epoch !== state.remote.authorityEpoch)) return;
    state.remote.sequence = event.seq;
    if (generation !== undefined) state.remote.executionGeneration = generation;
    const revision = event.payload?.revision;
    if (Number.isSafeInteger(revision)) state.remote.revision = Math.max(state.remote.revision, revision);
    if (['approval.request', 'clarify.request'].includes(event.type)) {
      const p = promptSchema.safeParse({ ...event.payload, kind: event.type.split('.')[0] });
      if (p.success) {
        state.snapshot.prompts = [...state.snapshot.prompts.filter(old => old.prompt_id !== p.data.prompt_id), p.data];
        this.restore(key, state.snapshot.prompts.map(prompt => this.prompt(key, prompt)), Number.MAX_SAFE_INTEGER);
      }
    }
    if (['approval.settled', 'clarify.settled'].includes(event.type)) {
      state.snapshot.prompts = state.snapshot.prompts.filter(p => p.prompt_id !== event.payload?.prompt_id);
      this.restore(key, state.snapshot.prompts.map(prompt => this.prompt(key, prompt)), Number.MAX_SAFE_INTEGER);
    }
    this.emit({ ...event, session_id: key, profile: state.profile, remote: { ...state.remote } });
  }
  receipt(value: unknown, state: State, admissionId?: string): AdmissionReceipt {
    const parsed = receiptSchema.safeParse(value);
    if (!parsed.success || parsed.data.ref.session_id !== state.id || parsed.data.ref.profile_id !== state.remote.profileId ||
        parsed.data.authority_epoch !== state.remote.authorityEpoch ||
        (admissionId && parsed.data.admission_id !== admissionId)) throw new GatewayError('Hermes did not confirm the message receipt identity.', true);
    return parsed.data;
  }
  async call(method: string, params: Record<string, any>, request: Request, version: number, instance: string, intent: string = randomUUID()): Promise<any> {
    const profile = params.profile, key = this.ref(params.session_id || '', profile);
    if (method === 'gateway.ping') return request('ping', {});
    if (!this.identities.has(profile)) this.identify(profile, await request('runtime.describe', { profile }));
    if (method === 'session.create') {
      const wire = this.retained(JSON.stringify([intent, method, params]), () => ({ request_id: randomUUID(), profile, source: 'gui',
        ...Object.fromEntries(['title', 'hidden', 'follow_profile_config', 'cwd', 'cwd_explicit', 'model', 'provider'].filter(k => params[k] !== undefined).map(k => [k, params[k]])),
        ...(params.reasoning_effort ? { reasoning: params.reasoning_effort } : {}),
        ...(params.fast !== undefined ? { service_tier: params.fast ? 'priority' : 'normal' } : {}) }));
      const state = this.remember(profile, await request(method, wire), version, instance);
      return this.project(state);
    }
    if (['session.resume', 'session.activate'].includes(method)) {
      return this.project(await this.readSnapshot(profile, params.session_id, request, version, instance));
    }
    if (method === 'session.list') return request(method, { ...params, ...(params.title === undefined ? { scope: 'stored' } : {}) });
    if (method === 'profiles.list') {
      const result = await request(method, params);
      if (!Array.isArray(result.profiles)) throw new GatewayError('Hermes returned an invalid profile list.');
      const rows = await Promise.allSettled(result.profiles.map(async (row: any) => {
        if (row.ui_meta_revisions || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(row.name)) return row;
        const scoped = await request(method, { ...params, profile: row.name });
        return scoped.profiles?.find((candidate: any) => candidate.name === row.name) || row;
      }));
      return { ...result, profiles: rows.map((row, index) => row.status === 'fulfilled' ? row.value : result.profiles[index]) };
    }
    if (method === 'session.info') {
      const info = await request(method, { session_id: params.session_id, profile });
      if ((info.profile_id && info.profile_id !== this.identities.get(profile)) || (info.profile_name && info.profile_name !== profile))
        throw new GatewayError('Hermes returned different settings ownership.');
      return { ...info, profile_name: profile };
    }
    let state = this.states.get(key);
    const scoped = ['session.title', 'session.cwd.set', 'config.set', 'prompt.submit', 'prompt.receipt', 'session.events.since', 'approval.pending', 'session.interrupt'];
    if (params.session_id && scoped.includes(method) && !state) {
      state = await this.readSnapshot(profile, params.session_id, request, version, instance);
    }
    if (method === 'approval.pending') return { approvals: state!.snapshot.prompts.filter(p => p.kind === 'approval').map(p => ({ ...p, request_id: p.prompt_id })) };
    if (method === 'session.interrupt') return request(method, { session_id: params.session_id, profile, execution_generation: state!.remote.executionGeneration });
    if (method === 'prompt.submit') {
      const fingerprint = createHash('sha256').update(JSON.stringify(params)).digest('hex');
      const saved = this.retained(JSON.stringify([intent, method, profile, params.session_id]), () => ({ submission_id: intent, fingerprint }));
      if (saved.fingerprint !== fingerprint) throw new GatewayError('A submission ID cannot be reused for different content.');
      const wire = { ...params, submission_id: saved.submission_id };
      const receipt = this.receipt(await request(method, wire), state!);
      return { ...receipt, session_id: key, submission_id: wire.submission_id };
    }
    if (method === 'prompt.receipt') return this.receipt(await request(method, params), state!, params.admission_id);
    if (method === 'session.events.since') {
      const result = await request(method, { session_id: params.session_id, profile, last_sequence: params.last_seen || 0,
        replay_epoch: params.replay_epoch || state!.remote.replayEpoch });
      if (!Array.isArray(result.events) || typeof result.replay_epoch !== 'string' || !Number.isSafeInteger(result.last_sequence))
        throw new GatewayError('Hermes returned an invalid replay response.');
      if (result.snapshot_required || result.truncated || result.replay_epoch !== state!.remote.replayEpoch) {
        state = await this.readSnapshot(profile, params.session_id, request, version, instance);
        return { ...result, snapshot_required: true, remote: state.remote, snapshot: this.project(state), events: [] };
      }
      for (const event of result.events) this.event(event);
      return { ...result, events: [], remote: state!.remote };
    }
    let operation: string | undefined, payload: Record<string, any> = {};
    if (method === 'session.title') { operation = 'rename'; payload = { title: params.title }; }
    if (method === 'session.cwd.set') { operation = 'workspace'; payload = { cwd: params.cwd }; }
    if (method === 'config.set' && params.key === 'reasoning' && params.scope === 'session') { operation = 'reasoning'; payload = { effort: params.value }; }
    if (method === 'config.set' && params.key === 'model') {
      const match = /^(\S+) --provider (\S+) --session$/.exec(params.value);
      if (!match) throw new GatewayError('The model selection could not be verified.');
      operation = 'model'; payload = { model: match[1], provider: match[2] };
    }
    if (operation) {
      if (!state) throw new GatewayError('Refresh the conversation before changing its settings.');
      const confirmKey = `gateway-model-confirm:${createHash('sha256').update(JSON.stringify([key, payload])).digest('hex')}`;
      if (operation === 'model' && params.confirm_expensive_model) {
        const confirm = this.store?.getMeta<string>(confirmKey);
        if (!confirm) throw new GatewayError('The model confirmation expired. Select the model again.');
        payload.confirm = confirm;
      }
      const wire = this.retained(JSON.stringify([intent, method, params]), () => ({ session_id: state!.id, profile,
        request_id: randomUUID(), expected_revision: state!.remote.revision,
        ...(operation === 'rename' ? {} : { expected_generation: state!.remote.executionGeneration }), operation, payload }));
      const value = await request('session.mutate', wire);
      if (value.session_id !== state.id) throw new GatewayError('Hermes returned a different mutation identity.', true);
      if (operation === 'model' && value.status === 'confirmation_required' && typeof value.confirm === 'string') {
        this.store?.setMeta(confirmKey, value.confirm);
        return { ...value, confirm_required: true };
      }
      if (value.status === 'deferred') return { ...value, deferred: true };
      if (!Number.isSafeInteger(value.revision) || value.revision <= wire.expected_revision)
        throw new GatewayError('Hermes did not confirm the changed revision.', true);
      state.remote.revision = Math.max(state.remote.revision, value.revision);
      if (Number.isSafeInteger(value.execution_generation)) state.remote.executionGeneration = Math.max(state.remote.executionGeneration, value.execution_generation);
      return { ...value, value: operation === 'model' ? value.model : operation === 'reasoning' ? value.effort : value.value };
    }
    return request(method, params);
  }
  async answer(session: string, id: string, result: { choice?: string; answer?: string; answers?: Record<string, string> }, request: Request) {
    const state = this.states.get(session), prompt = state?.snapshot.prompts.find(p => this.promptId(session, p.prompt_id) === id);
    if (!state || !prompt || prompt.execution_generation !== state.remote.executionGeneration) throw new GatewayError('This prompt is stale. Refresh the conversation.');
    const reply = await request(`${prompt.kind}.respond`, { session_id: state.id, profile: state.profile, prompt_id: prompt.prompt_id,
      execution_generation: prompt.execution_generation, ...(prompt.kind === 'approval' ? { choice: result.choice } : { answer: result.answer || result.answers?.[prompt.prompt_id] || '' }) });
    if (reply.prompt_id !== prompt.prompt_id || !['resolved', 'already_resolved'].includes(reply.status)) throw new GatewayError('Hermes did not confirm the response.', true);
    state.snapshot.prompts = state.snapshot.prompts.filter(p => p.prompt_id !== prompt.prompt_id);
    this.restore(session, state.snapshot.prompts.map(p => this.prompt(session, p)), Number.MAX_SAFE_INTEGER);
  }
  private project(state: State) {
    const s = state.snapshot, sid = this.ref(s.session_id, state.profile);
    return { ...s, session_id: sid, stored_session_id: sid, session_key: sid, remote: { ...state.remote }, messages_omitted: true,
      status: s.running ? 'working' : s.prompts.length ? 'waiting' : 'idle', resumed: sid,
      inflight: s.pending.find(p => p.status === 'started'), queued: s.pending.find(p => p.status === 'queued'),
      info: { ...s.info, profile_name: state.profile } };
  }
}
