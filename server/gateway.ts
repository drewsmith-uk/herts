import { AsyncLocalStorage } from 'node:async_hooks';
import { conversationRef, parseConversationRef } from '../shared/conversations.js';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { Conversation, History, HistoryOrder } from '../shared/core.js';
import { PromptRequests, previewUnavailable, type PromptRequest } from './promptRequests.js';

export class GatewayError extends Error {
  constructor(message: string, public uncertain = false, public code?: number) { super(message); }
}
export const personalSources = ['desktop', 'telegram', 'cli', 'tui', 'webui'];
export function isPersonal(row: any, excluded: string[] = [], owned = false) {
  const source = String(row.source || '').toLowerCase();
  const ids = [row.id, row._lineage_root_id, ...(row._lineage_ids || [])];
  return personalSources.includes(source) && !row.hidden && !row.room_plumbing && !ids.some(id => excluded.includes(id)) && (owned || !/^(?:test|e2e|smoke|probe|fixture|qa)(?:[\s:_-]|$)/i.test(row.title || ''));
}
export class Gateway extends EventEmitter {
  socket?: WebSocket; epoch = ''; online = false; closing = false;
  pending = new Map<string, { method: string; params: any; version: number; resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  promptProtocol: 'unknown' | 'legacy' | 'requests' = 'unknown';
  promptError?: string;
  promptWarning?: string;
  backendContract?: number;
  serverRequestMethods: string[] = [];
  private previewDeclines = false;
  readonly prompts = new PromptRequests(sid => this.emit('prompts', sid), (id, code, message) => {
    this.socket?.send(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }), () => {});
  }, id => {
    // Newer backends count per-client declines so an attached Desktop window
    // can still supply its preview. Older backends need a ValueResult: they
    // discard JSON-RPC error text before returning the tool result to the agent.
    const reply = this.previewDeclines
      ? { error: { code: 4404, message: previewUnavailable } }
      : { result: { value: JSON.stringify({ success: false, error: previewUnavailable }) } };
    this.socket?.send(JSON.stringify({ jsonrpc: '2.0', id, ...reply }), () => {});
  });
  private answering = new Set<string>();
  connecting?: Promise<void>; reconnectTimer?: NodeJS.Timeout; heartbeat?: NodeJS.Timeout;
  private scope = new AsyncLocalStorage<string>();
  private metadataByProfile = new Map<string, { at: number; rows: Conversation[] }>();
  private fetchingByProfile = new Map<string, Promise<Conversation[]>>();
  get profile() { return this.scope.getStore() || this.defaultProfile; }
  withProfile<T>(profile: string, fn: () => T): T { return this.scope.run(profile, fn); }
  ref(id: string, profile = this.profile) { return conversationRef(profile, id, this.defaultProfile); }
  get metadata() { return this.metadataByProfile.get(this.profile); }
  set metadata(value: { at: number; rows: Conversation[] } | undefined) { if (value) this.metadataByProfile.set(this.profile, value); else this.metadataByProfile.clear(); }
  get fetchingMetadata() { return this.fetchingByProfile.get(this.profile); }
  set fetchingMetadata(value: Promise<Conversation[]> | undefined) { if (value) this.fetchingByProfile.set(this.profile, value); else this.fetchingByProfile.delete(this.profile); }
  botChats: (profile: string, id: string) => boolean = () => false;
  constructor(public base: string, private token: string, private excluded: string[] = [], private owned: () => string[] = () => [], public readonly defaultProfile = 'default') { super(); }
  async http(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<any> {
    if (!this.base || !this.token) throw new GatewayError('Hermes connection is not configured.');
    let response: Response;
    try { response = await fetch(new URL(path, this.base), { method, redirect: 'error', headers: { 'X-Hermes-Session-Token': this.token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(body === undefined ? 30_000 : 180_000) }); }
    catch { throw new GatewayError('Hermes is unreachable. Your work is saved in Herts.', body !== undefined); }
    if (!response.ok) {
      const detail = method === 'PATCH' ? await response.json().catch(() => ({})) : {};
      throw new GatewayError(typeof detail.detail === 'string' ? detail.detail : `Hermes request failed (${response.status}).`, method !== 'GET' && response.status >= 500, response.status);
    }
    try { return await response.json(); }
    catch { throw new GatewayError('Hermes returned an invalid response.', body !== undefined); }
  }
  async renameConversation(id: string, title: string) {
    const result = await this.http(`/api/sessions/${encodeURIComponent(parseConversationRef(id).id)}`, { profile: this.profile, title }, 'PATCH');
    if (result.title !== title) throw new GatewayError('The new conversation title could not be confirmed. Refresh to check it.', true);
    this.metadata = undefined;
    return title;
  }
  connect(): Promise<void> {
    if (this.online) return Promise.resolve();
    if (this.connecting) return this.connecting;
    if (!this.base || !this.token) return Promise.reject(new GatewayError('Hermes connection is not configured.'));
    this.connecting = new Promise<void>((resolve, reject) => {
      this.promptProtocol = 'unknown'; this.promptError = undefined; this.serverRequestMethods = [];
      this.previewDeclines = false;
      this.promptWarning = undefined; this.backendContract = undefined;
      this.prompts.reset(); this.answering.clear();
      const url = new URL('/api/ws', this.base); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('token', this.token);
      const ws = new WebSocket(url, { handshakeTimeout: 15_000, maxPayload: 64 * 1024 * 1024 }); this.socket = ws;
      const readyTimer = setTimeout(() => { ws.terminate(); reject(new GatewayError('Hermes did not become ready.')); }, 20_000);
      ws.on('message', bytes => {
        if (ws !== this.socket) return;
        let frame: any; try { frame = JSON.parse(bytes.toString()); } catch { return; }
        if (frame.method === 'event') {
          const event = frame.params;
          if (event?.type === 'gateway.ready') {
            // Session changes may have been missed while disconnected.
            this.metadata = undefined;
            clearTimeout(readyTimer); this.epoch = event.payload?.replay_epoch || '';
            if (!this.epoch) { reject(new GatewayError('Hermes event identity is unavailable.')); ws.close(); return; }
            // Finish the capability handshake before any session can start work.
            void this.negotiatePrompts().then(() => {
              if (ws !== this.socket || ws.readyState !== WebSocket.OPEN) return;
              this.online = true; this.connecting = undefined; resolve(); this.emit('connected');
              clearInterval(this.heartbeat); this.heartbeat = setInterval(() => { void this.rpc('gateway.ping', {}, 15_000).catch(() => ws.terminate()); }, 20_000);
            }).catch(() => { this.promptError = 'Herts could not confirm Hermes prompt compatibility. Reconnect or update Herts and Hermes before sending.'; reject(new GatewayError(this.promptError)); ws.close(); });
          } else if (event) {
            if (event.type === 'session.info') this.observeContract(event.payload);
            if (event.type === 'message.start') this.prompts.clearWarning(event.session_id);
            if (event.type === 'request.cancel' && typeof event.payload?.id === 'string') this.prompts.close(event.payload.id, event.session_id);
            this.emit('event', event);
          }
        } else if (frame.method && frame.id) {
          this.prompts.receive(frame);
        } else if (frame.id) {
          const pending = this.pending.get(String(frame.id)); if (!pending) return;
          clearTimeout(pending.timer); this.pending.delete(String(frame.id));
          if (frame.error) {
            const mutating = ['session.create', 'session.title', 'session.resume', 'prompt.submit', 'file.attach', 'approval.respond', 'clarify.respond', 'request.answer', 'session.interrupt', 'config.set', 'session.cwd.set', 'profiles.create', 'profiles.configure', 'cron.manage'].includes(pending.method);
            const validation = (frame.error.code >= 4000 && frame.error.code < 4100) || [-32601, -32602].includes(frame.error.code);
            pending.reject(new GatewayError(String(frame.error.message || 'Hermes refused the request.').replaceAll(this.token, '[redacted]'), mutating && !validation, frame.error.code));
          } else {
            try {
              this.observeContract(frame.result?.info || frame.result);
              if (['session.activate', 'session.resume', 'session.events.since'].includes(pending.method)) {
                const result = frame.result;
                if (this.promptProtocol === 'requests') {
                  // Hermes omits open_requests when no prompts are pending.
                  if (result?.open_requests !== undefined && !Array.isArray(result.open_requests)) throw new GatewayError('Hermes returned incompatible pending prompt state. Update Herts and Hermes before continuing.', pending.method === 'session.resume');
                  this.prompts.restore(result.session_id || pending.params.session_id, result.open_requests || [], pending.version);
                } else if ((this.backendContract || 0) >= 7) throw new GatewayError('This Hermes backend requires the newer prompt protocol. Update Herts and Hermes before continuing.', pending.method === 'session.resume');
              }
              pending.resolve(frame.result);
            } catch (error) { pending.reject(error as Error); }
          }
        }
      });
      ws.on('error', () => { clearTimeout(readyTimer); reject(new GatewayError('Hermes connection failed.')); });
      ws.on('close', () => {
        clearTimeout(readyTimer); clearInterval(this.heartbeat); this.online = false; this.connecting = undefined;
        for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new GatewayError('Connection lost; outcome is not confirmed.', true)); } this.pending.clear();
        this.emit('disconnected'); reject(new GatewayError('Hermes disconnected.'));
        if (!this.closing) this.reconnectTimer = setTimeout(() => { void this.connect().catch(() => {}); }, 5_000);
      });
    });
    return this.connecting;
  }
  async rpc(method: string, params: any, timeout = 60_000): Promise<any> {
    await this.connect();
    const profile = params.profile || parseConversationRef(params.session_id || '').profile || this.profile;
    const wire = { ...params };
    if (wire.session_id) wire.session_id = parseConversationRef(wire.session_id).id;
    const result = await this.request(method, wire, timeout);
    if (['session.create', 'session.resume', 'session.activate'].includes(method)) {
      if (result.session_key) result.session_key = this.ref(result.session_key, profile);
      if (result.stored_session_id) result.stored_session_id = this.ref(result.stored_session_id, profile);
    }
    return result;
  }
  private async negotiatePrompts() {
    try {
      const result = await this.request('client.capabilities', { server_requests: true }, 15_000);
      if (!Array.isArray(result?.server_requests) || !result.server_requests.every((x: unknown) => typeof x === 'string') || !['approval', 'clarify'].every(x => result.server_requests.includes(x))) throw new GatewayError('Incompatible Hermes prompt capabilities.');
      this.serverRequestMethods = result.server_requests; this.promptProtocol = 'requests';
      this.previewDeclines = result.declines_not_shown === true;
    } catch (error) {
      // Only a definite "method not found" identifies an older backend.
      if (error instanceof GatewayError && error.code === -32601) this.promptProtocol = 'legacy';
      else throw error;
    }
  }
  private observeContract(info: any) {
    const contract = info?.desktop_contract;
    if (!Number.isInteger(contract) || this.backendContract === contract) return;
    this.backendContract = contract;
    this.promptWarning = contract > 8 ? 'Hermes reports a newer Desktop interface than this Herts version has been checked against. Check for a Herts update if interactive prompts fail.' : undefined;
    this.emit('compatibility');
  }
  private request(method: string, params: any, timeout: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => { this.pending.delete(id); reject(new GatewayError('Hermes response was not confirmed. The request will not be repeated.', true)); }, timeout);
      this.pending.set(id, { method, params, version: this.prompts.version, resolve, reject, timer });
      this.socket!.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }), error => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(new GatewayError('Submission outcome is unknown.', true)); }
      });
    });
  }
  async answerPrompt(session: string, id: string, result: { choice?: 'once' | 'deny'; answer?: string; answers?: Record<string, string> }) {
    if (!this.online || this.promptProtocol !== 'requests') throw new GatewayError('Hermes disconnected. Refresh before answering.');
    const prompt = this.prompts.list(session).find(p => p.id === id);
    if (!prompt || this.answering.has(id)) throw new GatewayError('This prompt is no longer pending or a response was already submitted.');
    this.answering.add(id);
    try {
      // Official proxy for response frames: unlike a socket write, it confirms
      // whether the still-open request accepted the answer (also after reconnect).
      const ack = await this.rpc('request.answer', { id, result });
      if (!['ok', 'expired'].includes(ack?.status)) throw new GatewayError('Hermes did not confirm the response. It will not be repeated.', true);
      this.prompts.close(id, session);
      if (ack.status === 'expired') throw new GatewayError('This prompt expired or was answered elsewhere. Your response was not applied.');
    } catch (error) {
      if (!(error instanceof GatewayError) || error.code !== -32601) throw error;
      await this.answerWithoutProxy(prompt, result);
    }
  }
  private async answerWithoutProxy(prompt: PromptRequest, result: any) {
    if (!this.online || !this.prompts.list(prompt.params.session_id).some(p => p.id === prompt.id)) throw new GatewayError('This prompt is no longer pending.');
    if (prompt.method === 'approval') {
      const ack = await this.rpc('approval.respond', { session_id: prompt.params.session_id, request_id: prompt.params.request_id, choice: result.choice, all: false });
      if (ack.resolved !== 1) throw new GatewayError('This approval is no longer pending.');
      this.prompts.close(prompt.id); return;
    }
    // Earlier request-protocol backends have no acknowledged proxy for clarify.
    // Deliver the normal JSON-RPC response once, but never claim confirmation.
    await new Promise<void>((resolve, reject) => this.socket!.send(JSON.stringify({ jsonrpc: '2.0', id: prompt.id, result }), error => error ? reject(new GatewayError('The answer could not be confirmed. It will not be repeated.', true)) : resolve()));
    throw new GatewayError('The answer was sent, but this Hermes version cannot confirm receipt. Check the conversation; it will not be repeated.', true);
  }
  async conversations(force = false): Promise<Conversation[]> {
    if (!force && this.metadata && Date.now() - this.metadata.at < 60_000) return this.metadata.rows;
    if (this.fetchingMetadata) return this.fetchingMetadata;
    this.fetchingMetadata = (async () => {
      const rows = new Map<string, Conversation>(); let offset = 0;
      for (;;) {
        const result = await this.http(`/api/sessions?profile=${encodeURIComponent(this.profile)}&order=recent&archived=include&limit=100&offset=${offset}&sources=${personalSources.join(',')}`);
        if (!Array.isArray(result.sessions)) throw new GatewayError('Hermes returned an invalid conversation list.');
        if (result.sessions.some((row: any) => row.profile !== undefined && row.profile !== this.profile)) throw new GatewayError('Conversation list profile could not be verified.');
        for (const row of result.sessions) if (isPersonal(row, this.excluded)) {
          const root = row._lineage_root_id || row.id;
          rows.set(root, { profile: this.profile, id: this.ref(row.id), key: this.ref(root), aliases: [...new Set<string>([root, row.id, ...(row._lineage_ids || [])])].map(id => this.ref(id)), title: row.title || row.preview?.slice(0, 80) || 'Untitled conversation', preview: row.preview || '', source: row.source, updatedAt: (row.last_active || row.started_at || 0) * 1000 });
        }
        offset += 100;
        if (offset >= Number(result.total) || result.sessions.length === 0) break;
        if (offset >= 100_000) throw new GatewayError('The conversation listing exceeded its supported window.');
      }
      const all = [...rows.values()].sort((a, b) => b.updatedAt - a.updatedAt);
      this.metadata = { at: Date.now(), rows: all }; return all;
    })();
    try { return await this.fetchingMetadata; } finally { this.fetchingMetadata = undefined; }
  }
  async conversation(id: string): Promise<Conversation> {
    const parsed = parseConversationRef(id);
    if (parsed.profile && parsed.profile !== this.profile) return this.withProfile(parsed.profile, () => this.conversation(id));
    const rows = await this.conversations(); const c = rows.find(r => r.key === id || r.aliases.includes(id));
    if (c) return this.botChats(this.profile, id) ? { ...c, botChat: true } : c;
    if (!this.owned().includes(id)) throw new GatewayError('This personal conversation is unavailable.', false, 404);
    const row = await this.http(`/api/sessions/${encodeURIComponent(parsed.id)}?profile=${encodeURIComponent(this.profile)}`);
    const excluded = [row.id, row._lineage_root_id, ...(row._lineage_ids || [])].some(value => this.excluded.includes(value));
    const canonical = row.title === 'Bot Chat' && this.botChats(this.profile, id) && personalSources.includes(String(row.source || '').toLowerCase()) && !row.room_plumbing;
    if (row.profile !== this.profile || excluded || !(isPersonal(row, this.excluded, true) || canonical) || row.id !== parsed.id) throw new GatewayError('Conversation ownership could not be verified.', false, 404);
    return { profile: this.profile, botChat: this.botChats(this.profile, id), id: this.ref(row._lineage_tip_id || row.id), key: this.ref(row._lineage_root_id || row.id), aliases: [...new Set<string>([row.id, row._lineage_root_id, ...(row._lineage_ids || [])].filter(Boolean))].map(id => this.ref(id)), title: row.title || 'Conversation', preview: '', source: row.source, updatedAt: (row.last_active || row.started_at || 0) * 1000 };
  }
  async search(query: string) {
    const rows = await this.conversations(); if (!query) return rows;
    const found = await this.http(`/api/sessions/search?profile=${encodeURIComponent(this.profile)}&limit=100&q=${encodeURIComponent(query)}&sources=${personalSources.join(',')}`);
    const hits = new Set((found.results || found.matches || []).flatMap((r: any) => [r.session_id, r.lineage_root]));
    return rows.filter(r => `${r.title} ${r.preview}`.toLowerCase().includes(query.toLowerCase()) || r.aliases.some(id => hits.has(parseConversationRef(id).id)));
  }
  async history(id: string, offset: number, order: HistoryOrder = 'oldest'): Promise<History> {
    const parsed = parseConversationRef(id);
    if (parsed.profile && parsed.profile !== this.profile) return this.withProfile(parsed.profile, () => this.history(id, offset, order));
    const c = await this.conversation(id);
    const data = await this.http(`/api/sessions/${encodeURIComponent(parseConversationRef(c.id).id)}/messages?profile=${encodeURIComponent(this.profile)}&include_compacted=true&order=${order}&limit=200&offset=${offset}`);
    if (!Array.isArray(data.messages) || data.profile !== this.profile) throw new GatewayError('Conversation identity could not be verified.');
    return { profile: this.profile, order, sessionId: data.session_id, messages: data.messages.filter((m: any) => m.display_kind !== 'hidden' && !['system', 'developer'].includes(m.role)), offset, hasMore: data.pagination?.returned === 200, fetchedAt: Date.now() };
  }
  close() { this.closing = true; clearTimeout(this.reconnectTimer); clearInterval(this.heartbeat); this.socket?.close(); }
}
