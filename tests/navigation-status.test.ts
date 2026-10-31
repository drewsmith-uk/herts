import { describe, expect, it } from 'vitest';
import { connectionStatus, pendingChanges } from '../src/connectionStatus';
import type { State } from '../src/data';

const ready = (): State => ({ defaultsReady: true, connectionChecked: true, online: true, gateway: { online: true, configured: true }, pluginPending: [], visibilityPending: [], settingsPending: [], localSubmissions: [], actions: [], error: '' } as unknown as State);
describe('connection status', () => {
  it('requires a checked connection and distinguishes unavailable Hermes', () => {
    const state = ready();
    expect(connectionStatus(state).kind).toBe('synced');
    state.defaultsReady = false; state.stateRefreshPending = true;
    expect(connectionStatus(state).kind).toBe('checking');
    state.defaultsReady = true; state.stateRefreshPending = false;
    state.connectionChecked = false;
    expect(connectionStatus(state).kind).toBe('checking');
    state.error = 'Device storage is unavailable';
    expect(connectionStatus(state).kind).toBe('warning');
    state.error = '';
    state.connectionChecked = true; state.online = false;
    expect(connectionStatus(state).kind).toBe('offline');
    state.online = true; state.gateway.online = false;
    expect(connectionStatus(state).label).toBe('Hermes unavailable');
  });
  it('distinguishes waiting from active synchronization and prioritizes review', () => {
    const state = ready();
    state.pluginPending = [{ conflict: undefined }] as State['pluginPending'];
    expect(connectionStatus(state).kind).toBe('waiting');
    state.syncActive = true;
    expect(connectionStatus(state).kind).toBe('syncing');
    state.pluginPending[0].conflict = 'Concurrent edit';
    expect(connectionStatus(state).kind).toBe('warning');
    state.online = false;
    expect(connectionStatus(state).kind).toBe('offline');
  });
  it('keeps conversation outcomes separate from synchronization failures', () => {
    const state = ready();
    state.localSubmissions = [{ id: 'unknown', taskId: 'context' }];
    expect(connectionStatus(state).kind).toBe('synced');
    state.localSubmissions = []; state.syncError = 'Failed';
    expect(connectionStatus(state).kind).toBe('warning');
    state.syncError = ''; state.actions = [{ receipt: 'unknown' }] as State['actions'];
    expect(connectionStatus(state).kind).toBe('synced');
  });
});

it('keeps a pending change waiting during background reads', () => {
  const state = ready();
  state.visibilityPending = [{ op: { id: 'hide', key: 'conversation', aliases: [], hidden: true, at: 1 }, order: 1 }];
  state.stateRefreshPending = true;
  expect(connectionStatus(state).kind).toBe('waiting');
  state.syncActive = true;
  expect(connectionStatus(state).kind).toBe('syncing');
});

it('identifies draft settings, missing conversations, defaults, and disabled plugins without exposing inputs', () => {
  const state = ready();
  state.snapshot = { revision: 0, hiddenConversations: [], contexts: [{ id: 'draft', title: 'Keep this draft', link: null, aliases: [] }] };
  state.remote = { revision: 0, hiddenConversations: [], contexts: [] };
  state.plugins = { entries: [{ manifest: { id: 'tasks', name: 'Tasks' }, available: true, enabled: false }] } as State['plugins'];
  state.pluginPending = [{ id: 'edit', pluginId: 'tasks', operation: { command: 'space', input: { secret: 'Private input' } } }] as State['pluginPending'];
  state.settingsPending = [
    { contextId: 'draft', input: { id: 'draft-settings', revision: 0, values: {} } },
    { contextId: 'missing', input: { id: 'missing-settings', revision: 0, values: {} } },
    { input: { id: 'defaults', revision: 0, values: {} }, conflict: 'Review saved choices' },
  ];
  const changes = pendingChanges(state);
  expect(changes.map(change => change.reason)).toEqual(['Plugin disabled', 'Saved with draft', 'Conversation unavailable', 'Review saved choices']);
  expect(changes[1]).toMatchObject({ label: 'Conversation settings', detail: 'Keep this draft', href: '#/conversations' });
  expect(changes[3].href).toBe('#/settings');
  expect(JSON.stringify(changes)).not.toContain('Private input');
});

it('retains draft settings without treating them as unsynced server changes', () => {
  const state = ready();
  state.snapshot = { revision: 0, hiddenConversations: [], contexts: [{ id: 'draft', title: 'Draft', link: null, aliases: [] }] };
  state.remote = { revision: 0, hiddenConversations: [], contexts: [] };
  state.settingsPending = [{ contextId: 'draft', input: { id: 'choices', revision: 0, values: { effort: 'high' } } }];
  state.stateRefreshPending = true;
  expect(connectionStatus(state)).toMatchObject({ kind: 'synced', pending: 0 });
  state.stateRefreshError = 'Read failed';
  expect(connectionStatus(state).kind).toBe('warning');
  state.stateRefreshError = '';
  state.remote.contexts = state.snapshot.contexts;
  expect(connectionStatus(state)).toMatchObject({ kind: 'waiting', pending: 1 });
  state.remote.contexts = [];
  state.settingsPending[0].conflict = 'Review choices';
  expect(connectionStatus(state)).toMatchObject({ kind: 'warning', pending: 1 });
});
