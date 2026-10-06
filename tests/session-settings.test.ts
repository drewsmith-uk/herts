import { afterEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Actions } from '../server/actions';
import { Gateway, GatewayError } from '../server/gateway';
import { Store } from '../server/store';
import { sessionValues } from '../server/sessionSettings';
import type { SessionValues } from '../shared/sessionSettings';

class SettingsGateway extends EventEmitter {
  timers = new Set<ReturnType<typeof setTimeout>>();
  close() { for (const timer of this.timers) clearTimeout(timer); this.timers.clear(); this.removeAllListeners(); }
  profile = 'research'; epoch = 'settings-epoch'; online = true; metadata = undefined;
  calls: { method: string; params: any }[] = []; running = false; seq = 0; confirm = false;
  lost?: string; applyBeforeLoss = true; rejectFolder = false; resumeBusy = false; lazy = false;
  modelError?: string;
  models = ['existing-model', 'profile-model', 'chosen-model', 'simple-model'];
  current: SessionValues = { model: { id: 'existing-model', provider: 'configured' }, effort: 'high', fast: false, cwd: '/projects/old' };
  profileValues: SessionValues = { model: { id: 'profile-model', provider: 'configured' }, effort: 'medium', fast: false, cwd: '/projects' };
  async connect() {}
  async conversation(id: string) { return { id, key: id, aliases: [id] }; }
  info() { if (this.lazy) return { profile_name: this.profile, lazy: true, model: this.profileValues.model!.id, cwd: this.current.cwd }; return { profile_name: this.profile, model: this.current.model?.id, provider: this.current.model?.provider, reasoning_effort: this.current.effort, fast: this.current.fast, cwd: this.current.cwd, reasoning_effort_wire: this.current.effort === 'ultra' ? 'max' : this.current.effort }; }
  async http(path: string): Promise<any> {
    this.calls.push({ method: 'HTTP GET', params: path });
    const url = new URL(path, 'http://fixture');
    expect(url.searchParams.get('profile')).toBe(this.profile);
    if (url.pathname === '/api/files') { const target = url.searchParams.get('path') || '/projects'; if (target === '/missing') throw new GatewayError('Path not found', false, 404); return { path: target, parent: '/', entries: [{ name: 'new', path: '/projects/new', is_directory: true }, { name: 'secret', path: '/projects/secret', is_directory: false }] }; }
    return { id: url.pathname.split('/').pop(), profile: this.profile, model: this.current.model?.id, cwd: this.current.cwd, model_config: JSON.stringify({ provider: this.current.model?.provider, reasoning_config: { effort: this.current.effort }, service_tier: this.current.fast ? 'priority' : 'normal', api_key: 'private-fixture-value' }), system_prompt: 'private-fixture-prompt' };
  }
  async rpc(method: string, p: any): Promise<any> {
    this.calls.push({ method, params: p });
    if (method === 'model.options') return { model: this.profileValues.model!.id, provider: this.profileValues.model!.provider, providers: [{ slug: 'configured', name: 'Configured provider', authenticated: true, models: this.models, capabilities: Object.fromEntries(this.models.map(id => [id, { reasoning: id !== 'simple-model', fast: id !== 'simple-model', can_disable_reasoning: true }])) }] };
    if (method === 'config.get') return p.key === 'reasoning' ? { value: this.profileValues.effort } : p.key === 'fast' ? { value: this.profileValues.fast ? 'fast' : 'normal' } : { cwd: this.profileValues.cwd };
    if (method === 'session.create') { this.current = { ...this.profileValues, ...(p.model ? { model: { id: p.model, provider: p.provider } } : {}), ...(p.reasoning_effort ? { effort: p.reasoning_effort } : {}), ...(p.fast !== undefined ? { fast: p.fast } : {}), ...(p.cwd ? { cwd: p.cwd } : {}) }; return { session_id: 'runtime', stored_session_id: 'stored', info: this.info() }; }
    if (method === 'session.resume') { this.running = this.resumeBusy; return { session_id: 'runtime', session_key: 'stored', info: this.info(), messages_omitted: true, resumed: true, running: this.running, status: this.running ? 'working' : 'idle' }; }
    if (method === 'session.title') return { title: p.title, pending: false };
    if (method === 'session.activate') return { session_id: 'runtime', session_key: 'stored', info: this.info(), running: this.running };
    if (method === 'session.events.since') return { epoch: this.epoch, events: [], latest_seq: this.seq, truncated: false };
    if (method === 'approval.pending') return { approvals: [] };
    if (method === 'session.control.read') return { control: {} };
    if (method === 'session.cwd.set') { if (this.rejectFolder) throw new GatewayError('Folder refused', false, 4017); this.current.cwd = p.cwd; return this.info(); }
    if (method === 'config.set') {
      expect(p.session_id).toBe('runtime'); expect(p.profile).toBe(this.profile);
      if (p.key === 'model' && this.modelError) throw new GatewayError(this.modelError, true, 5001);
      if (p.key === 'model' && this.confirm && !p.confirm_expensive_model) return { confirm_required: true, confirm_message: 'Hermes asks before this model switch.' };
      const apply = () => {
        if (p.key === 'model') {
          // Match Hermes' whitespace tokenization, which does not strip shell quotes.
          const [model, flag, provider, scope, ...rest] = p.value.split(/\s+/);
          expect([flag, scope, ...rest]).toEqual(['--provider', '--session']);
          if (provider !== 'configured') throw new GatewayError(`Unknown provider '${provider}'. Check 'hermes model' for available providers, or define it in config.yaml under 'providers:'.`, true, 5001);
          if (!this.models.includes(model)) throw new GatewayError(`Unknown model '${model}'.`, true, 5001);
          this.current.model = { id: model, provider }; this.current.effort = 'medium'; this.current.fast = false;
        }
        if (p.key === 'reasoning') { expect(p.scope).toBe('session'); this.current.effort = p.value; }
        if (p.key === 'fast') this.current.fast = p.value === 'fast';
      };
      if (this.lost === p.key) { if (this.applyBeforeLoss) apply(); throw new GatewayError('Settings reply lost', true); }
      apply(); return { value: p.key === 'model' ? this.current.model!.id : p.value, scope: 'session' };
    }
    if (method === 'prompt.submit') { const timer = setTimeout(() => { this.timers.delete(timer); this.emit('event', { type: 'message.complete', session_id: 'runtime', seq: ++this.seq, payload: { status: 'complete' } }); }, 0); this.timers.add(timer); return { status: 'streaming' }; }
    throw new Error(`Unexpected RPC ${method}`);
  }
}
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach(fn => fn()));
function fixture(linked = true) {
  const store = new Store(':memory:'), gateway = new SettingsGateway(), actions = new Actions(store, gateway as unknown as Gateway, '/tmp'), id = randomUUID();
  store.saveContext({ id, title: 'Settings fixture', link: linked ? { key: 'stored', storedId: 'stored', title: 'Existing conversation', source: 'telegram' } : null, aliases: linked ? ['stored'] : [] });
  cleanup.push(() => { gateway.close(); actions.close(); store.close(); });
  const stage = (values: SessionValues, reviewed = false) => actions.settings.save(id, { id: randomUUID(), revision: actions.settings.record(id).revision, values, baseline: linked ? structuredClone(gateway.current) : undefined, reviewed });
  const send = (settingsConfirmation?: string) => { const input = { id: randomUUID(), contextId: id, kind: 'send' as const, text: 'Keep this message', settingsConfirmation }; actions.start(input); return input.id; };
  return { store, gateway, actions, id, stage, send };
}
const writes = (g: SettingsGateway) => g.calls.filter(c => ['config.set', 'session.cwd.set', 'session.create', 'session.resume', 'prompt.submit'].includes(c.method));

describe('settings staged until Send', () => {
  it('saves defaults and conversation choices idempotently without any Hermes request', () => {
    const { store, gateway, actions, id, stage } = fixture();
    const input = { id: randomUUID(), revision: 0, values: { effort: 'low' as const } };
    actions.settings.save(undefined, input); actions.settings.save(undefined, input);
    stage({ effort: 'ultra', fast: true, cwd: '/projects/new' });
    expect(gateway.calls).toEqual([]); expect(store.actions()).toEqual([]);
    expect(store.sessionSettings().defaults.revision).toBe(1);
    expect(store.sessionSettings().conversations[id].values.effort).toBe('ultra');
    expect(() => actions.settings.save(id, { ...input, id: randomUUID() })).toThrow('another device');
  });
  it('reads the saved session override without resuming or exposing private config', async () => {
    const { gateway, actions, id } = fixture(); const view = await actions.settings.view(id);
    expect(view).toMatchObject({ source: 'saved', current: gateway.current, profile: gateway.profileValues, available: true });
    expect(JSON.stringify(view)).not.toContain('private-fixture'); expect(writes(gateway)).toEqual([]);
    expect((await actions.settings.directories('/projects')).directories).toEqual([{ name: 'new', path: '/projects/new' }]);
  });
  it('labels incomplete older session metadata unknown without substituting profile defaults', async () => {
    const { gateway, actions, id } = fixture();
    const original = gateway.http.bind(gateway); gateway.http = async path => ({ ...await original(path), model: null, cwd: null, model_config: { _usage_anchor: {} } });
    const view = await actions.settings.view(id);
    expect(view.source).toBe('unknown'); expect(view.current).toEqual({}); expect(view.profile.model).toEqual(gateway.profileValues.model); expect(writes(gateway)).toEqual([]);
  });
  it('applies only on Send, preserves dependent choices, and keeps them for later messages', async () => {
    const { store, gateway, actions, stage, send, id } = fixture();
    stage({ model: { provider: 'configured', id: 'chosen-model' }, cwd: '/projects/new' });
    expect(writes(gateway)).toEqual([]);
    const first = send(); await expect.poll(() => store.action(first)?.receipt).toBe('accepted');
    expect(gateway.current).toMatchObject({ model: { id: 'chosen-model', provider: 'configured' }, effort: 'high', cwd: '/projects/new' });
    expect(writes(gateway).find(c => c.method === 'config.set' && c.params.key === 'model')?.params.value).toBe('chosen-model --provider configured --session');
    const history = writes(gateway); expect(history.at(-1)?.method).toBe('prompt.submit'); expect(history.some(c => c.method === 'session.cwd.set')).toBe(true);
    expect(actions.settings.record(id).values).toEqual({}); await actions.reconcile(id);
    const count = writes(gateway).filter(c => c.method === 'config.set').length;
    const next = send(); await expect.poll(() => store.action(next)?.receipt).toBe('accepted');
    expect(writes(gateway).filter(c => c.method === 'config.set')).toHaveLength(count);
  });
  it('allows a deliberate retry after Hermes definitively rejects the provider', async () => {
    const { store, gateway, actions, stage, send, id } = fixture();
    stage({ model: { id: 'chosen-model', provider: 'configured' }, fast: true });
    gateway.modelError = "Unknown provider 'configured'. Check 'hermes model' for available providers, or define it in config.yaml under 'providers:'.";
    const first = send(); await expect.poll(() => store.action(first)?.receipt).toBe('rejected');
    expect(store.action(first)).toMatchObject({ state: 'failed', sendStage: 'preparing', text: 'Keep this message' });
    expect(store.action(first)?.settings?.inFlight).toBeUndefined();
    expect((await actions.settings.view(id)).uncertain).toBe(false);
    expect(writes(gateway).some(c => c.method === 'prompt.submit')).toBe(false);
    expect(gateway.current.model?.id).toBe('existing-model');
    gateway.modelError = undefined;
    const next = send(); await expect.poll(() => store.action(next)?.receipt).toBe('accepted');
    expect(gateway.current).toMatchObject({ model: { id: 'chosen-model', provider: 'configured' }, fast: true });
    expect(writes(gateway).filter(c => c.method === 'prompt.submit')).toHaveLength(1);
  });
  it('keeps other model setter failures uncertain until reviewed', async () => {
    const { store, gateway, stage, send } = fixture();
    stage({ model: { id: 'chosen-model', provider: 'configured' } });
    gateway.modelError = 'Model changed but persistence failed';
    const first = send(); await expect.poll(() => store.action(first)?.receipt).toBe('unknown');
    expect(store.action(first)?.settings?.inFlight).toBe('model');
    gateway.modelError = undefined;
    const next = send(); await expect.poll(() => store.action(next)?.receipt).toBe('rejected');
    expect(writes(gateway).filter(c => c.method === 'config.set')).toHaveLength(1);
    expect(writes(gateway).some(c => c.method === 'prompt.submit')).toBe(false);
  });
  it.each(['chosen-model --global', '--once', '—global'])('rejects an ambiguous model identifier %s before changing settings', async model => {
    const { store, gateway, stage, send } = fixture(); gateway.models.push(model);
    stage({ model: { id: model, provider: 'configured' } });
    const sent = send(); await expect.poll(() => store.action(sent)?.receipt).toBe('rejected');
    expect(store.action(sent)?.error).toContain('cannot switch to this model/provider name');
    expect(store.action(sent)?.settings?.inFlight).toBeUndefined();
    expect(writes(gateway).filter(c => c.method !== 'session.resume')).toEqual([]);
  });
  it('applies Herts defaults on creation with per-conversation precedence and freezes them once', async () => {
    const { store, gateway, actions, id, stage, send } = fixture(false);
    actions.settings.save(undefined, { id: randomUUID(), revision: 0, values: { model: { id: 'chosen-model', provider: 'configured' }, effort: 'low', fast: true, cwd: '/projects/new' } });
    stage({ effort: 'ultra' }); const sent = send(); await expect.poll(() => store.action(sent)?.receipt).toBe('accepted');
    expect(gateway.calls.find(c => c.method === 'session.create')?.params).toMatchObject({ model: 'chosen-model', provider: 'configured', reasoning_effort: 'ultra', fast: true, cwd: '/projects/new', profile: 'research' });
    expect(gateway.current.effort).toBe('ultra'); await expect.poll(() => store.action(sent)?.state).toBe('finished'); await actions.reconcile(id);
    actions.settings.save(undefined, { id: randomUUID(), revision: 1, values: { effort: 'minimal' } });
    const again = send(); await expect.poll(() => store.action(again)?.receipt).toBe('accepted'); expect(gateway.current.effort).toBe('ultra');
  });
  it.each([undefined, 1])('recovers with unchanged defaults and conversation overrides (client revision: %s)', async defaultsRevision => {
    const { store, gateway, actions, id } = fixture();
    actions.settings.save(undefined, { id: randomUUID(), revision: 0, values: { model: { id: 'chosen-model', provider: 'configured' }, effort: 'low', fast: true, cwd: '/projects/new' } });
    // A failed setup may have pending overrides but no usable session baseline.
    actions.settings.save(id, { id: randomUUID(), revision: 0, values: { effort: 'ultra' } });
    const originalId = randomUUID();
    store.saveAction({ id: originalId, taskId: id, kind: 'send', text: 'Original saved message', uploadIds: [], createdAt: 1, updatedAt: 1, state: 'failed', phase: 'message not sent', receipt: 'rejected', sendStage: 'preparing' });
    store.saveBinding(id, { runtimeId: 'runtime', storedId: 'stored', epoch: gateway.epoch, generation: randomUUID(), seq: 0, ready: false, monitored: false, known: false });
    const rpc = gateway.rpc.bind(gateway), http = gateway.http.bind(gateway); let missing = true;
    gateway.conversation = async () => { throw new GatewayError('Missing', false, 404); };
    gateway.http = async path => { if (path.startsWith('/api/sessions/')) throw new GatewayError('Missing', false, 404); return http(path); };
    gateway.rpc = async (method, params) => {
      if (method === 'session.activate' && missing) throw new GatewayError('Missing', false, 4001);
      if (method === 'session.create') missing = false;
      return rpc(method, params);
    };
    const input = { id: randomUUID(), contextId: id, kind: 'send' as const, text: 'Recover with my choices', defaultsRevision };
    actions.start(input);
    await expect.poll(() => store.action(input.id)?.receipt).toBe('accepted');
    expect(gateway.calls.find(c => c.method === 'session.create')?.params).toMatchObject({ model: 'chosen-model', provider: 'configured', reasoning_effort: 'ultra', fast: true, cwd: '/projects/new' });
    expect(writes(gateway).filter(c => c.method === 'prompt.submit')).toHaveLength(1);
    expect(store.action(originalId)?.text).toBe('Original saved message');
    expect(actions.start(input).id).toBe(input.id);
  });
  it('ignores stale new-conversation defaults when sending to an existing session', async () => {
    const { store, gateway, actions, id } = fixture();
    actions.settings.save(undefined, { id: randomUUID(), revision: 0, values: { effort: 'low' } });
    const input = { id: randomUUID(), contextId: id, kind: 'send' as const, text: 'Use this existing session', defaultsRevision: 0 };
    actions.start(input);
    await expect.poll(() => store.action(input.id)?.receipt).toBe('accepted');
    expect(gateway.current.effort).toBe('high');
    expect(writes(gateway).map(c => c.method)).toEqual(['session.resume', 'prompt.submit']);
  });
  it('confirms choices on a lazy new session instead of trusting profile-based headers', async () => {
    const { store, gateway, stage, send } = fixture(false); gateway.lazy = true;
    stage({ model: { provider: 'configured', id: 'chosen-model' }, effort: 'low', fast: true, cwd: '/projects/new' });
    const sent = send(); await expect.poll(() => store.action(sent)?.receipt).toBe('accepted');
    expect(gateway.current).toMatchObject({ model: { id: 'chosen-model' }, effort: 'low', fast: true, cwd: '/projects/new' });
    expect(writes(gateway).at(-1)?.method).toBe('prompt.submit');
    expect(writes(gateway).filter(c => c.method === 'config.set').map(c => c.params.key)).toEqual(['model', 'reasoning', 'fast']);
  });
  it('rejects stale displayed defaults before creating any Hermes session', () => {
    const { actions, gateway, id } = fixture(false);
    actions.settings.save(undefined, { id: randomUUID(), revision: 0, values: { effort: 'low' } });
    expect(() => actions.start({ id: randomUUID(), contextId: id, kind: 'send', text: 'Saved draft', defaultsRevision: 0 })).toThrow('defaults changed');
    expect(gateway.calls).toEqual([]);
  });
  it('leaves resumed active work untouched and retains the pending settings and message', async () => {
    const { gateway, store, actions, stage, send, id } = fixture(); stage({ effort: 'low' }); gateway.resumeBusy = true;
    const sent = send(); await expect.poll(() => store.action(sent)?.receipt).toBe('rejected');
    expect(writes(gateway).map(c => c.method)).toEqual(['session.resume']); expect(gateway.current.effort).toBe('high');
    expect(actions.settings.record(id).values.effort).toBe('low'); expect(store.action(sent)?.sendStage).toBe('preparing');
  });
  it('retains a saved message for an explicit model confirmation and sends once after acceptance', async () => {
    const { store, gateway, actions, stage, send } = fixture(); gateway.confirm = true; stage({ model: { id: 'chosen-model', provider: 'configured' } });
    const first = send(); await expect.poll(() => store.action(first)?.receipt).toBe('rejected');
    expect(store.action(first)?.settings?.confirmation).toContain('Hermes asks'); expect(writes(gateway).some(c => c.method === 'prompt.submit')).toBe(false);
    const next = send(first); await expect.poll(() => store.action(next)?.receipt).toBe('accepted');
    expect(writes(gateway).filter(c => c.method === 'prompt.submit')).toHaveLength(1);
    expect(gateway.current.effort).toBe('high');
  });
  it('does not repeat an uncertain setter, and can reconcile its confirmed outcome on a later deliberate Send', async () => {
    const { store, gateway, stage, send } = fixture(); stage({ effort: 'low' }); gateway.lost = 'reasoning';
    const first = send(); await expect.poll(() => store.action(first)?.receipt).toBe('unknown');
    expect(store.action(first)?.settings?.inFlight).toBe('effort'); expect(writes(gateway).some(c => c.method === 'prompt.submit')).toBe(false);
    const next = send(); await expect.poll(() => store.action(next)?.receipt).toBe('accepted');
    expect(writes(gateway).filter(c => c.method === 'config.set')).toHaveLength(1);
  });
  it('retains dependent effort after a model switch succeeds but its reply is lost', async () => {
    const { store, gateway, actions, stage, send, id } = fixture(); stage({ model: { provider: 'configured', id: 'chosen-model' } }); gateway.lost = 'model';
    const first = send(); await expect.poll(() => store.action(first)?.receipt).toBe('unknown');
    expect(gateway.current.effort).toBe('medium'); expect(actions.settings.record(id).values.effort).toBe('high');
    gateway.lost = undefined; const next = send(); await expect.poll(() => store.action(next)?.receipt).toBe('rejected');
    stage(actions.settings.record(id).values, true); const reviewed = send(); await expect.poll(() => store.action(reviewed)?.receipt).toBe('accepted');
    expect(gateway.current.effort).toBe('high'); expect(writes(gateway).filter(c => c.method === 'config.set' && c.params.key === 'model')).toHaveLength(1);
  });
  it('requires explicit review when an uncertain change cannot be reconciled', async () => {
    const { store, gateway, actions, stage, send, id } = fixture(); stage({ effort: 'low' }); gateway.lost = 'reasoning'; gateway.applyBeforeLoss = false;
    const first = send(); await expect.poll(() => store.action(first)?.receipt).toBe('unknown');
    await actions.settings.view(id); const next = send(); await expect.poll(() => store.action(next)?.receipt).toBe('rejected');
    expect(writes(gateway).filter(c => c.method === 'config.set')).toHaveLength(1);
    expect(() => stage({ effort: 'low' })).toThrow('unconfirmed');
    gateway.lost = undefined; stage({ effort: 'low' }, true); const reviewed = send(); await expect.poll(() => store.action(reviewed)?.receipt).toBe('accepted');
  });
  it('rejects external changes before any write and never silently overwrites Desktop settings', async () => {
    const { store, gateway, stage, send } = fixture(); stage({ effort: 'low' }); gateway.current.effort = 'max';
    const sent = send(); await expect.poll(() => store.action(sent)?.receipt).toBe('rejected');
    expect(store.action(sent)?.error).toContain('changed in Hermes'); expect(writes(gateway).filter(c => c.method !== 'session.resume')).toEqual([]);
  });
  it('keeps partial outcomes and retries only still-needed settings on the next Send', async () => {
    const { store, gateway, stage, send } = fixture(); stage({ effort: 'low', cwd: '/projects/new' }); gateway.rejectFolder = true;
    const first = send(); await expect.poll(() => store.action(first)?.receipt).toBe('rejected'); expect(gateway.current.effort).toBe('low');
    gateway.rejectFolder = false; const next = send(); await expect.poll(() => store.action(next)?.receipt).toBe('accepted');
    expect(writes(gateway).filter(c => c.method === 'config.set')).toHaveLength(1);
  });
  it('rejects unavailable capabilities and invalid folders before creation', async () => {
    const { store, gateway, stage, send } = fixture(false); stage({ model: { id: 'simple-model', provider: 'configured' }, fast: true });
    const first = send(); await expect.poll(() => store.action(first)?.receipt).toBe('rejected'); expect(writes(gateway)).toEqual([]);
    stage({ cwd: '/missing' }); const next = send(); await expect.poll(() => store.action(next)?.receipt).toBe('rejected'); expect(writes(gateway)).toEqual([]);
  });
  it('normalizes saved and live metadata without mistaking thinking-off or normal speed for missing values', () => {
    expect(sessionValues({ model: 'm', provider: 'p', reasoning_effort: 'none', fast: false, cwd: '/a' })).toEqual({ model: { id: 'm', provider: 'p' }, effort: 'none', fast: false, cwd: '/a' });
    expect(sessionValues({ model: 'm', model_config: { provider: 'p', reasoning_config: { enabled: false }, service_tier: 'normal' } }, true)).toEqual({ model: { id: 'm', provider: 'p' }, effort: 'none', fast: false });
  });
});
