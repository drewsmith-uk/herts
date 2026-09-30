import type { History } from '../shared/core';

export function isHistory(value: unknown): value is History {
  if (!value || typeof value !== 'object') return false;
  const page = value as Partial<History>;
  return typeof page.sessionId === 'string' && !!page.sessionId &&
    Number.isInteger(page.offset) && page.offset! >= 0 && typeof page.hasMore === 'boolean' &&
    typeof page.fetchedAt === 'number' && Number.isFinite(page.fetchedAt) &&
    (page.order === undefined || page.order === 'latest' || page.order === 'oldest') &&
    Array.isArray(page.messages) && page.messages.every(message => message && typeof message === 'object' &&
      typeof message.role === 'string' && (message.id === undefined || typeof message.id === 'string' ||
        (typeof message.id === 'number' && Number.isFinite(message.id))));
}

export function readHistory(value: unknown): History {
  if (!isHistory(value)) throw new Error('Conversation history could not be loaded. Try refreshing it.');
  return value;
}
