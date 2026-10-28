import { hasSavedMessage, type Action } from './core.js';

export const retainRecoveryDetail = (action: Action) => hasSavedMessage(action) ||
  ['pending', 'unknown'].includes(action.receipt) || ['preparing', 'running', 'awaiting_input', 'stopping', 'unknown'].includes(action.state) ||
  !!action.settings?.inFlight;

export type ActionSummary = Pick<Action, 'id' | 'kind' | 'state' | 'receipt' | 'phase' | 'createdAt' | 'updatedAt'>;
export interface ActivitySummary {
  contextId: string;
  version: number;
  main?: ActionSummary;
  latestSend?: ActionSummary;
  hasSubmission: boolean;
  recoveryCount: number;
  pendingRecovery: boolean;
}
export interface ActivityChange {
  summary: ActivitySummary;
  retired: string[];
}
export interface ActivityPage {
  generation: string;
  cursor: string;
  changes: ActivityChange[];
  rebase: boolean;
  complete: boolean;
  hasMore: boolean;
}
export interface ActivityDetails {
  generation: string;
  summary: ActivitySummary;
  actions: Action[];
  cursor: string | null;
  scope: string[];
}
