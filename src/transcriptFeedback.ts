import { messageText, type Action, type History } from '../shared/core';

export interface HistoryBaseline { sessionId: string; ids: (string | number)[] }
export interface OutgoingMessage { id: string; taskId: string; text: string; uploadIds: string[]; at: number; baseline?: HistoryBaseline }

export function outgoingInHistory(outgoing: OutgoingMessage, pages: History[]): boolean {
  return pages.some(page => page.messages.some(message => {
    if (message.role !== 'user') return false;
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
