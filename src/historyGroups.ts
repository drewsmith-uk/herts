import { messageText, type ChatMessage, type History } from '../shared/model';
import { mediaRefs } from '../shared/media';

export interface HistoryEntry { key: string; message: ChatMessage; page: History; index: number }
export type HistoryGroup = { kind: 'message'; key: string; entry: HistoryEntry } | { kind: 'activity'; key: string; entries: HistoryEntry[]; calls: number };

// Keep page coordinates for media and read-aloud, but group across page boundaries.
export function groupHistory(pages: History[], previous: HistoryGroup[] = []): HistoryGroup[] {
  const priorKeys = new Map(previous.flatMap(group => group.kind === 'activity' ? group.entries.map(entry => [entry.key, group.key] as const) : []));
  const groups: HistoryGroup[] = [], usedKeys = new Set<string>();
  let activity: HistoryEntry[] = [];
  function flush() {
    if (!activity.length) return;
    // Keep the disclosure open when either older pages or new tool rounds extend it.
    let key = activity.map(entry => priorKeys.get(entry.key)).find(key => key && !usedKeys.has(key)) || `activity:${activity.at(-1)!.key}`;
    if (usedKeys.has(key)) key += `:segment:${activity[0].key}`;
    usedKeys.add(key);
    groups.push({ kind: 'activity', key, entries: activity, calls: activity.reduce((n, entry) => n + (entry.message.tool_calls?.length || 0), 0) });
    activity = [];
  }
  for (const page of pages) for (const [index, message] of page.messages.entries()) {
    const entry = { key: `${page.sessionId}:${message.id ?? `${page.offset}:${index}`}`, message, page, index };
    const hasContent = !!messageText(message).trim() || mediaRefs(message).length > 0;
    if (message.role === 'tool' || (message.role === 'assistant' && !hasContent && !!message.tool_calls?.length)) {
      activity.push(entry);
    } else {
      if (hasContent || message.role === 'user') flush();
      if (hasContent) groups.push({ kind: 'message', key: entry.key, entry });
    }
  }
  flush();
  return groups;
}
