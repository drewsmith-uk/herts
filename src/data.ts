import Dexie, { liveQuery, type Table } from 'dexie';
import { ActivityCache, type ActivityCacheRow } from './activityCache';
import { retainRecoveryDetail, type ActivitySummary, type ActivityDetails, type ActivityPage } from '../shared/activity';
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
import { foregroundRead, interruptBackgroundRead, waitForForeground } from './foregroundReads';
import { applyContextObservations, type ContextObservation } from './contextSnapshots';
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
    activityCache!: Table<ActivityCacheRow, string>;
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
        this.version(5).stores({ activityCache: 'key,kind,contextId,[kind+contextId]' });
    }
}
export const db = new LocalDB();
const activityCache = new ActivityCache(db);
let activityCacheReady = false;
export interface State {
    activitySummaries: Record<string, ActivitySummary>;
    activitySync?: boolean;
    activityGeneration?: string;
    activityCursors?: Record<string, string | null>;
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
    connectionChecked?: boolean;
    checkingStatus?: boolean;
    syncActive?: boolean;
    syncError?: string;
    stateRefreshPending?: boolean;
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
let state: State = { activitySummaries: {}, snapshot: empty(), remote: empty(), actions: [], bindings: {}, plugins: emptyCatalogue(), pluginData: {}, pluginRemote: {}, pluginPending: [], visibilityPending: [], online: false, connectionChecked: false, connectionVersion: 0, loaded: false, defaultsReady: false, gateway: { online: false, configured: false }, error: '', pushKey: '', localSubmissions: [], outgoing: [] };
const listeners = new Set<() => void>();
let refreshing = false, lastOrder = Date.now(), focusedStatusReads = 0;
let refreshAgain = false, recoverAfterRefresh = false, refreshRequest: AbortController | undefined;
let connectionObservation = 0, activityRevision = 0, lastBindingsRefresh = 0, lastBackgroundRefresh = 0;
const activityRevisions = new Map<string, number>();
const contextObservations = new Map<string, ContextObservation>();
const visibleConversations = new Set<string>();
let backgroundTimer: ReturnType<typeof setTimeout> | undefined;
export function beginActivityRead() {
    return { observation: ++connectionObservation, revision: ++activityRevision, generation: state.activityGeneration };
}
export function observeConversation(id: string) {
    visibleConversations.add(id);
    if (activityCacheReady) void activityCache.touch(id);
    return () => {
        visibleConversations.delete(id);
        if (!visibleConversations.size) {
            clearTimeout(backgroundTimer); backgroundTimer = undefined;
            scheduleBackgroundRefresh();
        }
    };
}
function scheduleBackgroundRefresh() {
    if (backgroundTimer) return;
    const delay = Math.max(200, lastBackgroundRefresh + (visibleConversations.size ? 30000 : 1000) - Date.now());
    backgroundTimer = setTimeout(() => {
        backgroundTimer = undefined;
        if (navigator.onLine && !document.hidden) void refresh(false, true);
    }, delay);
}
function acceptConnection(data: Pick<State, 'gateway' | 'pushKey' | 'activitySync' | 'activityGeneration'>, observation: number, recover = false) {
    if (observation !== connectionObservation || !navigator.onLine) return;
    const recovered = recover || !state.online || !state.gateway.online && data.gateway.online;
    publish({ gateway: data.gateway, pushKey: data.pushKey, activitySync: data.activitySync, activityGeneration: data.activityGeneration, online: true, connectionChecked: true,
        connectionVersion: state.connectionVersion + (recovered ? 1 : 0) });
    if (recovered) void sync();
    if (data.activitySync) void syncActivity();
}
let connectionRequest: AbortController | undefined;
export async function refreshConnection(recover = false) {
    if (connectionRequest && !recover) return;
    connectionRequest?.abort();
    const controller = new AbortController(), observation = ++connectionObservation;
    connectionRequest = controller;
    try { acceptConnection(await api('/connection', undefined, 'GET', 5000, controller.signal), observation, recover); }
    catch (error) {
        if (!controller.signal.aborted && observation === connectionObservation)
            publish({ online: false, connectionChecked: true, ...(error instanceof ApiError && error.status === 403 ? { error: error.message } : {}) });
    } finally { if (connectionRequest === controller) connectionRequest = undefined; }
}
function mergedActions(updates: Action[], existing = state.actions) {
    const actions = new Map(existing.map(action => [action.id, action]));
    for (const update of updates) {
        const prior = actions.get(update.id);
        if (!prior || prior.updatedAt < update.updatedAt)
            actions.set(update.id, redactSavedMessage(prior?.savedMessageDeletedAt ? { ...update, savedMessageDeletedAt: prior.savedMessageDeletedAt } : update));
    }
    return [...actions.values()].sort((a, b) => b.createdAt - a.createdAt);
}
const detailVersions = new Map<string, string>();
async function acceptLegacyActivity(contextId: string, actions: Action[]) {
    if (!activityCacheReady) return;
    await activityCache.touch(contextId);
    await activityCache.legacyDetails(contextId, actions);
    await purgeDeletedSavedMessages(actions);
    for (const action of actions) await db.submissions.update(action.id, { confirmed: true });
    const cached = await activityCache.read();
    publish({ actions: cached.actions, activitySummaries: cached.summaries });
    await rebuild();
}
export async function acceptActivityDetails(details: ActivityDetails, generation = state.activityGeneration, includeCursor: boolean | 'page' = false) {
    if (includeCursor) await activityCache.touch(details.summary.contextId);
    if (!await activityCache.details(details, generation)) return false;
    for (const action of details.actions) await db.submissions.update(action.id, { confirmed: true });
    if (details.actions.some(action => action.savedMessageDeletedAt)) await purgeDeletedSavedMessages(details.actions);
    const cached = await activityCache.read();
    const version = `${details.generation}:${details.summary.version}`, contextId = details.summary.contextId;
    const updateCursor = includeCursor && (includeCursor === 'page' || detailVersions.get(contextId) !== version);
    if (includeCursor) detailVersions.set(contextId, version);
    publish({ actions: cached.actions, activitySummaries: cached.summaries,
        ...(updateCursor ? { activityCursors: { ...state.activityCursors, [contextId]: details.cursor } } : {}) });
    await rebuild();
    return true;
}
export async function loadMoreActivity(contextId: string, signal?: AbortSignal) {
    const cursor = state.activityCursors?.[contextId]; if (!cursor) return;
    return foregroundRead(async () => {
        const generation = state.activityGeneration;
        try {
            const data = await activityApi(`/contexts/${encodeURIComponent(contextId)}/activity?cursor=${encodeURIComponent(cursor)}`, undefined, 'GET', 10000, signal);
            if (data.activity) await acceptActivityDetails(data.activity, generation, 'page');
        } catch (error) {
            if (error instanceof ApiError && error.status === 409) {
                detailVersions.delete(contextId);
                await readConversationActivity(contextId, signal || new AbortController().signal);
            } else throw error;
        }
    });
}
let activitySyncRequest: Promise<void> | undefined;
export function syncActivity(): Promise<void> {
    if (activitySyncRequest) return activitySyncRequest;
    activitySyncRequest = (async () => {
        const changed = new Set<string>(); let rebase = false;
        while (state.online && state.activitySync) {
            await waitForForeground();
            if (!state.online || !state.activitySync) break;
            const position = await activityCache.position(), controller = new AbortController();
            const stop = interruptBackgroundRead(() => controller.abort());
            try {
                const page: ActivityPage = await api(`/activity-sync${position.cursor ? `?cursor=${encodeURIComponent(position.cursor)}` : ''}`, undefined, 'GET', 10000, controller.signal);
                stop();
                if (!await activityCache.page(page, position)) continue;
                rebase ||= page.rebase;
                for (const change of page.changes) changed.add(change.summary.contextId);
                if (!page.hasMore) break;
            } catch (error) {
                if (controller.signal.aborted) continue;
                if (error instanceof ApiError && error.status === 409 && error.data?.rebase) { await activityCache.reset(position); continue; }
                publish({ syncError: 'Activity could not be updated. Select Sync now in Settings.' });
                return;
            } finally { stop(); }
        }
        if (!state.online || !state.activitySync) return;
        const submissions = await db.submissions.toArray();
        const ids = [...new Set([...submissions.filter(s => !s.confirmed).map(s => s.id),
            ...state.actions.filter(a => retainRecoveryDetail(a) && (rebase || changed.has(a.taskId))).map(a => a.id)])];
        await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
            while (ids.length && state.online) {
                await waitForForeground();
                const id = ids.shift()!, controller = new AbortController(), generation = state.activityGeneration;
                const stop = interruptBackgroundRead(() => controller.abort());
                try {
                    const result = await activityApi(`/actions/${encodeURIComponent(id)}`, undefined, 'GET', 10000, controller.signal);
                    stop();
                    if (result.activity) await acceptActivityDetails(result.activity, generation);
                } catch {
                    if (controller.signal.aborted) ids.push(id);
                } finally { stop(); }
            }
        }));
    })().catch(() => { publish({ syncError: 'Activity could not be saved. Reload to try again.' }); }).finally(() => { activitySyncRequest = undefined; });
    return activitySyncRequest;
}
export async function readConversationActivity(contextId: string, signal: AbortSignal, priority = false) {
    return foregroundRead(async () => {
        focusedStatusReads++;
        if (state.localSubmissions.some(submission => submission.taskId === contextId)) publish({ checkingStatus: true });
        try {
            const { observation, revision, generation } = beginActivityRead();
            const path = location.hash.slice(1).split('?')[0];
            const pluginId = state.plugins.entries.find(entry => entry.enabled && entry.manifest.routes?.some(prefix => path === prefix || path.startsWith(prefix + '/')))?.manifest.id;
            const data = await activityApi(`/contexts/${encodeURIComponent(contextId)}/activity${pluginId ? `?pluginId=${encodeURIComponent(pluginId)}` : ''}`, undefined, 'GET', 10000, signal);
            if (data.contextId !== contextId) throw new Error('The conversation identity changed.');
            if (signal.aborted || revision < lastBindingsRefresh || revision < (activityRevisions.get(contextId) || 0)) return;
            acceptConnection(data, observation);
            if (data.activity && !await acceptActivityDetails(data.activity, generation, true)) return;
            if (!data.activity && data.actions) { await acceptLegacyActivity(contextId, data.actions); data.actions = []; }
            if (signal.aborted || revision < lastBindingsRefresh || revision < (activityRevisions.get(contextId) || 0)) return;
            if (data.context && data.revision > state.remote.revision && data.revision >= (contextObservations.get(contextId)?.revision || 0))
                contextObservations.set(contextId, { context: data.context, revision: data.revision, settings: data.settings });
            const projected = applyContextObservations(state.remote, contextObservations.values());
            const contextChanged = JSON.stringify(projected.contexts.find(context => context.id === contextId)) !== JSON.stringify(state.remote.contexts.find(context => context.id === contextId))
                || JSON.stringify(projected.sessionSettings) !== JSON.stringify(state.remote.sessionSettings);
            const actions = mergedActions(data.actions || []), changed = actions.some((action, index) => action !== state.actions[index]);
            activityRevisions.set(contextId, revision);
            const bindings = { ...state.bindings }; if (data.binding) bindings[contextId] = data.binding; else delete bindings[contextId];
            publish({ actions, bindings });
            if (changed || contextChanged) {
                await acceptSnapshot(state.remote, await purgeDeletedSavedMessages(actions));
                for (const action of (data.actions || []) as Action[]) await db.submissions.update(action.id, { confirmed: true });
                await rebuild();
            }
            if (data.plugins && (data.plugins.revision > state.plugins.revision || Object.entries(data.pluginData as Record<string, PluginData>).some(([id, next]) =>
                !state.pluginRemote[id] || next.generation > state.pluginRemote[id].generation || next.revision > state.pluginRemote[id].revision)))
                await acceptPlugins(data.plugins, data.pluginData);
        } finally {
            focusedStatusReads--;
            publish({ checkingStatus: !!state.localSubmissions.length && (refreshing || focusedStatusReads > 0) });
        }
    }, priority);
}
export async function acceptNotificationDestination(data: {
    snapshot: CoreSnapshot; actions?: Action[]; activity?: ActivityDetails | null; bindings: Record<string, Binding | undefined>;
    plugins: PluginCatalogue; pluginData: Record<string, PluginData>; gateway: State['gateway']; pushKey: string;
}, { observation, revision, generation }: ReturnType<typeof beginActivityRead>) {
    acceptConnection(data, observation);
    if (data.activity) await acceptActivityDetails(data.activity, generation, true);
    else if (data.actions) for (const contextId of new Set([...Object.keys(data.bindings), ...data.actions.map(action => action.taskId)]))
        await acceptLegacyActivity(contextId, data.actions.filter(action => action.taskId === contextId));
    const bindings = { ...state.bindings };
    for (const [id, binding] of Object.entries(data.bindings)) {
        if (revision < lastBindingsRefresh || revision < (activityRevisions.get(id) || 0)) continue;
        activityRevisions.set(id, revision);
        if (binding) bindings[id] = binding; else delete bindings[id];
    }
    publish({ actions: activityCacheReady ? state.actions : mergedActions(data.actions || []), bindings });
    await acceptSnapshot(data.snapshot, await purgeDeletedSavedMessages(mergedActions(data.actions || [])));
    await acceptPlugins(data.plugins, data.pluginData);
    publish({ defaultsReady: true });
}
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
export function subscribeCore(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function registerPluginData(id: string, definition?: ClientPlugin) { if (definition)
    definitions.set(id, definition);
else
    definitions.delete(id); return rebuild(); }
export class ApiError extends Error {
    constructor(message: string, public status: number, public data: any) { super(message); }
}
export function activityApi(path: string, body?: unknown, method?: string, timeout?: number, signal?: AbortSignal) {
    return api(path, body, method, timeout, signal, true);
}
export async function api(path: string, body?: unknown, method?: string, timeout = 190000, signal?: AbortSignal, compact = false): Promise<any> {
    let r: Response;
    const requestSignal = AbortSignal.any([AbortSignal.timeout(timeout), ...(signal ? [signal] : [])]);
    try {
        r = await fetch(`/api/v1${path}`, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { 'X-Herts-Plugin-API': '1', ...(compact ? { 'X-Herts-Activity-Sync': '1' } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Herts-Request': '1' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: requestSignal, cache: 'no-store' });
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
let rebuildVersion = 0;
export async function rebuild() {
    const version = ++rebuildVersion;
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
    // A slower read must not replace a newer snapshot and briefly remove a
    // draft created while its device-storage reads were in flight.
    if (version !== rebuildVersion) return;
    publish({ snapshot, pluginData, pluginPending, visibilityPending, settingsPending, outgoing, localSubmissions, checkingStatus: !!localSubmissions.length && (refreshing || focusedStatusReads > 0) });
}
export async function acceptPlugins(catalogue: PluginCatalogue, data: Record<string, PluginData> = state.pluginRemote) {
    if (catalogue.revision < state.plugins.revision)
        return;
    const changed = JSON.stringify(state.plugins.entries.filter(e => e.enabled).map(e => [e.manifest.id, e.hash, e.generation])) !== JSON.stringify(catalogue.entries.filter(e => e.enabled).map(e => [e.manifest.id, e.hash, e.generation]));
    const reset = state.plugins.entries.some(old => (catalogue.entries.find(e => e.manifest.id === old.manifest.id)?.generation ?? 0) > old.generation);
    // The first catalogue loads plugins without replacing mounted plugin screens.
    if (changed && !reset && state.plugins.entries.length > 0) {
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
    window.dispatchEvent(new Event('herts-plugin-catalogue'));
}
export async function initialise() {
    try {
        for (const key of pendingDraftKeys('core:draft:')) { const write = pendingDraft(key); if (write) await commitConversationDraft(key, write); }
        const saved = (await db.kv.get('state'))?.value, plugins = (await db.kv.get('plugins'))?.value;
        await activityCache.seed(saved?.actions || []);
        activityCacheReady = true;
        const activity = await activityCache.read(), position = await activityCache.position();
        publish({ actions: activity.actions, activitySummaries: activity.summaries, activityGeneration: position.generation });
        liveQuery(() => activityCache.read()).subscribe({ next: value => publish({ actions: value.actions, activitySummaries: value.summaries }),
            error: () => publish({ syncError: 'Saved activity could not be loaded. Reload to try again.' }) });
        if (saved && saved.snapshot.revision >= state.remote.revision)
            publish({ remote: { ...empty(), ...saved.snapshot } });
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
            const pluginRemote = Object.fromEntries(entries.map(e => [e.manifest.id, { generation: e.generation, revision: 0, schemaVersion: 1, records: e.generation > 0 ? {} : e.manifest.id === 'tasks' && Array.isArray(snapshot.tasks) ? { state: snapshot } : e.manifest.id === 'reading' && snapshot.reading ? { state: snapshot.reading } : {} }]));
            await acceptPlugins({ revision: bootstrap?.revision || 0, order: bootstrap?.order || ['tasks', 'conversations', 'reading'], entries }, pluginRemote);
        }
        await rebuild();
        publish({ loaded: true, defaultsReady: state.defaultsReady || !!saved });
        window.dispatchEvent(new Event('herts-plugin-catalogue'));
        void cleanLocalFiles().catch(() => {});
        setInterval(() => { if (!document.hidden) void cleanLocalFiles().catch(() => {}); }, 60000);
        if (navigator.storage?.persist)
            void navigator.storage.persist();
        void refreshConnection().finally(() => { void refresh(false, true); });
        const recover = () => { if (navigator.onLine && !document.hidden) { void refreshConnection(true); scheduleBackgroundRefresh(); } };
        window.addEventListener('online', recover);
        window.addEventListener('offline', () => { connectionObservation++; connectionRequest?.abort(); publish({ online: false, connectionChecked: true }); refreshRequest?.abort(); });
        window.addEventListener('pageshow', recover);
        window.addEventListener('focus', recover);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible')
            recover(); });
        const events = new EventSource('/api/v1/events');
        events.addEventListener('open', recover);
        let timer: ReturnType<typeof setTimeout> | undefined;
        events.addEventListener('refresh', () => { if (timer)
            return; timer = setTimeout(() => { timer = undefined; window.dispatchEvent(new Event('herts-activity')); void refreshConnection(); scheduleBackgroundRefresh(); }, 150); });
        setInterval(() => { if (navigator.onLine && document.visibilityState === 'visible')
            { void refreshConnection(); scheduleBackgroundRefresh(); } }, 8000);
    }
    catch {
        publish({ loaded: true, defaultsReady: true, error: 'Device storage is unavailable. Changes cannot be safely saved. Check browser storage settings.' });
    }
}
export async function refresh(recover = false, background = false) {
    if (background) await waitForForeground();
    if (refreshing) {
        refreshAgain = true; recoverAfterRefresh ||= recover;
        // Only abandon the read-only status request, never a submitted action.
        if (recover) refreshRequest?.abort();
        return;
    }
    refreshing = true;
    publish({ stateRefreshPending: true });
    if (state.localSubmissions.length) publish({ checkingStatus: true });
    const controller = new AbortController(); refreshRequest = controller;
    const { observation, revision: activityAtStart } = beginActivityRead();
    const stopInterrupting = background ? interruptBackgroundRead(() => controller.abort()) : () => {};
    try {
        const data = await activityApi('/state', undefined, 'GET', 10000, controller.signal);
        stopInterrupting();
        refreshRequest = undefined;
        acceptConnection(data, observation, recover);
        if (data.actions) {
            data.actions = await purgeDeletedSavedMessages(mergedActions(data.actions));
            if (activityCacheReady && !data.activitySync) { await activityCache.legacy(data.actions); data.actions = (await activityCache.read()).actions; }
        }
        await acceptSnapshot(data.snapshot, data.actions || state.actions);
        await acceptPlugins(data.plugins, data.pluginData);
        for (const [id, revision] of activityRevisions) if (revision > activityAtStart) {
            if (state.bindings[id]) data.bindings[id] = state.bindings[id]; else delete data.bindings[id];
        }
        lastBindingsRefresh = activityAtStart;
        publish({ actions: mergedActions(data.actions || []), bindings: data.bindings, defaultsReady: true, error: '' });
        lastBackgroundRefresh = Date.now();
        void flushTranscriptionDiscards();
        for (const s of await db.submissions.toArray())
            if (data.actions?.some((a: Action) => a.id === s.id))
                await db.submissions.update(s.id, { confirmed: true });
        await rebuild();
        void sync();
    }
    catch (e) {
        if (!controller.signal.aborted) {
            publish({ defaultsReady: true, syncError: 'Updates could not be loaded. Select Sync now in Settings.' });
            void refreshConnection();
        } else if (background) scheduleBackgroundRefresh();
    }
    finally {
        refreshing = false;
        stopInterrupting();
        publish({ stateRefreshPending: false, checkingStatus: !!state.localSubmissions.length && focusedStatusReads > 0 });
        refreshRequest = undefined;
        if (refreshAgain) { const recovery = recoverAfterRefresh; refreshAgain = false; recoverAfterRefresh = false; void refresh(recovery, true); }
    }
}
/** Erase saved copies on reconnect too, while keeping independent drafts and history. */
export async function purgeDeletedSavedMessages(actions: Action[]): Promise<Action[]> {
    return db.transaction('rw', db.kv, db.submissions, db.files, db.drafts, db.pluginLocal, async () => {
        const saved = (await db.kv.get('state'))?.value;
        const prior: Action[] = [...(activityCacheReady ? [] : saved?.actions || []), ...state.actions];
        const deleted = new Map([...prior, ...actions].filter(a => a.savedMessageDeletedAt).map(a => [a.id, a.savedMessageDeletedAt!]));
        if (!deleted.size) return actions;
        const clean = mergedActions(actions, mergedActions(state.actions, activityCacheReady ? [] : saved?.actions || [])).map(a => redactSavedMessage(deleted.has(a.id) ? { ...a, savedMessageDeletedAt: deleted.get(a.id) } : a));
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
        if (saved) await db.kv.put({ key: 'state', value: { ...saved, actions: activityCacheReady ? [] : clean } });
        return clean;
    });
}
export async function acceptSnapshot(snapshot: CoreSnapshot, actions = state.actions) {
    const core = { revision: snapshot.revision, contexts: snapshot.contexts || [], hiddenConversations: snapshot.hiddenConversations || [], sessionSettings: snapshot.sessionSettings || emptySettings() };
    const chosen = await db.transaction('rw', db.kv, async () => {
        const saved = (await db.kv.get('state'))?.value, chosen = saved?.snapshot.revision > core.revision ? saved.snapshot : core;
        const deleted = new Map<string, number>([...(activityCacheReady ? [] : saved?.actions || []), ...state.actions].filter((a: Action) => a.savedMessageDeletedAt).map((a: Action) => [a.id, a.savedMessageDeletedAt!]));
        const clean = activityCacheReady ? [] : mergedActions(actions, mergedActions(state.actions, saved?.actions || [])).map(a => redactSavedMessage(deleted.has(a.id) ? { ...a, savedMessageDeletedAt: deleted.get(a.id) } : a));
        const projected = applyContextObservations(chosen, contextObservations.values());
        await db.kv.put({ key: 'state', value: { snapshot: projected, actions: clean } });
        return projected;
    });
    if (chosen.revision >= state.remote.revision)
        publish({ remote: applyContextObservations(chosen, contextObservations.values()) });
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
let activeSyncRequests = 0;
async function syncRequest(path: string, input: unknown, timeout?: number) {
    activeSyncRequests++;
    publish({ syncActive: true, syncError: '' });
    try { return await api(path, input, undefined, timeout); }
    catch (error) {
        publish({ syncError: error instanceof Error ? error.message : 'Synchronization failed. Try again.' });
        throw error;
    }
    finally { activeSyncRequests--; publish({ syncActive: activeSyncRequests > 0 }); }
}
let activeSync: Promise<void> | undefined;
export function sync(): Promise<void> { if (activeSync)
    return activeSync; activeSync = (async () => { let order; do {
    order = lastOrder;
    await syncNow();
} while (state.online && order !== lastOrder); })().finally(() => { activeSync = undefined; }); return activeSync; }
const pluginWrites = new Map<string, Promise<boolean>>();
function syncPluginOperation(pending: PendingPlugin): Promise<boolean> {
    const active = pluginWrites.get(pending.id); if (active) return active;
    const work = (async () => {
        const current = await db.pluginPending.get(pending.id);
        if (!current) return true;
        if (current.conflict || !state.plugins.entries.some(e => e.manifest.id === current.pluginId && e.enabled)) return false;
        try {
            const data = await syncRequest(`/plugins/${current.pluginId}/commands`, current.operation);
            await db.transaction('rw', db.pluginPending, db.kv, async () => { await db.pluginPending.delete(current.id); await acceptSnapshot(data.snapshot); });
            await acceptPlugins(state.plugins, { [current.pluginId]: data.data });
            await definitions.get(current.pluginId)?.reconcile?.(data.result, current.operation);
            return true;
        } catch (error) {
            if (error instanceof ApiError && [400, 409, 410, 423].includes(error.status)) {
                if (error.status === 410) await refresh();
                if (error.status === 409) {
                    if (error.data.snapshot) await acceptSnapshot(error.data.snapshot);
                    if (error.data.pluginData) await acceptPlugins(state.plugins, error.data.pluginData);
                }
                if (![410, 423].includes(error.status)) await db.pluginPending.update(current.id, { conflict: error.message });
            } else void refreshConnection();
            return false;
        } finally { await rebuild(); }
    })().finally(() => { pluginWrites.delete(pending.id); });
    pluginWrites.set(pending.id, work); return work;
}
async function syncConversationDependencies(contextId: string) {
    const pending = await db.pluginPending.orderBy('order').toArray();
    const related = new Set(pending.filter(p => p.contextId === contextId).map(p => p.pluginId));
    const path = location.hash.slice(1).split('?')[0];
    for (const entry of state.plugins.entries) if (entry.manifest.routes?.some(prefix => path === prefix || path.startsWith(prefix + '/'))) related.add(entry.manifest.id);
    for (const operation of pending) if (operation.contextId === contextId || !operation.contextId && related.has(operation.pluginId)) {
        if (!await syncPluginOperation(operation)) throw new Error('Sync or resolve saved changes for this conversation before sending.');
    }
}
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
        if (!await syncPluginOperation(pending)) blocked.add(pending.pluginId);
    }
    if (state.online)
        for (const p of await pendingVisibility()) {
            try {
                const data = await syncRequest('/conversations/visibility', p.op);
                await db.transaction('rw', db.kv, async () => { await acceptSnapshot(data.snapshot); await db.kv.delete(`visibility-op:${p.op.id}`); });
                await rebuild();
            }
            catch (e) {
                publish({ error: e instanceof Error ? e.message : 'Hidden-item change is saved on this device.' });
                break;
            }
        }
    await syncSessionSettings();
    if (state.online && !state.pluginPending.length && !state.visibilityPending.length && !state.settingsPending?.length) publish({ syncError: '' });
}
const settingsWrites = new Map<string, Promise<void>>();
async function syncSettingsKey(key: string): Promise<void> {
    const active = settingsWrites.get(key); if (active) return active;
    const work = (async () => {
            if (!state.online) return;
            const row = await db.kv.get(key); if (!row) return;
            const op = row.value as PendingSettings;
            if (op.conflict || (op.contextId && !state.remote.contexts.some(c => c.id === op.contextId))) return;
            try {
                const result = await syncRequest(op.contextId ? `/contexts/${op.contextId}/settings` : '/session-defaults', op.input, 15000);
                await db.transaction('rw', db.kv, async () => {
                    await acceptSnapshot(result.snapshot);
                    if ((await db.kv.get(row.key))?.value.input.id === op.input.id) await db.kv.delete(row.key);
                });
            } catch (e) {
                if (e instanceof ApiError && e.data?.snapshot) await acceptSnapshot(e.data.snapshot);
                if (e instanceof ApiError && [400, 409].includes(e.status)) {
                    await db.transaction('rw', db.kv, async () => { if ((await db.kv.get(row.key))?.value.input.id === op.input.id) await db.kv.put({ key: row.key, value: { ...op, conflict: e.message } }); });
                }
            }
        await rebuild();
    })().finally(() => { settingsWrites.delete(key); });
    settingsWrites.set(key, work); return work;
}
export async function syncSessionSettings(scope?: { contextId?: string; includeDefaults?: boolean }): Promise<void> {
    const keys = scope ? [...(scope.contextId ? [`settings-op:${scope.contextId}`] : []), ...(scope.includeDefaults ? ['settings-op:defaults'] : [])]
        : (await db.kv.where('key').startsWith('settings-op:').toArray()).map(row => row.key);
    await Promise.all(keys.map(syncSettingsKey));
}
export async function saveSessionChoices(contextId: string | undefined, revision: number, values: SessionValues, baseline?: SessionValues, reviewed = false) {
    await settingsWrites.get(`settings-op:${contextId || 'defaults'}`);
    const input = { id: crypto.randomUUID(), revision, values, ...(baseline ? { baseline } : {}), ...(reviewed ? { reviewed: true } : {}) };
    await db.kv.put({ key: `settings-op:${contextId || 'defaults'}`, value: { contextId, input } satisfies PendingSettings });
    lastOrder = Math.max(Date.now(), lastOrder + 1);
    await rebuild(); await syncSessionSettings({ contextId, includeDefaults: !contextId });
    const pending = (await db.kv.get(`settings-op:${contextId || 'defaults'}`))?.value as PendingSettings | undefined;
    if (pending?.conflict) throw new Error(pending.conflict);
}
export async function useSyncedSessionChoices(contextId?: string) {
    await settingsWrites.get(`settings-op:${contextId || 'defaults'}`); await db.kv.delete(`settings-op:${contextId || 'defaults'}`); await rebuild();
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
    await db.transaction('rw', [db.kv, db.drafts, db.files, db.recordings, db.submissions, db.pluginPending, db.activityCache], async () => {
        const saved = (await db.kv.get('state'))?.value;
        const remote = saved?.snapshot.contexts.find((c: ConversationContext) => c.id === id) || state.remote.contexts.find(c => c.id === id);
        if (remote?.link || state.snapshot.contexts.find(c => c.id === id)?.link)
            throw new Error('This draft is now a Hermes conversation. Open it from the conversations list.');
        const actions = new Map<string, Action>();
        for (const action of [...state.actions, ...(activityCacheReady ? [] : saved?.actions || [])] as Action[])
            if (!actions.has(action.id) || actions.get(action.id)!.updatedAt <= action.updatedAt) actions.set(action.id, action);
        const submissions = await db.submissions.toArray();
        const summary = (await db.activityCache.get(`summary:${id}`))?.value?.summary as ActivitySummary | undefined;
        if (summary?.main && !['finished', 'failed'].includes(summary.main.state) ||
            [...actions.values()].some(a => a.taskId === id && !a.cancelled && !['finished', 'failed'].includes(a.state)) ||
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
    if (titleWrites.has(id)) return Promise.reject(new Error('Wait for the current title change to finish.'));
    const work = (async () => {
        const context = state.snapshot.contexts.find(c => c.id === id);
        if (!context) throw new Error('This conversation is not available.');
        if (state.remote.contexts.some(c => c.id === id)) {
            const key = `title-edit:${id}`;
            const previous = (await db.kv.get(key))?.value as { title: string; baseTitle: string; operationId: string } | undefined;
            const edit = previous?.title === title && previous.baseTitle === baseTitle ? previous : { title, baseTitle, operationId: crypto.randomUUID() };
            await db.kv.put({ key, value: edit });
            const clearEdit = () => db.transaction('rw', db.kv, async () => {
                if ((await db.kv.get(key))?.value?.operationId === edit.operationId) await db.kv.delete(key);
            });
            let result;
            try { result = await api(`/contexts/${id}/title`, edit); }
            catch (error) {
                if (error instanceof ApiError && error.data?.operationRejected === true) await clearEdit();
                throw error;
            }
            await acceptSnapshot(result.snapshot);
            await clearEdit();
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
    await syncConversationDependencies(contextId);
    if ((await db.pluginPending.toArray()).some(p => p.contextId === contextId && state.plugins.entries.some(e => e.manifest.id === p.pluginId && e.enabled)))
        throw new Error('Sync or resolve saved changes for this conversation before sending.');
    const localContext = state.snapshot.contexts.find(c => c.id === contextId);
    if (!state.remote.contexts.some(c => c.id === contextId) && localContext && (await db.kv.get(`context-draft:${contextId}`))) {
        const data = await api('/contexts', { id: contextId, title: localContext.title });
        await acceptSnapshot(data.snapshot);
        await rebuild();
    }
    if (input.kind === 'send') {
        await syncSessionSettings({ contextId, includeDefaults: !localContext?.link });
        const now = state.remote.sessionSettings || emptySettings(), isNew = !state.snapshot.contexts.find(c => c.id === contextId)?.link;
        const settingsPending = (await db.kv.where('key').startsWith('settings-op:').toArray()).map(row => row.value as PendingSettings);
        if (settingsPending.some(p => p.contextId === contextId || (isNew && !p.contextId))) throw new Error('Sync or review the saved conversation settings before sending.');
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
        const result = await activityApi('/actions', input);
        if (result.activity) { await activityCache.touch(contextId); await acceptActivityDetails(result.activity); }
        // The receipt can arrive while a state refresh is already in flight. Show it
        // immediately and retain newer event state if it beat the HTTP response.
        const known = state.actions.find(a => a.id === input.id);
        const action = known && known.updatedAt >= result.action.updatedAt ? known : result.action;
        const actions = [...state.actions.filter(a => a.id !== input.id), action].sort((a, b) => b.createdAt - a.createdAt);
        publish({ actions });
        if (activityCacheReady && !result.activity) await activityCache.remember([action]);
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
    const result = await activityApi('/actions/cancel', local.input);
    if (result.activity) await acceptActivityDetails(result.activity);
    await db.submissions.update(id, { confirmed: true });
    await refresh();
    await rebuild();
}
export async function cacheRead<T = any>(key: string, fetcher: () => Promise<unknown>, read: (value: unknown) => T = value => value as T): Promise<{ value: T; cached: boolean; error?: unknown }> {
    try {
        const value = read(await fetcher());
        await db.kv.put({ key, value });
        return { value, cached: false };
    }
    catch (error) {
        const saved = await db.kv.get(key);
        if (saved) {
            try { return { value: read(saved.value), cached: true, error }; }
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
    await foregroundRead(async () => {
        const result = await api(`/conversations/${encodeURIComponent(id)}/context`, {}, 'POST', 30000);
        await acceptSnapshot(result.snapshot);
        await rebuild();
    });
}
