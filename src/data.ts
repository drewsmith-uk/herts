import { applyReadingOp, emptyReading, normalizeUrl, retainsArticle, type ReadingOp, type Article, type ConversationContext } from '../shared/reading';
import Dexie, { type Table } from 'dexie';
import { useSyncExternalStore } from 'react';
import type { HistoryBaseline, OutgoingMessage } from './transcriptFeedback';
import { applyTaskOp, applySpaceOp, withSpaces, originalSpaceId, taskSpaceId, spaceLists, applyConversationVisibility, emptySnapshot, type Snapshot, type TaskOp, type SpaceOp, type Action, type Binding, type Status, type Conversation, type ConversationVisibilityOp } from '../shared/model';

export interface PendingSpace { id: string; op: SpaceOp; order: number; conflict?: string }
export interface Pending { id: string; op: TaskOp; order: number; conflict?: string }
export interface LocalFile { id: string; name: string; type: string; blob: Blob; hash?: string }
export interface Draft { id: string; text: string; files: string[] }
export interface Recording { id: string; owner: string; chunks: Blob[]; type: string; at: number; complete: boolean }
export interface PendingReading { op: ReadingOp; order: number; conflict?: string }
interface PendingVisibility { op: ConversationVisibilityOp; order: number }
class LocalDB extends Dexie {
  kv!: Table<{ key: string; value: any }, string>; pending!: Table<Pending, string>; drafts!: Table<Draft, string>;
  files!: Table<LocalFile, string>; submissions!: Table<{ id: string; input: any; at: number; confirmed: boolean; baseline?: HistoryBaseline }, string>; recordings!: Table<Recording, string>; articles!: Table<Article, string>; readingPending!: Table<PendingReading, string>; spacePending!: Table<PendingSpace, string>;
  // Keep this name so installed clients retain drafts, recordings and pending changes.
  constructor() { super('hermes-tasks'); this.version(1).stores({ kv: 'key', pending: 'id,op.taskId,order', drafts: 'id', files: 'id', submissions: 'id', recordings: 'id,owner' }); this.version(2).stores({ articles: 'itemId', readingPending: 'op.id,order' });
    this.version(3).stores({ spacePending: 'id,op.spaceId,order' }).upgrade(async tx => {
      const capture = await tx.table('drafts').get('capture');
      if (capture) { await tx.table('drafts').put({ ...capture, id: `capture:${originalSpaceId}` }); await tx.table('drafts').delete('capture'); }
      await tx.table('recordings').where('owner').equals('capture').modify({ owner: `capture:${originalSpaceId}` });
      // Leave pending request payloads untouched: their IDs hash the exact content.
      const saved = await tx.table('kv').get('state');
      if (saved) await tx.table('kv').put({ key: 'state', value: { ...saved.value, snapshot: withSpaces(saved.value.snapshot) } });
    });
  }
}
export const db = new LocalDB();
interface State { snapshot: Snapshot; remote: Snapshot; actions: Action[]; bindings: Record<string, Binding>; pending: Pending[]; spacePending: PendingSpace[]; viewedSpaceId: string; visibilityPending: PendingVisibility[]; readingPending: PendingReading[]; articleCopies: Record<string, Article>; articleErrors: Record<string, { version: number; message: string }>; online: boolean; loaded: boolean; defaultsReady: boolean; gateway: { online: boolean; configured: boolean; profile?: string }; error: string; pushKey: string; localSubmissions: { id: string; taskId: string }[]; outgoing: OutgoingMessage[] }
let state: State = { snapshot: emptySnapshot(), remote: emptySnapshot(), actions: [], bindings: {}, pending: [], spacePending: [], viewedSpaceId: originalSpaceId, visibilityPending: [], readingPending: [], articleCopies: {}, articleErrors: {}, online: false, loaded: false, defaultsReady: false, gateway: { online: false, configured: false }, error: '', pushKey: '', localSubmissions: [], outgoing: [] };
const listeners = new Set<() => void>(); let syncing = false, refreshing = false;
export function publish(patch: Partial<State> = {}) { state = { ...state, ...patch }; for (const fn of listeners) fn(); }
export function useApp() { return useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn); }, () => state); }
export class ApiError extends Error { constructor(message: string, public status: number, public data: any) { super(message); } }
export async function api(path: string, body?: unknown, method?: string, timeout = 190_000): Promise<any> {
  let r: Response;
  try { r = await fetch(`/api/v1${path}`, { method: method || (body === undefined ? 'GET' : 'POST'), headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Herts-Request': '1' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout), cache: 'no-store' }); }
  catch { throw new ApiError('Connection lost. Your saved work is still on this device.', 0, null); }
  const data = await r.json().catch(() => ({})); if (!r.ok) throw new ApiError(data.error || `Request failed (${r.status})`, r.status, data); return data;
}
async function pendingVisibility(): Promise<PendingVisibility[]> {
  return (await db.kv.where('key').startsWith('visibility-op:').toArray()).map(row => row.value as PendingVisibility).sort((a, b) => a.order - b.order);
}
async function rebuild() {
  const pending = await db.pending.orderBy('order').toArray(); let snapshot: Snapshot = withSpaces(state.remote);
  const spacePending = await db.spacePending.orderBy('order').toArray();
  for (const p of spacePending) { try { snapshot = applySpaceOp(snapshot, p.op, false); } catch { /* Preserve the operation for recovery. */ } }
  for (const p of pending) { try { snapshot = applyTaskOp(snapshot, p.op, false); } catch { /* Conflict remains visible. */ } }
  const visibilityPending = await pendingVisibility();
  for (const p of visibilityPending) snapshot = { ...snapshot, hiddenConversations: applyConversationVisibility(snapshot.hiddenConversations || [], p.op) };
  const readingPending = await db.readingPending.orderBy('order').toArray();
  for (const p of readingPending) {
    try {
      snapshot = { ...snapshot, reading: applyReadingOp(snapshot.reading || emptyReading(), p.op, false) };
      if (p.op.kind === 'create' && !(snapshot.contexts || []).some(c => c.id === p.op.contextId)) {
        snapshot = { ...snapshot, contexts: [...(snapshot.contexts || []), { id: p.op.contextId!, title: p.op.title || p.op.url!, link: p.op.conversationId ? { key: p.op.conversationId, storedId: p.op.conversationId, source: '', title: p.op.title || '' } : null, aliases: p.op.conversationId ? [p.op.conversationId] : [] }] };
      }
    } catch { /* Keep the durable operation visible for conflict resolution. */ }
  }
  const reading = snapshot.reading || emptyReading();
  const copies = await db.articles.toArray();
  for (const copy of copies) { const item = reading.items.find(i => i.id === copy.itemId); if (!item || !retainsArticle(item, reading) || item.downloadVersion !== copy.version) await db.articles.delete(copy.itemId); }
  const articleCopies = Object.fromEntries((await db.articles.toArray()).map(a => [a.itemId, a]));
  const submissions = await db.submissions.toArray();
  const outgoing = submissions.filter(s => s.input.kind === 'send').map(s => ({ id: s.id, taskId: s.input.contextId || snapshot.tasks.find(t => t.id === s.input.taskId)?.contextId || s.input.taskId, text: s.input.text || '', uploadIds: s.input.uploadIds || [], at: s.at, baseline: s.baseline }));
  const localSubmissions = submissions.filter(x => !x.confirmed && !state.actions.some(a => a.id === x.id)).map(x => ({ id: x.id, taskId: x.input.contextId || snapshot.tasks.find(t => t.id === x.input.taskId)?.contextId || x.input.taskId }));
  publish({ snapshot, pending, spacePending, visibilityPending, readingPending, articleCopies, localSubmissions, outgoing });
}
export async function initialise() {
  try {
    const saved = (await db.kv.get('state'))?.value;
    if (saved) publish({ remote: withSpaces(saved.snapshot), actions: saved.actions || [], bindings: {} });
    const viewed = (await db.kv.get('viewed-space'))?.value;
    await rebuild(); publish({ loaded: true, defaultsReady: !!saved, viewedSpaceId: state.snapshot.spaces?.some(s => s.id === viewed) ? viewed : state.snapshot.defaultSpaceId || originalSpaceId });
    if ('storage' in navigator && navigator.storage.persist) void navigator.storage.persist();
    void refresh().finally(() => publish({ defaultsReady: true, ...(!saved && !viewed ? { viewedSpaceId: state.remote.defaultSpaceId || originalSpaceId } : {}) }));
    window.addEventListener('online', () => { void refresh(); }); window.addEventListener('offline', () => publish({ online: false }));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refresh(); });
    const events = new EventSource('/api/v1/events'); let debounce: ReturnType<typeof setTimeout>;
    events.addEventListener('refresh', () => { if (debounce) return; debounce = setTimeout(() => { debounce = undefined!; void refresh(); }, 150); });
    events.onerror = () => { /* Polling distinguishes server reachability from a dropped stream. */ };
    setInterval(() => { if (navigator.onLine && document.visibilityState === 'visible') void refresh(); }, 8000);
  } catch { publish({ loaded: true, defaultsReady: true, error: 'Device storage is unavailable. Changes cannot be safely saved. Check browser storage settings.' }); }
}
export async function refresh() {
  if (refreshing) return; refreshing = true;
  try {
    const data = await api('/state');
    const actions = new Map(state.actions.map(a => [a.id, a]));
    for (const action of data.actions as Action[]) if (!actions.has(action.id) || actions.get(action.id)!.updatedAt < action.updatedAt) actions.set(action.id, action);
    data.actions = [...actions.values()].sort((a, b) => b.createdAt - a.createdAt);
    await acceptSnapshot(data.snapshot, data.actions);
    publish({ actions: data.actions, bindings: data.bindings, gateway: data.gateway, online: true, pushKey: data.pushKey, error: '' });
    for (const s of await db.submissions.toArray()) if (data.actions.some((a: Action) => a.id === s.id)) await db.submissions.update(s.id, { confirmed: true });
    await rebuild(); void sync(); void downloadArticles();
  } catch (e) { publish({ online: false, error: e instanceof ApiError && e.status === 403 ? e.message : '' }); }
  finally { refreshing = false; }
}
async function acceptSnapshot(snapshot: Snapshot, actions = state.actions) {
  snapshot = withSpaces(snapshot);
  await db.transaction('rw', db.kv, async () => {
    const saved = (await db.kv.get('state'))?.value;
    const chosen = saved?.snapshot.revision > snapshot.revision ? saved.snapshot : snapshot;
    await db.kv.put({ key: 'state', value: { snapshot: chosen, actions } });
    if (chosen.revision >= state.remote.revision) publish({ remote: chosen });
  });
}
let lastOrder = Date.now();
export async function mutate(op: TaskOp) {
  try { lastOrder = Math.max(Date.now(), lastOrder + 1); await db.pending.add({ id: op.id, op, order: lastOrder }); await rebuild(); void sync(); }
  catch (e) { publish({ error: 'Could not save the change on this device. Free some storage and try again.' }); throw e; }
}
export function createTask(title: string, spaceId = state.snapshot.defaultSpaceId || originalSpaceId) { const taskId = crypto.randomUUID(); return mutate({ id: crypto.randomUUID(), taskId, spaceId, kind: 'create', title: title.trim(), at: Date.now() }).then(() => taskId); }
export function renameTask(taskId: string, title: string) { const t = state.snapshot.tasks.find(t => t.id === taskId)!; return mutate({ id: crypto.randomUUID(), taskId, kind: 'title', title, baseTitle: t.title, at: Date.now() }); }
export function moveTask(taskId: string, status: Status, beforeId?: string | null, destinationSpace?: string) {
  const t = state.snapshot.tasks.find(t => t.id === taskId)!;
  const baseSpaceId = taskSpaceId(t), spaceId = destinationSpace || baseSpaceId;
  return mutate({ id: crypto.randomUUID(), taskId, kind: 'move', spaceId, baseSpaceId, status: spaceId !== baseSpaceId ? 'inbox' : status, beforeId, baseStatus: t.status, baseSnoozeId: t.snoozeId || null, listVersion: spaceLists(state.snapshot, spaceId)[spaceId !== baseSpaceId ? 'inbox' : status].version, at: Date.now() });
}
export function snoozeTask(task: import('../shared/model').Task, until: number) {
  const current = state.snapshot.tasks.find(t => t.id === task.id);
  if (!current || current.status !== task.status || taskSpaceId(current) !== taskSpaceId(task) || current.snoozeId !== task.snoozeId) throw new Error('This task or reminder changed. Close this picker and open it again.');
  if (!Number.isFinite(until) || until <= Date.now()) throw new Error('Choose a future date and time.');
  return mutate({ id: crypto.randomUUID(), taskId: task.id, kind: 'snooze', spaceId: taskSpaceId(task), baseSpaceId: taskSpaceId(task), baseStatus: task.status, baseSnoozeId: task.snoozeId || null, snoozedUntil: until, at: Date.now() });
}
export async function setConversationHidden(conversation: Conversation, hidden: boolean) {
  const op: ConversationVisibilityOp = { id: crypto.randomUUID(), key: conversation.key, aliases: [...new Set([conversation.id, ...conversation.aliases])], hidden, at: Date.now() };
  lastOrder = Math.max(Date.now(), lastOrder + 1);
  await db.kv.put({ key: `visibility-op:${op.id}`, value: { op, order: lastOrder } satisfies PendingVisibility });
  await rebuild(); void sync();
}
export async function createTaskFromConversation(id: string, title: string, spaceId = state.snapshot.defaultSpaceId || originalSpaceId): Promise<string> {
  const opKey = `link-intent:${id}`;
  const intent = await db.transaction('rw', db.kv, async () => {
    const previous = (await db.kv.get(opKey))?.value;
    if (previous && previous.title !== title) throw new Error('A previous task-creation request is unconfirmed. Use the original title to check it before changing the title.');
    if (previous) return previous;
    const value = { id: crypto.randomUUID(), taskId: crypto.randomUUID(), title, spaceId, at: Date.now() };
    await db.kv.put({ key: opKey, value }); return value;
  });
  await sync();
  if (!state.remote.spaces?.some(s => s.id === (intent.spaceId || originalSpaceId))) throw new Error('Sync or resolve the destination space before creating this task.');
  const result = await api(`/conversations/${encodeURIComponent(id)}/task`, intent);
  await db.transaction('rw', db.kv, async () => { await acceptSnapshot(result.snapshot); await db.kv.delete(opKey); });
  await rebuild(); void refresh(); return result.taskId;
}
let activeSync: Promise<void> | undefined;
export function sync(): Promise<void> {
  if (activeSync) return activeSync;
  activeSync = (async () => {
    let started: number;
    do { started = lastOrder; await syncNow(); } while (state.online && lastOrder !== started);
  })().finally(() => { activeSync = undefined; }); return activeSync;
}
async function syncNow() {
  if (syncing || !state.online) return; syncing = true;
  try {
    const blockedSpaces = new Set<string>();
    for (const p of await db.spacePending.orderBy('order').toArray()) {
      if (p.conflict) { blockedSpaces.add(p.op.spaceId); continue; }
      if (blockedSpaces.has(p.op.spaceId)) continue;
      try {
        const data = await api('/spaces/sync', p.op);
        await db.transaction('rw', db.spacePending, db.kv, async () => { await acceptSnapshot(data.snapshot); await db.spacePending.delete(p.id); });
      } catch (e) {
        if (e instanceof ApiError && [400,409].includes(e.status)) { await db.spacePending.update(p.id, { conflict: e.message }); blockedSpaces.add(p.op.spaceId); if (e.data.snapshot) await acceptSnapshot(e.data.snapshot); }
        else { publish({ online: false }); break; }
      }
      await rebuild();
    }
    const blocked = new Set<string>();
    if (state.online) for (const p of await db.pending.orderBy('order').toArray()) {
      if (p.op.kind !== 'title' && !state.remote.spaces?.some(s => s.id === (p.op.spaceId || originalSpaceId))) { blocked.add(p.op.taskId); continue; }
      if (p.conflict) { blocked.add(p.op.taskId); continue; }
      if (blocked.has(p.op.taskId)) continue;
      try {
        const data = await api('/sync', p.op);
        await db.transaction('rw', db.pending, db.kv, async () => { await acceptSnapshot(data.snapshot); await db.pending.delete(p.id); });
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) { await db.pending.update(p.id, { conflict: e.message }); blocked.add(p.op.taskId); if (e.data.snapshot) await acceptSnapshot(e.data.snapshot); }
        else if (e instanceof ApiError && e.status === 400) { await db.pending.update(p.id, { conflict: e.message }); blocked.add(p.op.taskId); }
        else { publish({ online: false }); break; }
      }
      await rebuild();
    }
    const blockedReading = new Set<string>();
    if (state.online) for (const p of await db.readingPending.orderBy('order').toArray()) {
      if (p.conflict) { blockedReading.add(p.op.itemId); continue; }
      if (blockedReading.has(p.op.itemId)) continue;
      try {
        const data = await api('/reading/sync', p.op);
        await db.transaction('rw', db.kv, db.readingPending, async () => {
          await acceptSnapshot(data.snapshot); await db.readingPending.delete(p.op.id);
          if (data.itemId !== p.op.itemId) {
            await db.kv.put({ key: `reading-alias:${p.op.itemId}`, value: data.itemId });
            for (const pending of await db.readingPending.toArray()) if (pending.op.itemId === p.op.itemId) await db.readingPending.put({ ...pending, op: { ...pending.op, itemId: data.itemId } });
          }
        });
      } catch (e) {
        if (e instanceof ApiError && [400,409].includes(e.status)) {
          await db.readingPending.update(p.op.id, { conflict: e.message }); blockedReading.add(p.op.itemId);
          if (e.data.snapshot) await acceptSnapshot(e.data.snapshot);
        } else { publish({ online: false }); break; }
      }
      await rebuild();
    }
    if (state.online) for (const p of await pendingVisibility()) {
      try {
        const data = await api('/conversations/visibility', p.op);
        await db.transaction('rw', db.kv, async () => { await acceptSnapshot(data.snapshot); await db.kv.delete(`visibility-op:${p.op.id}`); });
        await rebuild();
      } catch (e) {
        publish({ online: false, error: e instanceof ApiError && e.status ? `Hidden-item change is saved on this device but could not sync: ${e.message}` : '' });
        break;
      }
    }
  } finally { syncing = false; void downloadArticles(); }
}
export async function resolveConflict(id: string, keepMine: boolean) {
  const p = await db.pending.get(id); if (!p) return;
  await db.transaction('rw', db.pending, async () => {
  await db.pending.delete(id);
  if (keepMine) {
    const t = state.remote.tasks.find(t => t.id === p.op.taskId);
    const op = { ...p.op, id: crypto.randomUUID(), at: Date.now(), baseTitle: t?.title, baseStatus: t?.status, baseSnoozeId: t?.snoozeId || null, baseSpaceId: t ? taskSpaceId(t) : originalSpaceId, spaceId: p.op.spaceId || originalSpaceId, listVersion: spaceLists(state.remote, p.op.spaceId || originalSpaceId)?.[p.op.status || t?.status || 'inbox'].version };
    // Reinsert ahead of dependent edits, preserving their chronology through the original timestamp.
    await db.pending.add({ id: op.id, op, order: p.order });
  }
  });
  await rebuild(); void sync();
}
export async function addFile(file: File | Blob, name: string): Promise<string> {
  if (file.size > 25 * 1024 * 1024) throw new Error('The file is larger than 25 MiB.');
  if (!file.size) throw new Error('The file is empty.');
  const id = crypto.randomUUID(); await db.files.add({ id, name, type: file.type || 'application/octet-stream', blob: file }); return id;
}
export async function uploadFile(id: string, progress?: (n: number) => void) {
  const f = await db.files.get(id); if (!f) throw new Error('The saved attachment is unavailable.');
  const hash = f.hash || [...new Uint8Array(await crypto.subtle.digest('SHA-256', await f.blob.arrayBuffer()))].map(n => n.toString(16).padStart(2, '0')).join('');
  if (!f.hash) await db.files.update(id, { hash });
  let r = await api('/uploads', { id, name: f.name, type: f.type, size: f.blob.size, hash });
  while (!r.complete) {
    const offset = r.offset; const chunk = f.blob.slice(offset, offset + 1024 * 1024);
    const response = await fetch(`/api/v1/uploads/${id}?offset=${offset}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'X-Herts-Request': '1' }, body: chunk, signal: AbortSignal.timeout(60_000) });
    r = await response.json(); if (!response.ok) throw new Error(r.error || 'Upload interrupted. The attachment is saved.'); progress?.(Math.round(r.offset / f.blob.size * 100));
  }
}
export async function submit(input: any): Promise<Action> {
  const contextId = input.contextId || state.snapshot.tasks.find(t => t.id === input.taskId)?.contextId || input.taskId;
  if (state.localSubmissions.some(s => s.taskId === contextId)) throw new Error('A submitted request is still unconfirmed. Check its status before sending another.');
  await sync();
  if (state.pending.some(p => p.op.taskId === input.taskId || contextForTask(p.op.taskId)?.id === contextId)) throw new Error('Sync or resolve this task’s changes before sending.');
  if (state.readingPending.some(p => p.op.contextId === contextId || state.snapshot.reading?.items.find(i => i.id === p.op.itemId)?.contextId === contextId)) throw new Error('Sync or resolve this reading item’s changes before sending.');
  if (!state.online || !state.gateway.online) throw new Error('Hermes is unavailable. Your message is saved; send it when connected.');
  for (const id of input.uploadIds || []) await uploadFile(id);
  const context = state.snapshot.contexts?.find(c => c.id === contextId);
  const savedHistory = context?.link ? (await db.kv.get(`history:${context.link.storedId}:latest:0`))?.value : undefined;
  const baseline: HistoryBaseline | undefined = savedHistory ? { sessionId: savedHistory.sessionId, ids: savedHistory.messages.flatMap((m: any) => m.id === undefined ? [] : [m.id]) } : !context?.link ? { sessionId: '', ids: [] } : undefined;
  await db.transaction('rw', db.submissions, async () => {
    const pending = (await db.submissions.toArray()).find(s => !s.confirmed && !state.actions.some(a => a.id === s.id) && (s.input.contextId || state.snapshot.tasks.find(t => t.id === s.input.taskId)?.contextId || s.input.taskId) === contextId);
    if (pending) throw new Error('A submitted request is still unconfirmed. Check its status before sending another.');
    await db.submissions.add({ id: input.id, input, at: Date.now(), confirmed: false, baseline });
  });
  await rebuild();
  try {
    const result = await api('/actions', input);
    // The receipt can arrive while a state refresh is already in flight. Show it
    // immediately and retain newer event state if it beat the HTTP response.
    const known = state.actions.find(a => a.id === input.id);
    const action = known && known.updatedAt >= result.action.updatedAt ? known : result.action;
    const actions = [...state.actions.filter(a => a.id !== input.id), action].sort((a, b) => b.createdAt - a.createdAt);
    publish({ actions }); await acceptSnapshot(state.remote, actions);
    await db.submissions.update(input.id, { confirmed: true }); await rebuild();
    void refresh(); return action;
  } catch (error) {
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) await db.submissions.delete(input.id);
    await rebuild(); throw error;
  }
}
export async function resolveSubmission(id: string) {
  const local = await db.submissions.get(id); if (!local) return;
  await api('/actions/cancel', local.input);
  await db.submissions.update(id, { confirmed: true }); await refresh(); await rebuild();
}
export async function cacheRead(key: string, fetcher: () => Promise<any>) {
  try { const value = await fetcher(); await db.kv.put({ key, value }); return { value, cached: false }; }
  catch (error) { const saved = await db.kv.get(key); if (saved) return { value: saved.value, cached: true }; throw error; }
}

export function contextForTask(taskId: string): ConversationContext | undefined {
  const task = state.snapshot.tasks.find(t => t.id === taskId);
  if (!task) return undefined;
  return state.snapshot.contexts?.find(c => c.id === task.contextId) || { id: task.id, title: task.title, link: task.link, aliases: task.link ? [task.link.key, task.link.storedId] : [] };
}
export function contextForConversation(id: string, aliases: string[] = []): ConversationContext | undefined {
  const ids = [id, ...aliases];
  return state.snapshot.contexts?.find(c => c.link && (ids.includes(c.link.key) || ids.includes(c.link.storedId) || c.aliases.some(alias => ids.includes(alias))));
}
export async function openConversation(id: string) {
  const result = await api(`/conversations/${encodeURIComponent(id)}/context`, {}, 'POST', 30_000);
  await acceptSnapshot(result.snapshot); await rebuild();
}
export async function mutateReading(op: ReadingOp) {
  lastOrder = Math.max(Date.now(), lastOrder + 1);
  await db.readingPending.add({ op, order: lastOrder }); await rebuild(); void sync();
}
export async function addReading(url: string, title = '', conversationId?: string) {
  url = normalizeUrl(url);
  const itemId = await db.transaction('rw', db.kv, db.readingPending, db.drafts, async () => {
    const context = conversationId ? state.snapshot.contexts?.find(c => c.aliases.includes(conversationId)) : undefined;
    const existing = context && state.snapshot.reading?.items.find(i => i.contextId === context.id && i.urlKey === url);
    if (existing) return existing.id;
    if (conversationId) {
      const pending = (await db.readingPending.toArray()).find(p => p.op.kind === 'create' && p.op.url === url && (p.op.conversationId === conversationId || (context && p.op.contextId === context.id)));
      if (pending) return pending.op.itemId;
    }
    const itemId = crypto.randomUUID(), contextId = context?.id || crypto.randomUUID();
    const op: ReadingOp = { id: crypto.randomUUID(), itemId, contextId, kind: 'create', url, title: title.trim().slice(0, 2000) || url, ...(conversationId ? { conversationId } : {}), at: Date.now() };
    lastOrder = Math.max(Date.now(), lastOrder + 1);
    await db.readingPending.add({ op, order: lastOrder });
    if (!conversationId) await db.drafts.put({ id: contextId, text: url, files: [] });
    return itemId;
  });
  await rebuild(); void sync(); return itemId;
}
export async function resolveReadingConflict(id: string, keepMine: boolean) {
  const pending = await db.readingPending.get(id); if (!pending) return;
  await db.transaction('rw', db.readingPending, async () => {
    await db.readingPending.delete(id);
    if (keepMine) {
      const item = state.remote.reading?.items.find(i => i.id === pending.op.itemId);
      await db.readingPending.put({ order: pending.order, op: { ...pending.op, id: crypto.randomUUID(), baseReadAt: item?.readAt ?? null, listVersion: state.remote.reading?.unread.version ?? 0, ...(pending.op.kind === 'title' ? { baseTitle: item?.title } : {}) } });
    }
  }); await rebuild(); void sync();
}
export async function readingChange(itemId: string, change: Partial<ReadingOp> & Pick<ReadingOp, 'kind'>) {
  const item = state.snapshot.reading?.items.find(i => i.id === itemId);
  return mutateReading({ id: crypto.randomUUID(), itemId, at: Date.now(), ...change, ...(change.kind === 'title' ? { baseTitle: change.baseTitle ?? item?.title } : {}), ...(change.kind === 'read' ? { baseReadAt: item?.readAt ?? null } : {}), ...(change.kind === 'reorder' ? { listVersion: state.snapshot.reading?.unread.version || 0 } : {}) });
}
export async function sendReadingLink(itemId: string) {
  const item = state.snapshot.reading?.items.find(i => i.id === itemId); if (!item) throw new Error('The saved item is unavailable.');
  const context = state.snapshot.contexts?.find(c => c.id === item.contextId);
  if (context?.link || state.actions.some(a => a.taskId === item.contextId && !a.cancelled)) throw new Error('Review the conversation and saved requests before sending another message.');
  await db.drafts.put({ id: item.contextId, text: item.url, files: [] });
  const result = await submit({ id: crypto.randomUUID(), contextId: item.contextId, kind: 'send', text: item.url, uploadIds: [] });
  await db.drafts.put({ id: item.contextId, text: '', files: [] }); return result;
}
let downloading = false;
export async function downloadArticles() {
  if (downloading || !state.online) return; downloading = true;
  try {
    const reading = state.snapshot.reading || emptyReading();
    for (const item of reading.items) {
      if (!state.online) break;
      if (!retainsArticle(item, reading) || state.articleErrors[item.id]?.version === item.downloadVersion || await db.articles.get(item.id) || state.readingPending.some(p => p.op.itemId === item.id)) continue;
      try { await getArticle(item.id); } catch { /* Retry on a future refresh; no Hermes work is queued. */ }
    }
  } finally { downloading = false; }
}
export async function getArticle(id: string): Promise<Article> {
  const cached = await db.articles.get(id); if (cached) return cached;
  const { article } = await api(`/reading/${id}/article`);
  try { await db.transaction('rw', db.articles, db.readingPending, async () => {
    const reading = state.snapshot.reading || emptyReading(), current = reading.items.find(i => i.id === id);
    if (current && retainsArticle(current, reading) && current.downloadVersion === article.version && !(await db.readingPending.toArray()).some(p => p.op.itemId === id || p.op.kind === 'settings')) await db.articles.put(article);
  });
    const errors = { ...state.articleErrors }; delete errors[id]; publish({ articleErrors: errors });
  } catch {
    publish({ articleErrors: { ...state.articleErrors, [id]: { version: article.version, message: 'Could not save the article on this device. Free some storage and retry the download.' } } });
  }
  await rebuild(); return article;
}

export function rememberSpace(id: string) {
  publish({ viewedSpaceId: id });
  void db.kv.put({ key: 'viewed-space', value: id }).catch(() => publish({ error: 'Could not remember the selected space on this device.' }));
}
export async function mutateSpace(op: SpaceOp) {
  applySpaceOp(state.snapshot, op); // Validate before optimistic persistence.
  lastOrder = Math.max(Date.now(), lastOrder + 1);
  await db.spacePending.add({ id: op.id, op, order: lastOrder }); await rebuild(); void sync();
}
export async function createSpace(name: string) { const spaceId = crypto.randomUUID(); await mutateSpace({ id: crypto.randomUUID(), spaceId, kind: 'create', name: name.trim(), at: Date.now() }); return spaceId; }
export async function renameSpace(spaceId: string, name: string) { const space = state.snapshot.spaces!.find(s => s.id === spaceId)!; await mutateSpace({ id: crypto.randomUUID(), spaceId, kind: 'rename', name: name.trim(), baseName: space.name, at: Date.now() }); }
export async function setDefaultSpace(spaceId: string) { await mutateSpace({ id: crypto.randomUUID(), spaceId, kind: 'default', baseDefaultSpaceId: state.snapshot.defaultSpaceId || originalSpaceId, at: Date.now() }); }
export async function resolveSpaceConflict(id: string, keep: boolean, name?: string) {
  const p = await db.spacePending.get(id); if (!p) return;
  if (p.op.kind === 'create' && !keep) throw new Error('Choose a new name to preserve this space and its saved tasks.');
  await db.transaction('rw', db.spacePending, async () => {
    await db.spacePending.delete(id);
    if (keep) {
      const op: SpaceOp = { ...p.op, id: crypto.randomUUID(), at: Date.now(), ...(name !== undefined ? { name: name.trim() } : {}), ...(p.op.kind === 'rename' ? { baseName: state.remote.spaces?.find(s => s.id === p.op.spaceId)?.name } : {}), ...(p.op.kind === 'default' ? { baseDefaultSpaceId: state.remote.defaultSpaceId } : {}) };
      // The original order keeps this operation ahead of dependent space edits.
      await db.spacePending.put({ id: op.id, op, order: p.order });
    }
  }); lastOrder = Math.max(Date.now(), lastOrder + 1); await rebuild(); void sync();
}
