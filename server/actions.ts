import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Conflict, type Action, type Binding } from '../shared/core.js';
import { Store } from './store.js';
import { Gateway, GatewayError } from './gateway.js';
import { cleanConversationTitle } from '../shared/conversationTitles.js';
import { SessionSettings } from './sessionSettings.js';
import { obsoletePreviewWarning } from './promptRequests.js';

export interface ActionInput { id: string; taskId?: string; contextId?: string; kind: Action['kind']; text?: string; answers?: Record<string, string>; uploadIds?: string[]; targetId?: string; generation?: string; approvalId?: string; settingsRevision?: number; defaultsRevision?: number; settingsConfirmation?: string }
const activeStates = new Set(['preparing', 'running', 'awaiting_input', 'stopping']);
export function controlBusy(control: any): boolean {
  if (!control || typeof control !== 'object') return true;
  return ['goal', 'loop', 'heartbeat'].some(k => control[k] && ['active', 'running', 'pending', 'queued', 'waiting'].includes(String(control[k].status)));
}
export class Actions {
  readonly settings: SessionSettings;
  dispatching = new Set<string>();
  polling = new Set<string>(); timers = new Set<NodeJS.Timeout>(); interval: NodeJS.Timeout;
  constructor(public store: Store, public gateway: Gateway, public uploadDir: string) {
    this.settings = new SessionSettings(store, gateway);
    for (const a of store.actions()) {
      const stalePreviewWarning = a.promptWarning === obsoletePreviewWarning;
      if (stalePreviewWarning) delete a.promptWarning;
      if (a.receipt === 'pending') { if (a.state === 'preparing') a.state = 'unknown'; a.receipt = 'unknown'; a.error = a.sendStage === 'preparing' ? 'Herts restarted during conversation preparation. Your message was not sent; it remains saved.' : 'Herts restarted before this operation was confirmed. Review the saved submission and conversation history.'; store.saveAction(a); }
      else if (stalePreviewWarning) store.saveAction(a);
    }
    gateway.on('event', e => { this.event(e); });
    gateway.on('prompts', sid => this.promptsChanged(sid));
    gateway.on('compatibility', () => store.emit('change', { type: 'gateway' }));
    gateway.on('disconnected', () => {
      for (const [id, b] of store.bindings()) { b.ready = false; store.saveBinding(id, b); }
      store.emit('change', { type: 'gateway', online: false });
    });
    gateway.on('connected', () => { void this.reconnect(); store.emit('change', { type: 'gateway', online: true }); });
    this.interval = setInterval(() => { if (gateway.online) for (const [taskId, b] of store.bindings()) if (b.monitored && b.epoch === gateway.epoch) void this.reconcile(taskId); }, 4000);
  }
  main(taskId: string): Action | undefined { return this.store.actions(taskId).find(a => !a.cancelled && (a.kind === 'send' || a.kind === 'continue')); }
  cancelUndispatched(input: ActionInput): { cancelled: boolean; action: Action } {
    return this.store.db.transaction(() => {
      const prior = this.store.receipt(input.id, input);
      if (prior) return { cancelled: false, action: this.store.action(input.id)! };
      if (!this.store.context(input.contextId || input.taskId || '')) throw new Conflict('Sync this item before resolving the submission.');
      const action: Action = { id: input.id, taskId: this.store.context(input.contextId || input.taskId || '')!.id, contextId: this.store.context(input.contextId || input.taskId || '')!.id, kind: input.kind, text: input.text || '', uploadIds: input.uploadIds || [], createdAt: Date.now(), updatedAt: Date.now(), state: 'failed', phase: 'cancelled before sending', receipt: 'rejected', cancelled: true };
      this.store.saveReceipt(input.id, input, { id: input.id }); this.store.saveAction(action);
      return { cancelled: true, action };
    })();
  }
  start(input: ActionInput): Action {
    const prior = this.store.receipt(input.id, input); if (prior) return this.store.action(input.id)!;
    const task = this.store.context(input.contextId || input.taskId || ''); if (!task) throw new Conflict('Sync this item before sending.');
    const main = this.main(task.id), binding = this.store.binding(task.id);
    if (['send', 'continue'].includes(input.kind)) {
      if (main && activeStates.has(main.state)) throw new Conflict('Work is already active. Use its approval or stop controls.');
      if (input.kind === 'send' && this.store.actions(task.id).some(a => a.kind === 'send' && a.receipt === 'unknown' && a.sendStage !== 'preparing' && a.text.trim() === (input.text || '').trim() && JSON.stringify(a.uploadIds) === JSON.stringify(input.uploadIds || []))) throw new Conflict('An identical message has an uncertain outcome. Check its saved submission and conversation history before repeating it.');
      if (input.kind === 'continue' && !task.link) throw new Conflict('No confirmed conversation exists to continue.');
      if (input.kind === 'send' && !task.link && main?.receipt === 'unknown') throw new Conflict('Conversation creation is uncertain. It will not be repeated automatically.');
      let total = 0;
      for (const id of input.uploadIds || []) { const u = this.store.upload(id); if (!u?.complete) throw new Conflict('Wait for every attachment to finish uploading.'); total += u.size; }
      if (total > 100 * 1024 * 1024) throw new Conflict('Attachments exceed 100 MiB per message.');
    } else {
      if (!main || !binding || !this.gateway.online || binding.epoch !== this.gateway.epoch || input.generation !== binding.generation || input.targetId !== main.id) throw new Conflict('This control is stale. Refresh the conversation.');
    }
    const action: Action = { id: input.id, taskId: task.id, contextId: task.id, kind: input.kind, text: input.text || '', ...(input.answers ? { answers: input.answers } : {}), uploadIds: input.uploadIds || [], createdAt: Date.now(), updatedAt: Date.now(), state: 'preparing', phase: 'saved', receipt: 'pending', targetId: input.targetId, approvalId: input.approvalId, ...(input.kind === 'send' ? { sendStage: 'preparing' as const } : {}) };
    this.store.db.transaction(() => {
      if (input.kind === 'send') action.settings = this.settings.freeze(task.id, input);
      if (!['send', 'continue'].includes(input.kind)) {
        const key = `${input.generation}:${input.targetId}:${input.kind === 'stop' ? 'stop' : input.approvalId}`;
        if (this.store.db.prepare('SELECT key FROM control_receipts WHERE key=?').get(key)) throw new Conflict('This control was already submitted. Check its existing receipt.');
        this.store.db.prepare('INSERT INTO control_receipts VALUES (?,?)').run(key, input.id);
      }
      if (input.kind === 'stop' && main?.sendStage === 'preparing') { main.cancelSend = true; this.store.saveAction(main); }
      this.store.saveReceipt(input.id, input, { id: input.id }); this.store.saveAction(action);
    })();
    void this.dispatch(action, input).catch(error => {
      const current = this.store.action(action.id)!;
      current.state = 'unknown'; current.receipt = 'unknown'; current.error = 'Operation could not be confirmed. Review the conversation.'; this.store.saveAction(current);
      console.error('action handler failed', error instanceof Error ? error.name : 'unknown');
    });
    return action;
  }
  async step(a: Action, phase: string, method: string, params: any) {
    Object.assign(a, this.store.action(a.id), { phase }); this.store.saveAction(a);
    return this.gateway.rpc(method, params, method === 'session.resume' ? 180_000 : 60_000);
  }
  async dispatch(a: Action, input: ActionInput) {
    this.dispatching.add(a.id);
    let dispatched = false;
    try {
      await this.gateway.connect();
      const task = this.store.context(a.taskId)!;
      // Older Herts versions may have created the session before its duplicate
      // placeholder title was rejected. Reuse that session on a deliberate Send.
      const repairTitle = this.store.actions(task.id).some(prior => prior.id !== a.id && prior.kind === 'send' && prior.sendStage === 'preparing' && prior.receipt === 'rejected' && /Title .*already in use/.test(prior.error || ''))
        && !this.store.actions(task.id).some(prior => prior.kind === 'send' && prior.receipt === 'accepted');
      let b = this.store.binding(a.taskId);
      if (a.kind === 'send' && task.link && b?.ready && b.epoch === this.gateway.epoch) {
        try { await this.verifyBinding(b); }
        catch (error) {
          if (!(error instanceof GatewayError) || ![4001, 404].includes(error.code || 0)) throw error;
          b.ready = false; // An idle runtime can have been reaped since its last readiness check.
        }
      }
      if (a.kind === 'continue' || (a.kind === 'send' && task.link && (!b?.ready || b.epoch !== this.gateway.epoch))) {
        let c;
        try { c = await this.gateway.conversation(task.link!.storedId); } catch (error) {
          if (!(error instanceof GatewayError) || error.code !== 404 || !b || b.epoch !== this.gateway.epoch || !b.known || b.storedId !== task.link!.storedId) throw error;
          await this.verifyBinding(b);
          c = { id: b.storedId, aliases: [task.link!.key, b.storedId] };
        }
        this.checkSendNotCancelled(a.id);
        const previous = b; dispatched = true;
        const r = await this.step(a, 'preparing conversation', 'session.resume', { session_id: c.id, profile: this.gateway.profile, source: 'desktop', lazy: false, defer_history: false, omit_messages: true, eager_build: true });
        if (!r.session_id || !r.session_key || (r.info?.profile_name !== undefined && r.info.profile_name !== this.gateway.profile) || (!c.aliases.includes(r.session_key) && r.session_key !== c.id)) throw new GatewayError('The resumed conversation identity could not be verified.', true);
        b = { runtimeId: r.session_id, storedId: r.session_key, epoch: this.gateway.epoch, generation: randomUUID(), seq: previous && previous.runtimeId === r.session_id && previous.epoch === this.gateway.epoch ? previous.seq : 0, ready: false, monitored: true, known: !!(r.messages_omitted && typeof r.running === 'boolean' && ['idle', 'working', 'waiting', 'starting'].includes(r.status)) || !!(r.messages_omitted && Object.hasOwn(r, 'inflight') && r.resumed) || !!(previous?.known && previous.runtimeId === r.session_id && previous.epoch === this.gateway.epoch) };
        Object.assign(a, this.store.action(a.id)); a.binding = b;
        if (a.kind === 'continue') { a.receipt = 'accepted'; a.state = r.auto_continue || r.running ? 'running' : 'preparing'; }
        a.phase = r.auto_continue ? 'recovering interrupted work' : 'preparing conversation';
        this.store.saveBinding(task.id, b); this.store.saveAction(a);
        await this.replay(task.id, b, a.kind === 'send');
        if (a.kind === 'continue') return;
      }
      if (a.kind === 'send') {
        if (!task.link) {
          await this.settings.beforeCreate(a);
          dispatched = true;
          const r = await this.step(a, 'creating conversation', 'session.create', { profile: this.gateway.profile, source: 'desktop', close_on_disconnect: false, ...this.settings.createParams(a) });
          if (!r.session_id || !r.stored_session_id || r.info?.profile_name !== this.gateway.profile) throw new GatewayError('Conversation creation identity is not confirmed.', true);
          b = { runtimeId: r.session_id, storedId: r.stored_session_id, epoch: this.gateway.epoch, generation: randomUUID(), seq: 0, ready: false, monitored: true, known: true };
          this.store.linkNew(task.id, { key: r.stored_session_id, storedId: r.stored_session_id, title: task.title, source: 'desktop' });
          this.store.saveBinding(task.id, b); this.gateway.metadata = undefined;
        }
        if (!b || b.epoch !== this.gateway.epoch) throw new GatewayError('Conversation preparation was interrupted. Your message was not sent.');
        if (!task.link || repairTitle) await this.nameConversation(a, b, task.title);
        b = this.store.binding(task.id)!;
        a.binding = b;
        const live = await this.checkSendable(b, !!task.link && !a.settings);
        this.settings.observe(task.id, live.info, b);
        await this.settings.apply(a, b, live, async () => { this.checkSendNotCancelled(a.id); const live = await this.checkSendable(b!, false); this.checkSendNotCancelled(a.id); return live; }, (phase, method, params) => this.step(a, phase, method, params));
        b.ready = false; this.store.saveBinding(task.id, b);
        let text = a.text;
        for (const uploadId of a.uploadIds) {
          this.checkSendNotCancelled(a.id);
          const u = this.store.upload(uploadId)!; const bytes = await readFile(join(this.uploadDir, uploadId));
          dispatched = true;
          // Desktop's file attachment primitive stages bytes without modifying the next-turn image queue.
          // This makes a lost attachment receipt recoverable without leaking an old image into a later send.
          const result = await this.step(a, `attaching ${u.name}`, 'file.attach', { session_id: b.runtimeId, data_url: `data:${u.type};base64,${bytes.toString('base64')}`, name: u.name });
          if (typeof result.ref_text !== 'string' || !result.ref_text.startsWith('@file:')) throw new GatewayError('Attachment reference was not confirmed.', true);
          text += `\n${result.ref_text}`;
        }
        this.checkSendNotCancelled(a.id);
        if (a.settings) { await this.checkSendable(b, false); this.checkSendNotCancelled(a.id); }
        Object.assign(a, this.store.action(a.id), { sendStage: 'submitting', terminal: undefined, turnStarted: false, awaitingTurn: false, liveText: '' });
        this.store.saveAction(a); dispatched = true;
        const result = await this.step(a, 'submitting message', 'prompt.submit', { session_id: b.runtimeId, text });
        const updated = this.store.action(a.id)!;
        updated.receipt = 'accepted'; updated.sendStage = 'submitted'; updated.phase = result.status || 'accepted';
        updated.awaitingTurn = result.status === 'queued' && !updated.turnStarted;
        if (updated.awaitingTurn || (result.status === 'streaming' && !updated.turnStarted && updated.terminal !== 'error')) updated.terminal = undefined;
        if (updated.state === 'preparing') updated.state = 'running'; this.store.saveAction(updated);
        this.gateway.metadata = undefined; return;
      }
      b = this.store.binding(a.taskId)!;
      await this.verifyBinding(b);
      if (b.generation !== input.generation || this.main(a.taskId)?.id !== input.targetId) throw new GatewayError('Control no longer matches the active work.');
      a.binding = b;
      if (this.gateway.promptProtocol === 'requests' && ['approve', 'deny', 'clarify'].includes(a.kind)) {
        const prompt = this.gateway.prompts.list(b.runtimeId).find(p => p.id === a.approvalId);
        if (!prompt) throw new GatewayError('This prompt is no longer pending.');
        let result: { choice?: 'once' | 'deny'; answer?: string; answers?: Record<string, string> };
        if (a.kind === 'clarify') {
          if (prompt.method !== 'clarify') throw new GatewayError('This control does not match the pending question.');
          if (prompt.params.questions?.length) {
            const answers = { ...a.answers, ...prompt.params.answers };
            const keys = prompt.params.questions.map(q => q.qid);
            if (Object.keys(answers).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(prompt.params.answers || {}, key) && !answers[key]?.trim())) throw new GatewayError('Answer each pending question before sending.');
            result = { answers };
          } else {
            if (!a.text.trim()) throw new GatewayError('An answer is required.');
            result = { answer: a.text };
          }
        } else {
          if (prompt.method !== 'approval') throw new GatewayError('This control does not match the pending approval.');
          const choice = a.kind === 'approve' ? 'once' : 'deny';
          if (prompt.params.choices && !prompt.params.choices.includes(choice)) throw new GatewayError('Hermes does not allow this approval choice.');
          result = { choice };
        }
        a.phase = 'answering Hermes'; this.store.saveAction(a); dispatched = true;
        await this.gateway.answerPrompt(b.runtimeId, prompt.id, result);
        a.receipt = 'accepted'; a.state = 'finished'; a.phase = a.kind === 'clarify' ? 'answer confirmed' : 'decision confirmed';
      } else if (a.kind === 'approve' || a.kind === 'deny') {
        const pending = await this.gateway.rpc('approval.pending', { session_id: b.runtimeId });
        if (!pending.approvals?.some((p: any) => p.request_id === a.approvalId)) throw new GatewayError('This approval is no longer pending.');
        dispatched = true;
        const result = await this.step(a, 'responding to approval', 'approval.respond', { session_id: b.runtimeId, request_id: a.approvalId, choice: a.kind === 'approve' ? 'once' : 'deny', all: false });
        a.receipt = 'accepted'; a.state = 'finished'; a.phase = result.resolved === 1 ? 'decision confirmed' : 'no longer pending';
      } else if (a.kind === 'clarify') {
        const live = await this.gateway.rpc('session.activate', { session_id: b.runtimeId, omit_messages: true });
        if (!live.pending_clarify || live.pending_clarify.request_id !== a.approvalId) throw new GatewayError('This question is no longer pending.');
        dispatched = true;
        await this.step(a, 'answering question', 'clarify.respond', { session_id: b.runtimeId, request_id: a.approvalId, answer: a.text });
        a.receipt = 'accepted'; a.state = 'finished'; a.phase = 'answer confirmed';
      } else {
        dispatched = true;
        await this.step(a, 'requesting stop', 'session.interrupt', { session_id: b.runtimeId });
        a.receipt = 'accepted'; a.state = 'stopping'; a.phase = 'stop requested';
        const main = this.main(a.taskId); if (main && activeStates.has(main.state)) { main.state = 'stopping'; this.store.saveAction(main); }
      }
      this.store.saveAction(a); await this.reconcile(a.taskId);
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Operation failed');
      const current = this.store.action(a.id) || a;
      const uncertain = error instanceof GatewayError ? error.uncertain : dispatched;
      current.receipt = uncertain ? 'unknown' : 'rejected'; current.state = uncertain ? 'unknown' : 'failed'; current.error = err.message;
      if (current.sendStage === 'preparing') current.error += ' Your message was not sent; it remains saved.';
      this.store.saveAction(current);
      if (!dispatched) this.store.db.prepare('DELETE FROM control_receipts WHERE action_id=?').run(a.id);
      const b = this.store.binding(a.taskId); if (b) { b.ready = false; this.store.saveBinding(a.taskId, b); }
      this.store.notify(`${a.id}:failure`, a.taskId, 'failure');
    } finally {
      this.dispatching.delete(a.id);
      if (this.store.binding(a.taskId)) await this.reconcile(a.taskId);
    }
  }
  checkSendNotCancelled(id: string) {
    if (this.store.action(id)?.cancelSend) throw new GatewayError('Sending was cancelled by your stop request.');
  }
  async nameConversation(a: Action, b: Binding, requested: string) {
    const base = cleanConversationTitle(requested === 'New conversation' ? a.text.trim() || requested : requested) || 'New conversation';
    for (let attempt = 0; attempt < 100; attempt++) {
      const suffix = attempt ? ` (${attempt + 1})` : '';
      const title = [...base].slice(0, 100 - suffix.length).join('') + suffix;
      this.checkSendNotCancelled(a.id);
      try {
        const result = await this.step(a, 'saving conversation', 'session.title', { session_id: b.runtimeId, title });
        if (result.title !== title || result.pending) throw new GatewayError('The conversation title could not be confirmed. Your message remains saved.', true);
        const context = this.store.context(a.taskId)!;
        this.store.saveContext({ ...context, title, link: context.link ? { ...context.link, title } : null });
        this.store.bumpRevision(); this.store.emit('change', { type: 'contexts' }); this.gateway.metadata = undefined;
        return;
      } catch (error) {
        // Only retry a confirmed title collision, on the SAME session. A lost
        // response must never create another session or submit another prompt.
        if (!(error instanceof GatewayError) || error.uncertain || error.code !== 4022 || !/^Title .*already in use by session /.test(error.message)) throw error;
      }
    }
    throw new GatewayError('Choose a different conversation title before sending.');
  }
  async verifyBinding(b: Binding) {
    if (b.epoch !== this.gateway.epoch) throw new GatewayError('Hermes restarted. Sending your next message will prepare this conversation again.');
    const live = await this.gateway.rpc('session.activate', { session_id: b.runtimeId, omit_messages: true });
    if (live.session_id !== b.runtimeId || (live.info?.profile_name !== undefined && live.info.profile_name !== this.gateway.profile) || !live.session_key) throw new GatewayError('Execution identity could not be verified.');
    if (live.session_key !== b.storedId) {
      const c = await this.gateway.conversation(b.storedId);
      if (!c.aliases.includes(live.session_key)) { this.gateway.metadata = undefined; const fresh = await this.gateway.conversation(b.storedId); if (!fresh.aliases.includes(live.session_key)) throw new GatewayError('Conversation changed unexpectedly.'); }
      b.storedId = live.session_key;
    }
    const owner = this.store.bindings().find(([, saved]) => saved.generation === b.generation)?.[0];
    if (owner) this.settings.observe(owner, live.info, b);
    return live;
  }
  async checkSendable(b: Binding, allowBusy = false, attempt = 0): Promise<any> {
    const startSeq = b.seq;
    const live = await this.verifyBinding(b);
    const pending = await this.gateway.rpc('approval.pending', { session_id: b.runtimeId });
    const ctl = await this.gateway.rpc('session.control.read', { session_id: b.runtimeId });
    const current = this.store.bindings().find(([, binding]) => binding.generation === b.generation)?.[1];
    if (current && allowBusy) Object.assign(b, current);
    if (current && !allowBusy && startSeq !== current.seq && attempt < 3) { Object.assign(b, current); return this.checkSendable(b, allowBusy, attempt + 1); }
    if (!current || !b.known || typeof live.running !== 'boolean' || !Array.isArray(pending.approvals) || !ctl.control || (!allowBusy && (live.running || live.inflight || live.queued || live.pending_clarify || pending.approvals.length || controlBusy(ctl.control) || startSeq !== current.seq))) throw new GatewayError('Hermes execution state could not be confirmed.');
    return live;
  }
  async reconcile(taskId: string) {
    if (this.polling.has(taskId)) return; this.polling.add(taskId);
    try {
      const b = this.store.binding(taskId), a = this.main(taskId); if (!b || !a || b.epoch !== this.gateway.epoch) return;
      if (this.dispatching.has(a.id) || (a.state === 'preparing' && a.kind === 'send')) return;
      const seq = b.seq;
      const live = await this.verifyBinding(b);
      const pending = await this.gateway.rpc('approval.pending', { session_id: b.runtimeId });
      const ctl = await this.gateway.rpc('session.control.read', { session_id: b.runtimeId });
      const latestBinding = this.store.binding(taskId)!;
      if (latestBinding.generation !== b.generation || latestBinding.seq !== seq) return;
      const current = this.store.action(a.id)!;
      if (this.main(taskId)?.id !== a.id || this.dispatching.has(a.id)) return;
      if (this.gateway.promptProtocol === 'requests') this.projectPrompts(current, b);
      else { current.approvals = Array.isArray(pending.approvals) ? pending.approvals : undefined; current.clarification = live.pending_clarify; }
      if (!current.approvals) throw new GatewayError('Pending approvals could not be read.');
      if (current.approvals.length || current.clarification) {
        current.state = 'awaiting_input'; current.phase = current.approvals.length ? 'approval needed' : 'question from Hermes';
        for (const approval of current.approvals) this.store.notify(`${b.generation}:${approval.request_id}`, taskId, 'approval');
        if (current.clarification) this.store.notify(`${b.generation}:${current.clarification.request_id}`, taskId, 'approval');
      } else if (live.running || live.inflight || live.queued || controlBusy(ctl.control)) { if (current.state !== 'stopping') { current.state = 'running'; if (['approval needed', 'question from Hermes'].includes(current.phase)) current.phase = 'working'; } }
      else if (live.running === false && b.known) {
        const stops = this.store.actions(taskId).filter(x => x.targetId === current.id && x.kind === 'stop' && x.receipt === 'accepted' && x.state === 'stopping');
        if ((current.cancelSend || current.awaitingTurn) && stops.length) { current.terminal = 'interrupted'; current.awaitingTurn = false; }
        if (current.terminal && !current.awaitingTurn) { for (const stop of stops) { stop.state = 'finished'; stop.phase = 'work stopped'; this.store.saveAction(stop); } current.state = current.terminal === 'error' ? 'failed' : 'finished'; current.phase = current.terminal === 'interrupted' ? 'stopped' : current.terminal; b.ready = true; this.store.notify(`${current.id}:${current.terminal}`, taskId, current.state === 'failed' ? 'failure' : 'completion'); }
        else if (current.kind === 'continue' && current.phase !== 'recovering interrupted work') { current.state = 'ready'; current.phase = 'ready to send'; b.ready = true; }
        else if (current.sendStage === 'preparing' && current.receipt !== 'pending') { current.state = current.receipt === 'unknown' ? 'unknown' : 'failed'; current.phase = 'message not sent'; b.ready = true; }
      }
      if (!b.known && live.running === false && !current.approvals.length) { current.state = 'unknown'; current.error = 'Current execution state is unconfirmed. Check the saved submission and history; no request will be repeated.'; }
      this.store.saveBinding(taskId, b);
      if (JSON.stringify({ ...current, updatedAt: 0 }) !== JSON.stringify({ ...a, updatedAt: 0 })) this.store.saveAction(current);
    } catch { const b = this.store.binding(taskId); if (b) { b.ready = false; this.store.saveBinding(taskId, b); } }
    finally { this.polling.delete(taskId); }
  }
  private projectPrompts(action: Action, binding: Binding) {
    const requests = this.gateway.prompts.list(binding.runtimeId);
    action.approvals = requests.filter(p => p.method === 'approval').map(p => ({ ...p.params, request_id: p.id }));
    const question = requests.find(p => p.method === 'clarify');
    action.clarification = question ? { ...question.params, request_id: question.id } : undefined;
    action.promptWarning = this.gateway.prompts.warning(binding.runtimeId);
  }
  private promptsChanged(runtimeId: string) {
    for (const [taskId, b] of this.store.bindings()) {
      if (b.runtimeId !== runtimeId || b.epoch !== this.gateway.epoch) continue;
      const a = this.main(taskId); if (!a) continue;
      this.projectPrompts(a, b);
      if (a.approvals?.length || a.clarification) {
        if (!(a.kind === 'send' && a.sendStage === 'preparing')) { a.state = 'awaiting_input'; a.phase = a.approvals?.length ? 'approval needed' : 'question from Hermes'; }
        for (const prompt of [...(a.approvals || []), ...(a.clarification ? [a.clarification] : [])]) this.store.notify(`${b.generation}:${prompt.request_id}`, taskId, 'approval');
      } else if (a.state === 'awaiting_input') { a.state = 'running'; a.phase = 'working'; }
      this.store.saveAction(a);
    }
  }
  event(event: any) {
    if (event.type === 'sessions.changed') this.gateway.metadata = undefined;
    if (!event.session_id) return;
    for (const [taskId, b] of this.store.bindings()) {
      if (b.runtimeId !== event.session_id || b.epoch !== this.gateway.epoch || !Number.isInteger(event.seq) || event.seq <= b.seq) continue;
      if (event.type === 'session.info') this.settings.observe(taskId, event.payload, b);
      const a = this.main(taskId); if (!a) continue;
      b.seq = event.seq;
      const p = event.payload || {};
      const preparingSend = a.kind === 'send' && a.sendStage === 'preparing';
      if (event.type === 'message.start') { b.ready = false; if (!preparingSend) { a.turnStarted = true; a.awaitingTurn = false; a.state = 'running'; a.phase = 'working'; a.terminal = undefined; } a.liveText = ''; }
      if (event.type === 'message.delta') a.liveText = (a.liveText || '') + (p.text || p.delta || '');
      if (event.type === 'message.complete') { if (!preparingSend && !a.awaitingTurn) a.terminal = p.status || 'complete'; a.liveText = p.text || a.liveText; b.known = true; }
      if (event.type === 'approval.request') { if (!preparingSend) a.state = 'awaiting_input'; a.approvals = [...(a.approvals || []).filter(x => x.request_id !== p.request_id), p]; this.store.notify(`${b.generation}:${p.request_id}`, taskId, 'approval'); }
      if (event.type === 'tool.start' && !preparingSend) a.phase = p.name || p.tool || 'using a tool';
      if (event.type === 'status.update' && !preparingSend) a.phase = p.text || a.phase;
      if (event.type === 'error' && !preparingSend) { a.error = typeof p.message === 'string' ? p.message : 'Hermes reported an execution failure.'; a.terminal = 'error'; a.awaitingTurn = false; }
      this.store.saveBinding(taskId, b);
      this.store.saveAction(a);
      if (['session.info', 'message.complete', 'error', 'approval.resolved', 'session.control.update'].includes(event.type)) {
        const timer = setTimeout(() => { this.timers.delete(timer); void this.reconcile(taskId); }, 150); this.timers.add(timer);
      }
    }
  }
  async replay(taskId: string, b: Binding, freshSend = false) {
    const result = await this.gateway.rpc('session.events.since', { session_id: b.runtimeId, last_seen: b.seq });
    if (result.epoch !== b.epoch || result.truncated || (result.latest_seq < b.seq)) {
      // A new, deliberate Send can start observing from the current event boundary. Missing
      // earlier events must not be attributed to this message or change any previous receipt.
      if (freshSend && result.epoch === b.epoch && Number.isInteger(result.latest_seq) && result.latest_seq >= 0) {
        b.seq = Math.max(result.latest_seq, this.store.binding(taskId)?.seq || 0); this.store.saveBinding(taskId, b); return;
      }
      b.ready = false; b.known = false; this.store.saveBinding(taskId, b);
      const a = this.main(taskId); if (a) { a.state = 'unknown'; a.error = 'Some execution events are unavailable. Refresh history and review before continuing.'; this.store.saveAction(a); } return;
    }
    for (const e of result.events || []) this.event(e);
  }
  async reconnect() {
    for (const [taskId, b] of this.store.bindings()) {
      if (b.epoch !== this.gateway.epoch) {
        b.ready = false; b.known = false; this.store.saveBinding(taskId, b);
        const a = this.main(taskId); if (a && activeStates.has(a.state)) { a.state = 'unknown'; a.error = 'Hermes restarted. Review the available history. Sending a new message will prepare this conversation again; the previous message will not be resent.'; this.store.saveAction(a); } continue;
      }
      try { await this.replay(taskId, b); await this.reconcile(taskId); } catch { /* Keep previous receipts; never resume on reconnect. */ }
    }
  }
  close() { clearInterval(this.interval); this.timers.forEach(clearTimeout); }
}
