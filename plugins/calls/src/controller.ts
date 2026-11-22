import type { Action, VoiceLiveSession } from '@herts/plugin-api/types';

export type CallState = 'starting' | 'active' | 'closing' | 'ended' | 'failed' | 'unconfirmed';
export interface Fragment { speaker: 'user' | 'assistant'; text: string; start: number; end: number }
export interface Request {
  id: string; actionId: string; text: string; context: string;
  state: 'queued' | 'sending' | 'accepted' | 'finished' | 'unsent' | 'unknown';
  progress?: string;
  transcriptIndex?: number;
}
export type EndReason = 'user' | 'background' | 'connection' | 'timeout' | 'update' | 'disposed' | 'recovery';
export interface CallRecord {
  id: string; contextId: string; title: string; profile: string; state: CallState;
  endReason?: EndReason;
  startedAt: number; sessionId?: string; muted: boolean; error?: string; usageSeconds?: number;
  transcript: Fragment[]; requests: Request[];
}
export interface LiveEvent {
  type: string; event_id?: string; delta?: string; start_ms?: number; end_ms?: number; offset_ms?: number;
  delegation?: { id?: string }; session?: { id?: string }; usage?: { seconds?: number };
}
export interface Transport {
  start(create: (sdp: string) => Promise<VoiceLiveSession>): Promise<void>;
  send(event: Record<string, unknown>): boolean;
  mute(value: boolean): void;
  stopMedia(): void;
  dispose(): void;
}
export interface Dependencies {
  greeting: string;
  transport(event: (event: LiveEvent) => void, lost: () => void): Transport;
  acquire(): Promise<() => void>;
  create(sdp: string, call: CallRecord): Promise<VoiceLiveSession>;
  save(record: CallRecord): Promise<void>;
  submit(call: CallRecord, request: Request): Promise<Action>;
  changed(record: CallRecord): void;
  id(): string;
}

export const isLive = (state?: CallState) => state === 'starting' || state === 'active' || state === 'closing';
export class SetupError extends Error {
  constructor(message: string, readonly uncertain: boolean) { super(message); }
}

export function transcriptTurns(fragments: Fragment[]) {
  const turns: { speaker: Fragment['speaker']; text: string }[] = [];
  for (const fragment of fragments) {
    const last = turns.at(-1);
    if (last?.speaker === fragment.speaker) last.text += fragment.text;
    else turns.push({ speaker: fragment.speaker, text: fragment.text });
  }
  return turns;
}

export function spokenRequest(fragments: Fragment[], offset = Infinity) {
  const turns: { speaker: string; text: string }[] = [];
  for (const fragment of fragments.filter(f => f.start <= offset).slice(-80)) {
    const last = turns.at(-1);
    if (last?.speaker === fragment.speaker) last.text += fragment.text;
    else turns.push({ speaker: fragment.speaker, text: fragment.text });
  }
  return {
    text: turns.findLast(t => t.speaker === 'user')?.text.replace(/\s+/g, ' ').trim() || '',
    context: turns.map(t => `${t.speaker === 'user' ? 'User' : 'Voice assistant'}: ${t.text}`).join('\n').slice(-6000),
  };
}

// A byte bound keeps each append below the 500-token limit, including non-English text.
export function speechChunks(text: string) {
  const chunks: string[] = []; let chunk = '', bytes = 0;
  const encoder = new TextEncoder();
  for (const character of text.replace(/\s+/g, ' ').trim()) {
    const size = encoder.encode(character).length;
    if (bytes + size > 400) { chunks.push(chunk); chunk = ''; bytes = 0; }
    chunk += character; bytes += size;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

export class CallController {
  record?: CallRecord;
  private transport?: Transport;
  private release?: () => void;
  private startup?: ReturnType<typeof setTimeout>;
  private closing?: ReturnType<typeof setTimeout>;
  private writes: Promise<void> = Promise.resolve();
  private dispatching = false;
  private attempted = false;
  private events = new Set<string>();
  private actions: Action[] = [];
  private disposed = false;
  private acquiring = false;
  private cancelEpoch = 0;
  constructor(private deps: Dependencies) {}

  async restore(record: CallRecord) {
    if (this.record) return;
    this.record = structuredClone(record);
    if (isLive(record.state)) {
      this.record.state = 'unconfirmed';
      this.record.endReason ||= 'recovery';
      this.record.error = 'The previous call ended without confirmation. Review the conversation before starting another call.';
      this.unsent();
      for (const request of this.record.requests) if (request.state === 'sending') request.state = 'unknown';
    }
    this.change();
    await this.flush();
  }

  async start(context: { id: string; title: string; profile?: string }) {
    if (this.disposed || this.acquiring || isLive(this.record?.state)) return;
    const epoch = this.cancelEpoch; this.acquiring = true;
    let release: () => void;
    try { release = await this.deps.acquire(); } finally { this.acquiring = false; }
    if (this.disposed || this.cancelEpoch !== epoch || isLive(this.record?.state)) { release(); return; }
    this.release = release; this.attempted = false; this.events.clear();
    const record: CallRecord = { id: this.deps.id(), contextId: context.id, title: context.title,
      profile: context.profile || 'default', state: 'starting', startedAt: Date.now(), muted: false, transcript: [], requests: [] };
    this.record = record;
    this.change();
    try {
      await this.flush();
      if (record !== this.record || record.state !== 'starting') return;
      const transport = this.deps.transport(event => { if (this.record === record) this.event(event); }, () => {
        if (this.record === record && isLive(record.state)) {
          record.endReason ||= 'connection';
          this.finish(this.attempted ? 'unconfirmed' : 'failed', 'The call connection was lost. Review the conversation before starting another call.');
        }
      });
      this.transport = transport;
      this.startup = setTimeout(() => {
        if (this.record === record && record.state === 'starting') {
          record.endReason ||= 'timeout';
          this.finish(this.attempted ? 'unconfirmed' : 'failed', 'Call setup timed out. Review its status before starting another call.');
        }
      }, 45_000);
      await transport.start(async sdp => {
        if (this.record !== record || record.state !== 'starting') throw new SetupError('Call setup was cancelled.', false);
        this.attempted = true;
        const result = await this.deps.create(sdp, record);
        record.sessionId = result.session.id;
        if (this.record === record) this.change();
        return result;
      });
      if ((record.state as CallState) === 'closing') this.requestClose();
    } catch (error) {
      if (this.record !== record || !isLive(record.state)) return;
      const uncertain = error instanceof SetupError ? error.uncertain : this.attempted;
      const message = error instanceof SetupError ? error.message
        : !this.attempted ? 'Microphone or audio setup failed. Check browser permissions, then retry.'
        : 'Call setup was not confirmed. Review its status before starting another call.';
      this.finish(uncertain ? 'unconfirmed' : 'failed', message);
    }
  }

  private change() {
    if (!this.record) return;
    const snapshot = structuredClone(this.record);
    this.deps.changed(snapshot);
    this.writes = this.writes.catch(() => {}).then(() => this.deps.save(snapshot));
    void this.writes.catch(() => {
      if (this.record?.id !== snapshot.id) return;
      this.record.error = 'Call recovery could not be saved. End the call, then retry.';
      this.deps.changed(structuredClone(this.record));
      if (isLive(this.record.state)) this.end();
    });
  }
  flush() { return this.writes; }

  private event(event: LiveEvent) {
    const record = this.record;
    if (!record || !isLive(record.state)) return;
    if (event.event_id) {
      if (this.events.has(event.event_id)) return;
      this.events.add(event.event_id);
    }
    if (event.type === 'session.closed') {
      if (Number.isFinite(event.usage?.seconds)) record.usageSeconds = event.usage!.seconds;
      this.finish('ended'); return;
    }
    if (event.type === 'session.started') {
      record.sessionId = event.session?.id || record.sessionId;
      clearTimeout(this.startup);
      if (record.state === 'closing') { this.requestClose(); return; }
      if (record.state !== 'starting') return;
      record.state = 'active'; this.change();
      this.transport?.send({ type: 'session.commentary.append', content: this.deps.greeting, delegation_id: null, event_id: this.deps.id() });
      void this.pump(); return;
    }
    if (record.state !== 'active') return;
    if (event.type === 'session.input_transcript.delta' || event.type === 'session.output_transcript.delta') {
      if (typeof event.delta !== 'string' || !event.delta) return;
      record.transcript.push({ speaker: event.type === 'session.input_transcript.delta' ? 'user' : 'assistant',
        text: event.delta.slice(0, 20000), start: event.start_ms || 0, end: event.end_ms || 0 });
      this.change(); return;
    }
    if (event.type === 'session.delegation.created') {
      const id = event.delegation?.id;
      if (!id || id.length > 200 || record.requests.some(request => request.id === id)) return;
      const transcriptIndex = record.transcript.findLastIndex(fragment => fragment.speaker === 'user' && fragment.start <= (event.offset_ms ?? Infinity));
      const prompt = spokenRequest(record.transcript, event.offset_ms);
      const usedThrough = record.requests.reduce((index, request) => Math.max(index, request.transcriptIndex ?? -1), -1);
      prompt.text = transcriptIndex > usedThrough ? spokenRequest(record.transcript.slice(usedThrough + 1), event.offset_ms).text : '';
      record.requests.push({ id, actionId: this.deps.id(), transcriptIndex, ...prompt, state: prompt.text ? 'queued' : 'unsent' });
      if (!prompt.text) record.error = 'No spoken request was available. Please repeat the request.';
      this.change(); void this.pump(); return;
    }
    if (event.type === 'error') {
      record.error = 'Voice communication failed. End the call, then retry.';
      this.end();
    }
  }

  observe(actions: Action[]) {
    this.actions = actions;
    const record = this.record;
    if (!record) return;
    let changed = false;
    for (const request of record.requests) {
      if (!['sending', 'accepted', 'unknown'].includes(request.state)) continue;
      const action = actions.find(a => a.id === request.actionId && a.taskId === record.contextId);
      if (!action) continue;
      if (action.receipt === 'unknown' || action.state === 'unknown') {
        if (request.state !== 'unknown') { request.state = 'unknown'; this.unsent(); changed = true; }
        continue;
      }
      const done = ['finished', 'failed'].includes(action.state) || action.receipt === 'rejected';
      if (done) {
        request.state = action.receipt === 'rejected' ? 'unsent' : 'finished'; changed = true;
        if (record.state === 'active') {
          const text = action.state === 'finished' ? action.liveText || 'Hermes finished. Check the conversation for the result.'
            : 'Hermes could not complete this request. Check the conversation.';
          this.append('session.commentary.append', request.id, text);
        }
      } else {
        request.state = 'accepted';
        const progress = action.state === 'awaiting_input' ? 'Hermes needs your input on screen.' : 'Hermes is working on this request.';
        if (request.progress !== progress) {
          request.progress = progress; changed = true;
          if (record.state === 'active') this.append('session.thinking.append', request.id, progress);
        }
      }
    }
    if (changed) this.change();
    void this.pump();
  }

  private async pump() {
    const record = this.record;
    if (!record || record.state !== 'active' || this.dispatching) return;
    if (record.requests.some(r => ['sending', 'accepted', 'unknown'].includes(r.state))) return;
    if (this.actions.some(a => a.taskId === record.contextId && (a.receipt === 'unknown' || ['preparing', 'running', 'awaiting_input', 'stopping'].includes(a.state)))) return;
    const request = record.requests.find(r => r.state === 'queued');
    if (!request) return;
    this.dispatching = true;
    try {
      await this.flush();
      if (this.record !== record || record.state !== 'active' || request.state !== 'queued') return;
      request.state = 'sending'; this.change(); await this.flush();
      if (this.record !== record || record.state !== 'active') { request.state = 'unsent'; this.change(); return; }
      const action = await this.deps.submit(record, request);
      if (this.record === record) this.observe([action, ...this.actions.filter(a => a.id !== action.id)]);
    } catch {
      request.state = 'unknown'; this.unsent();
      record.error = 'The spoken request was not confirmed. Check the conversation before sending again.';
      if (this.record === record) this.change();
    } finally { this.dispatching = false; void this.pump(); }
  }

  private append(type: string, delegation_id: string, text: string) {
    for (const content of speechChunks(text)) this.transport?.send({ type, content, delegation_id, event_id: this.deps.id() });
  }
  mute() {
    if (this.record?.state !== 'active') return;
    this.record.muted = !this.record.muted;
    this.transport?.mute(this.record.muted); this.change();
  }
  private unsent() {
    for (const request of this.record?.requests || []) if (request.state === 'queued') request.state = 'unsent';
  }
  end(force = false, reason: EndReason = 'user') {
    this.cancelEpoch++;
    if (!this.record || !isLive(this.record.state)) return;
    this.record.endReason ||= reason;
    this.transport?.stopMedia(); this.unsent(); clearTimeout(this.startup);
    if (force || !this.attempted) {
      if (this.attempted) this.requestClose();
      if (isLive(this.record.state)) this.finish(this.attempted ? 'unconfirmed' : 'ended');
      return;
    }
    if (this.record.state === 'closing') return;
    this.record.state = 'closing'; this.change(); this.requestClose();
    if (this.record.state === 'closing') this.closing = setTimeout(() => this.finish('unconfirmed'), 15_000);
  }
  private requestClose() { this.transport?.send({ type: 'session.close', event_id: this.deps.id() }); }
  private finish(state: CallState, error?: string) {
    if (!this.record) return;
    this.record.state = state;
    if (error) this.record.error = error;
    if (state === 'unconfirmed' && !this.record.error) this.record.error = 'Call closure was not confirmed. Review the conversation before starting another call.';
    this.unsent(); clearTimeout(this.startup); clearTimeout(this.closing);
    const transport = this.transport; this.transport = undefined;
    transport?.dispose(); this.release?.(); this.release = undefined;
    this.change();
  }
  dispose() { this.end(true, 'disposed'); this.disposed = true; }
}
