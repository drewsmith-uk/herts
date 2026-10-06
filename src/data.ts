import Dexie, { type Table } from 'dexie';
import { useSyncExternalStore } from 'react';
import { historyBaseline, type HistoryBaseline, type OutgoingMessage } from './transcriptFeedback';
import { applyConversationVisibility, redactSavedMessage, type Action, type Binding, type Conversation, type ConversationVisibilityOp } from '../shared/core';
import type { ConversationContext } from '../shared/conversations';
import { emptySettings, sameSetting, type SettingsState, type SessionValues } from '../shared/sessionSettings';
import { emptyCatalogue, type PluginCatalogue, type PluginData, type PluginOperation } from '../shared/plugins';
import { migrateDevice, migrateDeviceSpaces } from './legacyDeviceMigration';
import { discardResetDrafts, stageDraft, pendingDraft, pendingDraftKeys, draftIsCurrent, acknowledgeDraft, type DraftWrite } from './draftJournal';
import type { ClientPlugin } from './pluginContract';
import { cleanLocalFiles, flushTranscriptionDiscards, queueTranscriptionDiscard } from './fileRetention';
export interface LocalFile {
    unreferencedAt?: number;
    discardRequested?: boolean;
    owner?: string;
    id: string;
    name: string;
    type: string;
    blob: Blob;
    hash?: string;
}
export interface Draft {
    /** Receipt for this exact text/files; editing clears it. Never an instruction to resend. */
    submissionId?: string;
    id: string;
    text: string;
    files: string[];
}
export interface Recording {
    transcription?: { id: string; uploadId: string };
    id: string;
    owner: string;
    chunks: Blob[];
    type: string;
    at: number;
    complete: boolean;
}
export interface PendingPlugin {
    id: string;
    pluginId: string;
    operation: PluginOperation;
    order: number;
    contextId?: string;
    conflict?: string;
}
interface PendingVisibility {
    op: ConversationVisibilityOp;
    order: number;
}
export interface CoreSnapshot {
    revision: number;
    contexts: ConversationContext[];
    hiddenConversations: string[];
    sessionSettings?: SettingsState;
}
export interface PendingSettings { contextId?: string; input: { id: string; revision: number; values: SessionValues; baseline?: SessionValues; reviewed?: boolean }; conflict?: string }
class LocalDB extends Dexie {
    kv!: Table<{
        key: string;
        value: any;
    }, string>;
    drafts!: Table<Draft, string>;
    files!: Table<LocalFile, string>;
    recordings!: Table<Recording, string>;
    submissions!: Table<{
        id: string;
        input: any;
        at: number;
        confirmed: boolean;
        baseline?: HistoryBaseline;
    }, string>;
    pluginPending!: Table<PendingPlugin, string>;
    pluginLocal!: Table<{
        key: string;
        value: any;
    }, string>;
    constructor() {
        super('hermes-tasks');
        this.version(1).stores({ kv: 'key', pending: 'id,op.taskId,order', drafts: 'id', files: 'id', submissions: 'id', recordings: 'id,owner' });
        this.version(2).stores({ articles: 'itemId', readingPending: 'op.id,order' });
        this.version(3).stores({ spacePending: 'id,op.spaceId,order' }).upgrade(migrateDeviceSpaces);
        this.version(4).stores({ pluginPending: 'id,pluginId,order', pluginLocal: 'key' }).upgrade(migrateDevice);
    }
}
export const db = new LocalDB();
export interface State {
    snapshot: CoreSnapshot;
    remote: CoreSnapshot;
    actions: Action[];
    bindings: Record<string, Binding>;
    plugins: PluginCatalogue;
    pluginData: Record<string, PluginData>;
    pluginRemote: Record<string, PluginData>;
    pluginPending: PendingPlugin[];
    visibilityPending: PendingVisibility[];
    settingsPending?: PendingSettings[];
    online: boolean;
    connectionVersion: number;
    loaded: boolean;
    defaultsReady: boolean;
    gateway: {
        online: boolean;
        configured: boolean;
        profile?: string;
        promptProtocol?: 'unknown' | 'legacy' | 'requests';
        promptError?: string;
        promptWarning?: string;
    };
    error: string;
    lifecycleNotice?: string;
    pushKey: string;
    localSubmissions: {
        id: string;
        taskId: string;
    }[];
    outgoing: OutgoingMessage[];
}
const empty = (): CoreSnapshot => ({ revision: 0, contexts: [], hiddenConversations: [] });
let state: State = { snapshot: empty(), remote: empty(), actions: [], bindings: {}, plugins: emptyCatalogue(), pluginData: {}, pluginRemote: {}, pluginPending: [], visibilityPending: [], online: false, connectionVersion: 0, loaded: false, defaultsReady: false, gateway: { online: false, configured: false }, error: '', pushKey: '', localSubmissions: [], outgoing: [] };
const listeners = new Set<() => void>();
let refreshing = false, lastOrder = Date.now();
let refreshAgain = false, recoverAfterRefresh = false, refreshRequest: AbortController | undefined;
const definitions = new Map<string, ClientPlugin>();
export function getState() { return state; }
export function publish(patch: Partial<State> = {}) {
    if (patch.actions) {
        const deleted = new Map(state.actions.filter(a => a.savedMessageDeletedAt).map(a => [a.id, a.savedMessageDeletedAt]));
        patch.actions = patch.actions.map(a => redactSavedMessage(deleted.has(a.id) ? { ...a, savedMessageDeletedAt: deleted.get(a.id) } : a));
    }
    state = { ...state, ...patch }; Dexie.ignoreTransaction(() => { for (const listener of listeners)
    listener(); }); }
export function useApp() { return useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn); }, () => state); }
export function registerPluginData(id: string, definition?: ClientPlugin) { if (definition)
    definitions.set(id, definition);
else
    definitions.delete(id); return rebuild(); }
export class ApiError extends Error {
    constructor(message: string, public status: number, public data: any) { super(message); }
}
export async function api(path: string, body?: unknown, method?: string, timeout = 190000, signal?: AbortSignal): Promise<any> {
    let r: Response;
    const requestSignal = AbortSignal.any([AbortSignal.timeout(timeout), ...(signal ? [signal] : [])]);
    try {
        r = await fetch(`/api/v1${path}`, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { 'X-Herts-Plugin-API': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Herts-Request': '1' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: requestSignal, cache: 'no-store' });
    }
    catch {
        throw new ApiError('Connection lost. Your saved work is still on this device.', 0, null);
    }
    const data = await r.json().catch(() => {
        // A lost/partial successful reply cannot confirm whether a write arrived.
        if (r.ok) throw new ApiError('Herts returned an incomplete response. Please try again.', 0, null);
        return {};
    });
    if (requestSignal.aborted) throw new ApiError('Connection lost. Your saved work is still on this device.', 0, null);
    if (!r.ok)
        throw new ApiError(data?.error || `Request failed (${r.status})`, r.status, data);
    return data;
}
async function pendingVisibility(): Promise<PendingVisibility[]> {
    return (await db.kv.where('key').startsWith('visibility-op:').toArray()).map(row => row.value as PendingVisibility).sort((a, b) => a.order - b.order);
}
export async function rebuild() {
    const visibilityPending = await pendingVisibility();
    const localContexts = (await db.kv.where('key').startsWith('context:').toArray()).map(r => r.value as ConversationContext);
    const pluginPending = await db.pluginPending.orderBy('order').toArray(), submissions = await db.submissions.toArray();
    let snapshot = { ...state.remote };
    const settingsPending = (await db.kv.where('key').startsWith('settings-op:').toArray()).map(r => r.value as PendingSettings);
    snapshot.sessionSettings = structuredClone(snapshot.sessionSettings || emptySettings());
    for (const op of settingsPending) {
        const record = { revision: op.input.revision, values: op.input.values, baseline: op.input.baseline };
        if (op.contextId) snapshot.sessionSettings.conversations[op.contextId] = record;
        else snapshot.sessionSettings.defaults = record;
    }
    const pluginData = structuredClone(state.pluginRemote);
    for (const p of visibilityPending)
        snapshot = { ...snapshot, hiddenConversations: applyConversationVisibility(snapshot.hiddenConversations || [], p.op) };
    snapshot.contexts = [...(snapshot.contexts || []), ...localContexts.filter(c => !snapshot.contexts?.some(remote => remote.id === c.id))];
    for (const p of pluginPending) {
        const data = pluginData[p.pluginId], reduce = definitions.get(p.pluginId)?.reduce;
        if (data && data.generation === p.operation.generation && reduce)
            try {
                data.records = reduce(data.records, p.operation);
            }
            catch { /* Retain conflicting changes for review. */ }
    }
    const outgoing = submissions.filter(s => s.input.kind === 'send').map(s => ({ id: s.id, taskId: s.input.contextId || s.input.taskId, text: s.input.text || '', uploadIds: s.input.uploadIds || [], at: s.at, baseline: s.baseline }));
    const localSubmissions = submissions.filter(s => !s.confirmed && !state.actions.some(a => a.id === s.id)).map(s => ({ id: s.id, taskId: s.input.contextId || s.input.taskId }));
    publish({ snapshot, pluginData, pluginPending, visibilityPending, settingsPending, outgoing, localSubmissions });
}
export async function acceptPlugins(catalogue: PluginCatalogue, data: Record<string, PluginData> = state.pluginRemote) {
    if (catalogue.revision < state.plugins.revision)
        return;
    const changed = JSON.stringify(state.plugins.entries.filter(e => e.enabled).map(e => [e.manifest.id, e.hash, e.generation])) !== JSON.stringify(catalogue.entries.filter(e => e.enabled).map(e => [e.manifest.id, e.hash, e.generation]));
    const reset = state.plugins.entries.some(old => (catalogue.entries.find(e => e.manifest.id === old.manifest.id)?.generation ?? 0) > old.generation);
    if (changed && !reset) {
        try {
            await (await import('./updateSafety')).prepareForUpdate();
        }
        catch (error) {
            publish({ lifecycleNotice: `Plugin settings changed on another device. ${(error as Error).message} Saved data is retained.` });
            return;
        }
    }
    publish({ lifecycleNotice: undefined });
    const next = await db.transaction('rw', [db.pluginPending, db.pluginLocal, db.recordings, db.files, db.drafts, db.submissions, db.kv], async () => {
        for (const entry of catalogue.entries) {
            // An absent legacy generation is generation zero, never today's generation.
            const prior = (await db.kv.get(`plugin-generation:${entry.manifest.id}`))?.value ?? 0;
            if (entry.generation > 0) {
                await db.pluginPending.where('pluginId').equals(entry.manifest.id).filter(p => p.operation.generation < entry.generation).delete();
                for (const row of await db.kv.where('key').startsWith('entry-owner:').toArray()) {
                    const owner = row.value, id = row.key.slice('entry-owner:'.length);
                    if (owner.id !== entry.manifest.id || owner.generation >= entry.generation) continue;
                    if (await db.kv.get(`entry-route:${id}`)) {
                        await db.drafts.delete(id);
                        for (const row of await db.recordings.where('owner').equals(`chat:${id}`).toArray()) await queueTranscriptionDiscard(row);
                        await db.recordings.where('owner').equals(`chat:${id}`).delete();
                        await db.kv.bulkDelete([`context-draft:${id}`, `entry-route:${id}`, `entry-fields:${id}`]);
                        await db.kv.put({ key: `context-draft-deleted:${id}`, value: true });
                    }
                }

                for (const row of await db.pluginLocal.where('key').startsWith(`${entry.manifest.id}:`).toArray())
                    if (Number(row.key.split(':')[1]) < entry.generation)
                        await db.pluginLocal.delete(row.key);
                for (const row of await db.recordings.where('owner').startsWith(`plugin:${entry.manifest.id}:`).toArray())
                    if (Number(row.owner.split(':')[2]) < entry.generation) {
                        await queueTranscriptionDiscard(row); await db.recordings.delete(row.id);
                    }
            }
            if (entry.generation > 0) {
                const referenced = new Set([...(await db.drafts.toArray()).flatMap(d => d.files), ...(await db.submissions.toArray()).flatMap(s => s.input.uploadIds || []), ...state.actions.flatMap(a => a.uploadIds)]);
                for (const f of await db.files.toArray())
                    if (f.owner?.startsWith(entry.manifest.id + ':') && Number(f.owner.split(':')[1]) < entry.generation && !referenced.has(f.id))
                        await db.files.delete(f.id);
            }
            await db.kv.put({ key: `plugin-generation:${entry.manifest.id}`, value: entry.generation });
        }
        const next = { ...state.pluginRemote };
        for (const [id, value] of Object.entries(data)) {
            const prior = next[id];
            if (!prior || value.generation > prior.generation || value.generation === prior.generation && value.revision >= prior.revision)
                next[id] = value;
        }
        await db.kv.put({ key: 'plugins', value: { catalogue, data: next } });
        return next;
    });
    for (const entry of catalogue.entries) if (entry.generation > 0) discardResetDrafts(entry.manifest.id, entry.generation);
    publish({ plugins: catalogue, pluginRemote: next });
    await rebuild();
}
export async function initialise() {
    try {
        for (const key of pendingDraftKeys('core:draft:')) { const write = pendingDraft(key); if (write) await commitConversationDraft(key, write); }
        const saved = (await db.kv.get('state'))?.value, plugins = (await db.kv.get('plugins'))?.value;
        if (saved)
            publish({ remote: { ...empty(), ...saved.snapshot }, actions: await purgeDeletedSavedMessages(saved.actions || []), bindings: {} });
        if (plugins)
            await acceptPlugins(plugins.catalogue, plugins.data);
        else if (saved) { // Offline first launch after upgrading a legacy browser.
            const snapshot = saved.snapshot;
            let bootstrap: PluginCatalogue | undefined;
            try {
                bootstrap = (await api('/plugins', undefined, 'GET', 3000)).catalogue;
            }
            catch { }
            try {
                bootstrap ||= await (await caches.match('/__herts_plugin_catalogue'))?.json();
            }
            catch { }
            const entries = ['tasks', 'reading'].map(id => ({ manifest: { id, name: id === 'tasks' ? 'Tasks' : 'Reading', description: '', version: '1.0.0', apiVersion: 1, schemaVersion: 1 }, enabled: true, available: true, generation: 0, status: 'enabled' as const, ...bootstrap?.entries.find(e => e.manifest.id === id) }));
            const pluginRemote = Object.fromEntries(entries.map(e => [e.manifest.id, { generation: e.generation, revision: 0, schemaVersion: 1, records: e.generation > 0 ? {} : { state: e.manifest.id === 'tasks' ? snapshot : snapshot.reading } }]));
            await acceptPlugins({ revision: bootstrap?.revision || 0, order: bootstrap?.order || ['tasks', 'conversations', 'reading'], entries }, pluginRemote);
        }
        await rebuild();
        publish({ loaded: true, defaultsReady: !!saved });
        void cleanLocalFiles().catch(() => {});
        setInterval(() => { if (!document.hidden) void cleanLocalFiles().catch(() => {}); }, 60000);
        if (navigator.storage?.persist)
            void navigator.storage.persist();
        void refresh().finally(() => publish({ defaultsReady: true }));
        const recover = () => { if (navigator.onLine && !document.hidden) void refresh(true); };
        window.addEventListener('online', recover);
        window.addEventListener('offline', () => { publish({ online: false }); refreshRequest?.abort(); });
        window.addEventListener('pageshow', recover);
        window.addEventListener('focus', recover);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible')
            recover(); });
        const events = new EventSource('/api/v1/events');
        events.addEventListener('open', recover);
        let timer: ReturnType<typeof setTimeout> | undefined;
        events.addEventListener('refresh', () => { if (timer)
            return; timer = setTimeout(() => { timer = undefined; void refresh(); }, 150); });
        setInterval(() => { if (navigator.onLine && document.visibilityState === 'visible')
            void refresh(); }, 8000);
    }
    catch {
        publish({ loaded: true, defaultsReady: true, error: 'Device storage is unavailable. Changes cannot be safely saved. Check browser storage settings.' });
    }
}
export async function refresh(recover = false) {
    if (refreshing) {
        refreshAgain = true; recoverAfterRefresh ||= recover;
        // Only abandon the read-only status request, never a submitted action.
        if (recover) refreshRequest?.abort();
        return;
    }
    refreshing = true;
    const controller = new AbortController(); refreshRequest = controller;
    try {
        const data = await api('/state', undefined, 'GET', 10000, controller.signal), actions = new Map(state.actions.map(a => [a.id, a]));
        refreshRequest = undefined;
        for (const action of data.actions as Action[])
            if (!actions.has(action.id) || actions.get(action.id)!.updatedAt < action.updatedAt)
                actions.set(action.id, action);
        data.actions = await purgeDeletedSavedMessages([...actions.values()].sort((a, b) => b.createdAt - a.createdAt));
        await acceptSnapshot(data.snapshot, data.actions);
        await acceptPlugins(data.plugins, data.pluginData);
        const recovered = recover || !state.online || (!state.gateway.online && data.gateway.online);
        publish({ actions: data.actions, bindings: data.bindings, gateway: data.gateway, online: navigator.onLine, connectionVersion: state.connectionVersion + (recovered ? 1 : 0), pushKey: data.pushKey, error: '' });
        void flushTranscriptionDiscards();
        for (const s of await db.submissions.toArray())
            if (data.actions.some((a: Action) => a.id === s.id))
                await db.submissions.update(s.id, { confirmed: true });
        await rebuild();
        void sync();
    }
    catch (e) {
        if (!controller.signal.aborted) publish({ online: false, error: e instanceof ApiError && e.status === 403 ? e.message : '' });
    }
    finally {
        refreshing = false;
        refreshRequest = undefined;
        if (refreshAgain) { const recovery = recoverAfterRefresh; refreshAgain = false; recoverAfterRefresh = false; void refresh(recovery); }
    }
}
/** Erase saved copies on reconnect too, while keeping independent drafts and history. */
export async function purgeDeletedSavedMessages(actions: Action[]): Promise<Action[]> {
    return db.transaction('rw', db.kv, db.submissions, db.files, db.drafts, db.pluginLocal, async () => {
        const saved = (await db.kv.get('state'))?.value;
        const prior: Action[] = [...(saved?.actions || []), ...state.actions];
        const deleted = new Map([...prior, ...actions].filter(a => a.savedMessageDeletedAt).map(a => [a.id, a.savedMessageDeletedAt!]));
        if (!deleted.size) return actions;
        const clean = actions.map(a => redactSavedMessage(deleted.has(a.id) ? { ...a, savedMessageDeletedAt: deleted.get(a.id) } : a));
        const files = new Set([...prior, ...actions].filter(a => deleted.has(a.id)).flatMap(a => a.uploadIds));
        for (const submission of await db.submissions.toArray()) if (deleted.has(submission.id)) {
            for (const id of submission.input.uploadIds || []) files.add(id);
            await db.submissions.delete(submission.id);
        }
        const pendingFiles = pendingDraftKeys('core:draft:').flatMap(key => (pendingDraft(key)?.value as Partial<Draft> | null)?.files || []);
        const referenced = new Set([...pendingFiles, ...(await db.drafts.toArray()).flatMap(d => d.files), ...(await db.submissions.toArray()).flatMap(s => s.input.uploadIds || []), ...clean.flatMap(a => a.uploadIds)]);
        // Legacy/plugin capture drafts may also own an attachment.
        const pluginDrafts = JSON.stringify(await db.pluginLocal.toArray());
        for (const id of files) if (!referenced.has(id) && !pluginDrafts.includes(JSON.stringify(id))) await db.files.delete(id);
        if (saved) await db.kv.put({ key: 'state', value: { ...saved, actions: clean } });
        return clean;
    });
}
export async function acceptSnapshot(snapshot: CoreSnapshot, actions = state.actions) {
    const core = { revision: snapshot.revision, contexts: snapshot.contexts || [], hiddenConversations: snapshot.hiddenConversations || [], sessionSettings: snapshot.sessionSettings || emptySettings() };
    const chosen = await db.transaction('rw', db.kv, async () => {
        const saved = (await db.kv.get('state'))?.value, chosen = saved?.snapshot.revision > core.revision ? saved.snapshot : core;
        const deleted = new Map<string, number>([...(saved?.actions || []), ...state.actions].filter((a: Action) => a.savedMessageDeletedAt).map((a: Action) => [a.id, a.savedMessageDeletedAt!]));
        const clean = actions.map(a => redactSavedMessage(deleted.has(a.id) ? { ...a, savedMessageDeletedAt: deleted.get(a.id) } : a));
        await db.kv.put({ key: 'state', value: { snapshot: chosen, actions: clean } });
        return chosen;
    });
    if (chosen.revision >= state.remote.revision)
        publish({ remote: chosen });
}
export async function mutatePlugin(pluginId: string, command: string, input: any, contextId?: string) {
    const entry = state.plugins.entries.find(e => e.manifest.id === pluginId);
    if (!entry?.enabled)
        throw new Error('Enable this plugin before making changes.');
    const id = input.id || crypto.randomUUID(), operation = { id, generation: entry.generation, command, input };
    lastOrder = Math.max(Date.now(), lastOrder + 1);
    await db.transaction('rw', db.pluginPending, db.kv, async () => { if (((await db.kv.get(`plugin-generation:${pluginId}`))?.value ?? 0) !== entry.generation)
        throw new Error('This plugin was reset. Old edits cannot be restored.'); await db.pluginPending.add({ id, pluginId, operation, order: lastOrder, contextId }); });
    await rebuild();
    void sync();
    return id;
}
let activeSync: Promise<void> | undefined;
export function sync(): Promise<void> { if (activeSync)
    return activeSync; activeSync = (async () => { let order; do {
    order = lastOrder;
    await syncNow();
} while (state.online && order !== lastOrder); })().finally(() => { activeSync = undefined; }); return activeSync; }
async function syncNow() {
    if (!state.online)
        return;
    const blocked = new Set<string>();
    for (const pending of await db.pluginPending.orderBy('order').toArray()) {
        if (!state.plugins.entries.some(e => e.manifest.id === pending.pluginId && e.enabled))
            continue;
        if (pending.conflict || blocked.has(pending.pluginId)) {
            blocked.add(pending.pluginId);
            continue;
        }
        try {
            const data = await api(`/plugins/${pending.pluginId}/commands`, pending.operation);
            await db.transaction('rw', db.pluginPending, db.kv, async () => { await db.pluginPending.delete(pending.id); await acceptSnapshot(data.snapshot); });
            await acceptPlugins(state.plugins, { [pending.pluginId]: data.data });
            await definitions.get(pending.pluginId)?.reconcile?.(data.result, pending.operation);
        }
        catch (e) {
            if (e instanceof ApiError && [400, 409, 410, 423].includes(e.status)) {
                blocked.add(pending.pluginId);
                if (e.status === 410) {
                    await refresh();
                    continue;
                }
                if (e.status === 409) {
                    if (e.data.snapshot)
                        await acceptSnapshot(e.data.snapshot);
                    if (e.data.pluginData)
                        await acceptPlugins(state.plugins, e.data.pluginData);
                }
                if (e.status !== 423)
                    await db.pluginPending.update(pending.id, { conflict: e.message });
            }
            else {
                publish({ online: false });
                break;
            }
        }
        await rebuild();
    }
    if (state.online)
        for (const p of await pendingVisibility()) {
            try {
                const data = await api('/conversations/visibility', p.op);
                await db.transaction('rw', db.kv, async () => { await acceptSnapshot(data.snapshot); await db.kv.delete(`visibility-op:${p.op.id}`); });
                await rebuild();
            }
            catch (e) {
                publish({ error: e instanceof Error ? e.message : 'Hidden-item change is saved on this device.' });
                break;
            }
        }
    await syncSessionSettings();
}
let settingsSync: Promise<void> | undefined;
export function syncSessionSettings(): Promise<void> {
    if (settingsSync) return settingsSync;
    settingsSync = (async () => {
        if (!state.online) return;
        for (const row of await db.kv.where('key').startsWith('settings-op:').toArray()) {
            const op = row.value as PendingSettings;
            if (op.conflict || (op.contextId && !state.remote.contexts.some(c => c.id === op.contextId))) continue;
            try {
                const result = await api(op.contextId ? `/contexts/${op.contextId}/settings` : '/session-defaults', op.input, undefined, 15000);
                await db.transaction('rw', db.kv, async () => {
                    await acceptSnapshot(result.snapshot);
                    if ((await db.kv.get(row.key))?.value.input.id === op.input.id) await db.kv.delete(row.key);
                });
            } catch (e) {
                if (e instanceof ApiError && e.data?.snapshot) await acceptSnapshot(e.data.snapshot);
                if (e instanceof ApiError && [400, 409].includes(e.status)) {
                    await db.transaction('rw', db.kv, async () => { if ((await db.kv.get(row.key))?.value.input.id === op.input.id) await db.kv.put({ key: row.key, value: { ...op, conflict: e.message } }); });
                } else break;
            }
        }
        await rebuild();
    })().finally(() => { settingsSync = undefined; });
    return settingsSync;
}
export async function saveSessionChoices(contextId: string | undefined, revision: number, values: SessionValues, baseline?: SessionValues, reviewed = false) {
    await settingsSync;
    const input = { id: crypto.randomUUID(), revision, values, ...(baseline ? { baseline } : {}), ...(reviewed ? { reviewed: true } : {}) };
    await db.kv.put({ key: `settings-op:${contextId || 'defaults'}`, value: { contextId, input } satisfies PendingSettings });
    lastOrder = Math.max(Date.now(), lastOrder + 1);
    await rebuild(); await syncSessionSettings();
    const pending = (await db.kv.get(`settings-op:${contextId || 'defaults'}`))?.value as PendingSettings | undefined;
    if (pending?.conflict) throw new Error(pending.conflict);
}
export async function useSyncedSessionChoices(contextId?: string) {
    await settingsSync; await db.kv.delete(`settings-op:${contextId || 'defaults'}`); await rebuild();
}
export async function resolvePluginOperation(id: string, input?: unknown) {
    const p = await db.pluginPending.get(id);
    if (!p)
        return;
    await db.transaction('rw', db.pluginPending, async () => { await db.pluginPending.delete(id); if (input !== undefined) {
        const nextId = crypto.randomUUID();
        const nextInput = typeof input === 'object' && input !== null ? { ...input, id: nextId } : input;
        await db.pluginPending.add({ ...p, id: nextId, conflict: undefined, operation: { ...p.operation, id: nextId, input: nextInput } });
    } });
    lastOrder = Math.max(Date.now(), lastOrder + 1);
    await rebuild();
    void sync();
}
export async function createLocalConversation(title = 'New conversation', id: string = crypto.randomUUID()) {
    const context = { id, title, link: null, aliases: [] } satisfies ConversationContext;
    await db.transaction('rw', db.kv, async () => {
        await assertDraftAvailable(id);
        if (!await db.kv.get(`context:${id}`) && !state.snapshot.contexts.some(c => c.id === id)) {
            await db.kv.put({ key: `context:${id}`, value: context });
            await db.kv.put({ key: `context-draft:${id}`, value: true });
        }
    });
    await rebuild();
    return context;
}
async function assertDraftAvailable(id: string) {
    if (!(await db.kv.get(`context-draft-deleted:${id}`))) return;
    // A later Hermes conversation can still be opened and replied to normally.
    const saved = (await db.kv.get('state'))?.value;
    if (!state.snapshot.contexts.find(c => c.id === id)?.link && !saved?.snapshot.contexts.find((c: ConversationContext) => c.id === id)?.link)
        throw new Error('This draft was deleted. Start a new conversation to write another message.');
}
async function commitConversationDraft(key: string, write: DraftWrite) {
    const draft = write.value as Draft;
    await db.transaction('rw', db.kv, db.drafts, async () => {
        if (!draftIsCurrent(key, write)) return;
        if (await db.kv.get(`context-draft-deleted:${draft.id}`)) {
            const saved = (await db.kv.get('state'))?.value;
            if (!state.snapshot.contexts.find(c => c.id === draft.id)?.link && !saved?.snapshot.contexts.find((c: ConversationContext) => c.id === draft.id)?.link) return;
        }
        const owner = (await db.kv.get(`entry-owner:${draft.id}`))?.value;
        if (owner && ((await db.kv.get(`plugin-generation:${owner.id}`))?.value ?? 0) !== owner.generation) return;
        await db.drafts.put(draft);
    });
    acknowledgeDraft(key, write);
}
export async function saveConversationDraft(draft: Draft) {
    const key = `core:draft:${draft.id}`, write = stageDraft(key, draft);
    await assertDraftAvailable(draft.id);
    await commitConversationDraft(key, write);
}
export async function deleteConversationDraft(id: string) {
    let removedFiles: string[] = [];
    await db.transaction('rw', [db.kv, db.drafts, db.files, db.recordings, db.submissions, db.pluginPending], async () => {
        const saved = (await db.kv.get('state'))?.value;
        const remote = saved?.snapshot.contexts.find((c: ConversationContext) => c.id === id) || state.remote.contexts.find(c => c.id === id);
        if (remote?.link || state.snapshot.contexts.find(c => c.id === id)?.link)
            throw new Error('This draft is now a Hermes conversation. Open it from the conversations list.');
        const actions = new Map<string, Action>();
        for (const action of [...state.actions, ...(saved?.actions || [])] as Action[])
            if (!actions.has(action.id) || actions.get(action.id)!.updatedAt <= action.updatedAt) actions.set(action.id, action);
        const submissions = await db.submissions.toArray();
        if ([...actions.values()].some(a => a.taskId === id && !a.cancelled && !['finished', 'failed'].includes(a.state)) ||
            submissions.some(s => (s.input.contextId || s.input.taskId) === id && !s.confirmed && !actions.has(s.id)))
            throw new Error('A send is still in progress or unconfirmed. Open the draft and check its status before deleting it.');
        const draft = await db.drafts.get(id);
        removedFiles = draft?.files || [];
        await db.drafts.delete(id);
        for (const row of await db.recordings.where('owner').equals(`chat:${id}`).toArray()) await queueTranscriptionDiscard(row);
        await db.recordings.where('owner').equals(`chat:${id}`).delete();
        await db.kv.bulkDelete([`context-draft:${id}`, `entry-route:${id}`, `entry-fields:${id}`, `entry-owner:${id}`]);
        // Retain a small deletion marker so a failed-send snapshot, stale URL,
        // or an older editor cannot restore the local draft after a refresh.
        await db.kv.put({ key: `context-draft-deleted:${id}`, value: true });
        const referencedByPlugin = (await db.pluginPending.toArray()).some(p => p.contextId === id);
        if (!remote && !referencedByPlugin) {
            await db.kv.bulkDelete([`context:${id}`, `settings-op:${id}`]);
        }
    });
    await cleanLocalFiles(removedFiles); void flushTranscriptionDiscards();
    await rebuild();
}
const titleWrites = new Map<string, Promise<void>>();
export function renameConversationTitle(id: string, title: string, baseTitle: string) {
    const work = (async () => {
        const context = state.snapshot.contexts.find(c => c.id === id);
        if (!context) throw new Error('This conversation is not available.');
        if (state.remote.contexts.some(c => c.id === id)) {
            const result = await api(`/contexts/${id}/title`, { title, baseTitle });
            await acceptSnapshot(result.snapshot);
        } else {
            await db.transaction('rw', db.kv, async () => { await assertDraftAvailable(id); await db.kv.put({ key: `context:${id}`, value: { ...context, title } }); });
        }
        await rebuild();
    })();
    titleWrites.set(id, work);
    const settled = () => { if (titleWrites.get(id) === work) titleWrites.delete(id); };
    void work.then(settled, settled);
    return work;
}
export async function setConversationHidden(conversation: Conversation, hidden: boolean) {
    const op: ConversationVisibilityOp = { id: crypto.randomUUID(), key: conversation.key, aliases: [...new Set([conversation.id, ...conversation.aliases])], hidden, at: Date.now() };
    lastOrder = Math.max(Date.now(), lastOrder + 1);
    await db.kv.put({ key: `visibility-op:${op.id}`, value: { op, order: lastOrder } satisfies PendingVisibility });
    await rebuild();
    void sync();
}
export async function addFile(file: File | Blob, name: string, owner?: string): Promise<string> {
    if (file.size > 25 * 1024 * 1024)
        throw new Error('The file is larger than 25 MiB.');
    if (!file.size)
        throw new Error('The file is empty.');
    const id = crypto.randomUUID();
    await db.transaction('rw', db.files, db.kv, async () => { if (owner) {
        const [pluginId, generation] = owner.split(':');
        if (((await db.kv.get(`plugin-generation:${pluginId}`))?.value ?? 0) !== Number(generation))
            throw new Error('Plugin data was reset.');
    } await db.files.add({ id, name, type: file.type || 'application/octet-stream', blob: file, ...(owner ? { owner } : {}) }); });
    return id;
}
export async function uploadFile(id: string, progress?: (n: number) => void) {
    const f = await db.files.get(id);
    if (!f)
        throw new Error('The saved attachment is unavailable.');
    const hash = f.hash || [...new Uint8Array(await crypto.subtle.digest('SHA-256', await f.blob.arrayBuffer()))].map(n => n.toString(16).padStart(2, '0')).join('');
    if (!f.hash)
        await db.files.update(id, { hash });
    let r = await api('/uploads', { id, name: f.name, type: f.type, size: f.blob.size, hash, ...(f.owner ? { owner: f.owner } : {}) });
    while (!r.complete) {
        const offset = r.offset;
        const chunk = f.blob.slice(offset, offset + 1024 * 1024);
        const response = await fetch(`/api/v1/uploads/${id}?offset=${offset}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'X-Herts-Request': '1' }, body: chunk, signal: AbortSignal.timeout(60000) });
        r = await response.json();
        if (!response.ok)
            throw new Error(r.error || 'Upload interrupted. The attachment is saved.');
        progress?.(Math.round(r.offset / f.blob.size * 100));
    }
}
export async function submit(input: any): Promise<Action> {
    const contextId = input.contextId || input.taskId;
    await assertDraftAvailable(contextId);
    const preview = state.snapshot.sessionSettings || emptySettings();
    await titleWrites.get(contextId);
    if (state.localSubmissions.some(s => s.taskId === contextId))
        throw new Error('A submitted request is still unconfirmed. Check its status before sending another.');
    await sync();
    if (state.pluginPending.some(p => p.contextId === contextId && state.plugins.entries.some(e => e.manifest.id === p.pluginId && e.enabled)))
        throw new Error('Sync or resolve saved changes for this conversation before sending.');
    const localContext = state.snapshot.contexts.find(c => c.id === contextId);
    if (!state.remote.contexts.some(c => c.id === contextId) && localContext && (await db.kv.get(`context-draft:${contextId}`))) {
        const data = await api('/contexts', { id: contextId, title: localContext.title });
        await acceptSnapshot(data.snapshot);
        await rebuild();
    }
    if (input.kind === 'send') {
        await syncSessionSettings();
        const now = state.remote.sessionSettings || emptySettings(), isNew = !state.snapshot.contexts.find(c => c.id === contextId)?.link;
        if (state.settingsPending?.some(p => p.contextId === contextId || (isNew && !p.contextId))) throw new Error('Sync or review the saved conversation settings before sending.');
        if (!sameSetting(preview.conversations[contextId]?.values || {}, now.conversations[contextId]?.values || {}) || (isNew && !sameSetting(preview.defaults.values, now.defaults.values))) throw new Error('Conversation settings changed. Review them before sending.');
        input = { ...input, settingsRevision: now.conversations[contextId]?.revision || 0, defaultsRevision: now.defaults.revision };
    }
    if (!state.online || !state.gateway.online)
        throw new Error('Hermes is unavailable. Your message is saved; send it when connected.');
    for (const id of input.uploadIds || [])
        await uploadFile(id);
    const context = state.snapshot.contexts?.find(c => c.id === contextId);
    const savedHistory = context?.link ? (await db.kv.get(`history:${context.link.storedId}:latest:0`))?.value : undefined;
    const baseline = context?.link ? historyBaseline(savedHistory) : { sessionId: '', ids: [] };
    await db.transaction('rw', db.kv, db.submissions, async () => {
        await assertDraftAvailable(contextId);
        const pending = (await db.submissions.toArray()).find(s => !s.confirmed && !state.actions.some(a => a.id === s.id) && (s.input.contextId || s.input.taskId) === contextId);
        if (pending)
            throw new Error('A submitted request is still unconfirmed. Check its status before sending another.');
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
        publish({ actions });
        await acceptSnapshot(state.remote, actions);
        await db.submissions.update(input.id, { confirmed: true });
        await rebuild();
        void refresh();
        return action;
    }
    catch (error) {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500)
            await db.submissions.delete(input.id);
        await rebuild();
        throw error;
    }
}
export async function resolveSubmission(id: string) {
    const local = await db.submissions.get(id);
    if (!local)
        return;
    await api('/actions/cancel', local.input);
    await db.submissions.update(id, { confirmed: true });
    await refresh();
    await rebuild();
}
export async function cacheRead<T = any>(key: string, fetcher: () => Promise<unknown>, read: (value: unknown) => T = value => value as T) {
    try {
        const value = read(await fetcher());
        await db.kv.put({ key, value });
        return { value, cached: false };
    }
    catch (error) {
        const saved = await db.kv.get(key);
        if (saved) {
            try { return { value: read(saved.value), cached: true }; }
            catch { /* Invalid cached data cannot replace the last displayed value. */ }
        }
        throw error;
    }
}
export function contextForConversation(id: string, aliases: string[] = []): ConversationContext | undefined {
    const ids = [id, ...aliases];
    return state.snapshot.contexts?.find(c => c.id === id || c.link && (ids.includes(c.link.key) || ids.includes(c.link.storedId) || c.aliases.some(alias => ids.includes(alias))));
}
export async function openConversation(id: string) {
    const result = await api(`/conversations/${encodeURIComponent(id)}/context`, {}, 'POST', 30000);
    await acceptSnapshot(result.snapshot);
    await rebuild();
}
