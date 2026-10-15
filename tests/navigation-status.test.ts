import { describe, expect, it } from 'vitest';
import { connectionStatus } from '../src/connectionStatus';
import type { State } from '../src/data';

const ready = (): State => ({ defaultsReady: true, connectionChecked: true, online: true, gateway: { online: true, configured: true }, pluginPending: [], visibilityPending: [], settingsPending: [], localSubmissions: [], actions: [], error: '' } as unknown as State);
describe('connection status', () => {
  it('requires a checked connection and distinguishes unavailable Hermes', () => {
    const state = ready();
    expect(connectionStatus(state).kind).toBe('synced');
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
