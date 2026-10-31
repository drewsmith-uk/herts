import type { State } from './data';

export function connectionStatus(state: State) {
  const pending = state.pluginPending.length + state.visibilityPending.length + (state.settingsPending?.length || 0);
  const review = state.pluginPending.some(op => op.conflict) || state.settingsPending?.some(op => op.conflict);
  const result = (kind: 'checking' | 'offline' | 'warning' | 'syncing' | 'waiting' | 'synced', label: string) => ({ kind, label, pending });
  if (!state.connectionChecked) return state.error ? result('warning', 'Device storage needs attention') : result('checking', 'Checking connection');
  if (!state.online) return result('offline', 'Disconnected');
  if (state.error || state.activitySyncError || state.syncError) return result('warning', 'Synchronization needs attention');
  if (review) return result('warning', 'Changes need review');
  if (!state.gateway.online || state.gateway.promptError) return result('warning', 'Hermes unavailable');
  if (state.syncActive || state.stateRefreshPending) return result('syncing', 'Syncing changes');
  if (pending) return result('waiting', 'Changes waiting to sync');
  return result('synced', 'Connected and synced');
}
