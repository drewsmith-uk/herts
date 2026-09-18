import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { Conversation, History, HistoryOrder } from '../shared/model.js';

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
  pending = new Map<string, { method: string; resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  connecting?: Promise<void>; reconnectTimer?: NodeJS.Timeout; heartbeat?: NodeJS.Timeout;
  metadata?: { at: number; rows: Conversation[] }; fetchingMetadata?: Promise<Conversation[]>;
  constructor(public base: string, private token: string, private excluded: string[] = [], private owned: () => string[] = () => [], public readonly profile = 'default') { super(); }
  async http(path: string, body?: unknown): Promise<any> {
    if (!this.base || !this.token) throw new GatewayError('Hermes connection is not configured.');
    let response: Response;
    try { response = await fetch(new URL(path, this.base), { method: body === undefined ? 'GET' : 'POST', redirect: 'error', headers: { 'X-Hermes-Session-Token': this.token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(body === undefined ? 30_000 : 180_000) }); }
    catch { throw new GatewayError('Hermes is unreachable. Your work is saved in Herts.', body !== undefined); }
    if (!response.ok) throw new GatewayError(`Hermes request failed (${response.status}).`, false, response.status);
    try { return await response.json(); }
    catch { throw new GatewayError('Hermes returned an invalid response.', body !== undefined); }
  }
  connect(): Promise<void> {
    if (this.online) return Promise.resolve();
    if (this.connecting) return this.connecting;
    if (!this.base || !this.token) return Promise.reject(new GatewayError('Hermes connection is not configured.'));
    this.connecting = new Promise<void>((resolve, reject) => {
      const url = new URL('/api/ws', this.base); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('token', this.token);
      const ws = new WebSocket(url, { handshakeTimeout: 15_000, maxPayload: 64 * 1024 * 1024 }); this.socket = ws;
      const readyTimer = setTimeout(() => { ws.terminate(); reject(new GatewayError('Hermes did not become ready.')); }, 20_000);
      ws.on('message', bytes => {
        let frame: any; try { frame = JSON.parse(bytes.toString()); } catch { return; }
        if (frame.method === 'event') {
          const event = frame.params;
          if (event?.type === 'gateway.ready') {
            clearTimeout(readyTimer); this.epoch = event.payload?.replay_epoch || ''; this.online = !!this.epoch;
            if (!this.epoch) { reject(new GatewayError('Hermes event identity is unavailable.')); ws.close(); return; }
            this.connecting = undefined; resolve(); this.emit('connected');
            clearInterval(this.heartbeat); this.heartbeat = setInterval(() => { void this.rpc('gateway.ping', {}, 15_000).catch(() => ws.terminate()); }, 20_000);
          } else if (event) this.emit('event', event);
        } else if (frame.id) {
          const pending = this.pending.get(String(frame.id)); if (!pending) return;
          clearTimeout(pending.timer); this.pending.delete(String(frame.id));
          if (frame.error) {
            const mutating = ['session.create', 'session.title', 'session.resume', 'prompt.submit', 'file.attach', 'approval.respond', 'clarify.respond', 'session.interrupt'].includes(pending.method);
            const validation = frame.error.code >= 4000 && frame.error.code < 4100;
            pending.reject(new GatewayError(String(frame.error.message || 'Hermes refused the request.').replaceAll(this.token, '[redacted]'), mutating && !validation, frame.error.code));
          } else pending.resolve(frame.result);
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
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => { this.pending.delete(id); reject(new GatewayError('Hermes response was not confirmed. The request will not be repeated.', true)); }, timeout);
      this.pending.set(id, { method, resolve, reject, timer });
      this.socket!.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }), error => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(new GatewayError('Submission outcome is unknown.', true)); }
      });
    });
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
          rows.set(root, { id: row.id, key: root, aliases: [...new Set([root, row.id, ...(row._lineage_ids || [])])], title: row.title || row.preview?.slice(0, 80) || 'Untitled conversation', preview: row.preview || '', source: row.source, updatedAt: (row.last_active || row.started_at || 0) * 1000 });
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
    const rows = await this.conversations(); const c = rows.find(r => r.key === id || r.aliases.includes(id));
    if (c) return c;
    if (!this.owned().includes(id)) throw new GatewayError('This personal conversation is unavailable.', false, 404);
    const row = await this.http(`/api/sessions/${encodeURIComponent(id)}?profile=${encodeURIComponent(this.profile)}`);
    if (row.profile !== this.profile || !isPersonal(row, this.excluded, true) || row.id !== id) throw new GatewayError('Conversation ownership could not be verified.', false, 404);
    return { id, key: id, aliases: [id], title: row.title || 'Conversation', preview: '', source: row.source, updatedAt: (row.last_active || row.started_at || 0) * 1000 };
  }
  async search(query: string) {
    const rows = await this.conversations(); if (!query) return rows;
    const found = await this.http(`/api/sessions/search?profile=${encodeURIComponent(this.profile)}&limit=100&q=${encodeURIComponent(query)}&sources=${personalSources.join(',')}`);
    const hits = new Set((found.results || found.matches || []).flatMap((r: any) => [r.session_id, r.lineage_root]));
    return rows.filter(r => `${r.title} ${r.preview}`.toLowerCase().includes(query.toLowerCase()) || r.aliases.some(id => hits.has(id)));
  }
  async history(id: string, offset: number, order: HistoryOrder = 'oldest'): Promise<History> {
    const c = await this.conversation(id);
    const data = await this.http(`/api/sessions/${encodeURIComponent(c.id)}/messages?profile=${encodeURIComponent(this.profile)}&include_compacted=true&order=${order}&limit=200&offset=${offset}`);
    if (!Array.isArray(data.messages) || data.profile !== this.profile) throw new GatewayError('Conversation identity could not be verified.');
    return { order, sessionId: data.session_id, messages: data.messages.filter((m: any) => m.display_kind !== 'hidden' && !['system', 'developer'].includes(m.role)), offset, hasMore: data.pagination?.returned === 200, fetchedAt: Date.now() };
  }
  close() { this.closing = true; clearTimeout(this.reconnectTimer); clearInterval(this.heartbeat); this.socket?.close(); }
}
