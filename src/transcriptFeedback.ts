import { messageText, type Action, type History } from '../shared/core';
import { backgroundResultLabel } from '../shared/messagePresentation';
import { isHistory } from './historyCache';

export interface HistoryBaseline { sessionId: string; ids: (string | number)[] }
export interface OutgoingMessage { id: string; taskId: string; text: string; uploadIds: string[]; at: number; baseline?: HistoryBaseline }

export function historyBaseline(saved: unknown): HistoryBaseline | undefined {
  // A missing/broken cache is not proof that the conversation was empty.
  // Fall back to timestamps when checking whether a new message has appeared.
  if (!isHistory(saved)) return undefined;
  return { sessionId: saved.sessionId, ids: saved.messages.flatMap(message => message.id === undefined ? [] : [message.id]) };
}

export function outgoingInHistory(outgoing: OutgoingMessage, pages: History[]): boolean {
  return pages.some(page => page.messages.some(message => {
    if (message.role !== 'user' || backgroundResultLabel(message)) return false;
    const text = messageText(message).trim(), submitted = outgoing.text.trim();
    if (text !== submitted && !(outgoing.uploadIds.length && text.startsWith(submitted) && text.slice(submitted.length).trimStart().startsWith('@file:'))) return false;
    // A repeated instruction must not match an older, identical user message.
    if (outgoing.baseline && (!outgoing.baseline.sessionId || page.sessionId === outgoing.baseline.sessionId) && message.id !== undefined) {
      if (outgoing.baseline.ids.includes(message.id)) return false;
      // Loading an older page can reveal identical messages outside the saved
      // window. Hermes's numeric row IDs must advance beyond that window.
      const ids = outgoing.baseline.ids.filter((id): id is number => typeof id === 'number');
      if (typeof message.id === 'number' && ids.length) return message.id > Math.max(...ids);
      if (!outgoing.baseline.ids.length) return true;
    }
    const raw = message.timestamp ?? message.created_at;
    const value = typeof raw === 'string' && !Number.isFinite(Number(raw)) ? Date.parse(raw) : Number(raw);
    const timestamp = value < 1e12 ? value * 1000 : value;
    return Number.isFinite(timestamp) && timestamp >= outgoing.at - 1000;
  }));
}

export function outgoingStatus(action?: Action): string {
  if (!action) return 'Awaiting submission confirmation';
  if (action.sendStage === 'preparing') return action.receipt === 'pending' ? 'Saved · preparing conversation' : 'Not sent';
  if (action.receipt === 'unknown') return 'Submission unconfirmed';
  if (action.receipt === 'rejected') return 'Not sent';
  if (action.receipt === 'accepted') return action.awaitingTurn ? 'Queued for Hermes' : 'Sent to Hermes';
  return 'Sending to Hermes';
}

/** Replace a partial durable reply in place instead of showing it twice while streaming. */
export function liveReplyReplacement(pages: History[], liveText: string | undefined, outgoing?: OutgoingMessage): string | undefined {
  if (!liveText || !outgoing || !outgoingInHistory(outgoing, pages)) return;
  const entries = pages.flatMap(page => page.messages.map(message => ({ page, message })));
  const lastUser = entries.findLastIndex(({ message }) => message.role === 'user' && !backgroundResultLabel(message));
  const user = entries[lastUser]?.message;
  if (!user || messageText(user).trim() !== outgoing.text.trim()) return;
  const reply = entries.slice(lastUser + 1).findLast(({ message }) => message.role === 'assistant' && !!messageText(message).trim());
  if (reply?.message.id !== undefined && liveText.trim().startsWith(messageText(reply.message).trim())) return `${reply.page.sessionId}:${reply.message.id}`;
}
