import type { CoreSnapshot } from './data';
import type { ConversationContext } from '../shared/conversations';
import { emptySettings, type SettingsRecord } from '../shared/sessionSettings';

export interface ContextObservation {
  revision: number;
  context: ConversationContext;
  settings: { defaults: SettingsRecord; conversation: SettingsRecord | null };
}

export function applyContextObservations(snapshot: CoreSnapshot, observations: Iterable<ContextObservation>): CoreSnapshot {
  const contexts = new Map(snapshot.contexts.map(context => [context.id, context]));
  const saved = snapshot.sessionSettings || emptySettings();
  const settings = { defaults: saved.defaults, conversations: { ...saved.conversations } };
  for (const observed of observations) {
    if (observed.revision <= snapshot.revision) continue;
    const id = observed.context.id;
    contexts.set(id, observed.context);
    if (observed.settings.defaults.revision > settings.defaults.revision) settings.defaults = observed.settings.defaults;
    if (observed.settings.conversation) settings.conversations[id] = observed.settings.conversation;
    else delete settings.conversations[id];
  }
  return { ...snapshot, contexts: [...contexts.values()], sessionSettings: settings };
}
