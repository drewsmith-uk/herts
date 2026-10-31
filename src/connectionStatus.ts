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
  if (state.syncActive || state.stateRefreshPending && !pending) return result('syncing', 'Syncing changes');
  if (pending) return result('waiting', 'Changes waiting to sync');
  return result('synced', 'Connected and synced');
}

export function pendingChanges(state: State) {
  const changes: { key: string; label: string; detail: string; reason: string; href: string }[] = [];
  const blocked = new Set<string>();
  for (const pending of state.pluginPending) {
    const entry = state.plugins.entries.find(entry => entry.manifest.id === pending.pluginId);
    const reason = pending.conflict || (!entry || !entry.available ? 'Plugin unavailable' : !entry.enabled ? 'Plugin disabled' :
      blocked.has(pending.pluginId) ? 'Waiting for an earlier change' : 'Waiting to sync');
    changes.push({ key: `plugin:${pending.id}`, label: `${entry?.manifest.name || pending.pluginId} change`,
      detail: pending.operation.command === 'space' ? 'Task space' : '', reason, href: '#/settings/plugins' });
    blocked.add(pending.pluginId);
  }
  for (const pending of state.settingsPending || []) {
    const context = state.snapshot.contexts.find(context => context.id === pending.contextId);
    const remote = state.remote.contexts.some(context => context.id === pending.contextId);
    changes.push({ key: `settings:${pending.input.id}`, label: pending.contextId ? 'Conversation settings' : 'Conversation defaults',
      detail: context?.link?.title || context?.title || '',
      reason: pending.conflict || (pending.contextId && !remote ? context ? 'Waiting for first message' : 'Conversation unavailable' : 'Waiting to sync'),
      href: !pending.contextId ? '#/settings' : context && remote ? `#/conversation/${encodeURIComponent(context.id)}` : '#/conversations' });
  }
  for (const pending of state.visibilityPending) {
    const context = state.snapshot.contexts.find(context => context.id === pending.op.key || context.link?.key === pending.op.key);
    changes.push({ key: `visibility:${pending.op.id}`, label: pending.op.hidden ? 'Hide conversation' : 'Show conversation',
      detail: context?.link?.title || context?.title || '', reason: 'Waiting to sync', href: '#/conversations' });
  }
  return changes;
}
