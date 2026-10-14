import type { ConversationActionProps, DeviceNotification } from '@herts/plugin-api/client';

export interface PinMetadata {
  identities: string[];
  contextId?: string;
}
export type PinRecord = DeviceNotification<PinMetadata>;
export function identities({ context, conversation }: ConversationActionProps) {
  return [...new Set([context?.id, context?.link?.key, context?.link?.storedId, ...(context?.aliases || []), conversation.key, conversation.id, ...conversation.aliases].filter((id): id is string => !!id))];
}
export function matchingPin(rows: PinRecord[], ids: string[]) {
  return rows.find(row => row.metadata?.identities?.some(id => ids.includes(id)));
}
export function pinRoute(contextId?: string) {
  const route = location.hash.slice(1);
  if (['/new', '/share'].includes(route) && contextId) return `/draft/${encodeURIComponent(contextId)}`;
  return route;
}
