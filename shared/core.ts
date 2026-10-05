export interface ConversationVisibilityOp { id: string; key: string; aliases: string[]; hidden: boolean; at: number }
export interface Conversation { id: string; key: string; title: string; preview: string; source: string; updatedAt: number; aliases: string[]; linkedTaskId?: string; hidden?: boolean; extensions?:Record<string,any> }
export function conversationHidden(conversation: Conversation, hiddenKeys: string[]): boolean {
  return [conversation.key, conversation.id, ...conversation.aliases].some(key => hiddenKeys.includes(key));
}
export function applyConversationVisibility(hiddenKeys: string[], op: ConversationVisibilityOp): string[] {
  const related = new Set([op.key, ...op.aliases]);
  const next = hiddenKeys.filter(key => !related.has(key));
  if (op.hidden) next.push(op.key);
  return next.sort();
}
export interface ChatMessage { id?: number | string; role: string; content?: string | unknown[]; text?: string; timestamp?: number; tool_calls?: unknown[]; display_kind?: string; [key: string]: unknown }
export type HistoryOrder = 'oldest' | 'latest';
export interface History { order?: HistoryOrder; sessionId: string; messages: ChatMessage[]; offset: number; hasMore: boolean; fetchedAt: number }
export type ActionState = 'preparing' | 'running' | 'awaiting_input' | 'stopping' | 'finished' | 'failed' | 'unknown' | 'ready';
export interface Approval { request_id: string; command?: string; description?: string; choices?: string[]; [key: string]: unknown }
export interface Binding { runtimeId: string; storedId: string; epoch: string; generation: string; seq: number; ready: boolean; monitored: boolean; known: boolean; unavailable?: boolean }
// taskId is the legacy wire/storage field for the canonical context ID. New
// requests use contextId; the server resolves legacy task IDs before dispatch.
export interface Action {
  id: string; taskId: string; contextId?: string; kind: 'send' | 'continue' | 'approve' | 'deny' | 'stop' | 'clarify';
  state: ActionState; phase: string; text: string; uploadIds: string[]; createdAt: number; updatedAt: number;
  receipt: 'pending' | 'accepted' | 'rejected' | 'unknown'; cancelled?: boolean; error?: string; errorCode?: number; binding?: Binding;
  approvalId?: string; targetId?: string; approvals?: Approval[]; clarification?: any; liveText?: string; terminal?: string;
  answers?: Record<string, string>; promptWarning?: string;
  savedMessageDeletedAt?: number;
  sendStage?: 'preparing' | 'submitting' | 'submitted'; turnStarted?: boolean; awaitingTurn?: boolean; cancelSend?: boolean;
  settings?: import('./sessionSettings').SendSettings;
  // Durable proof that this action created a new session, before any prompt.
  createdSession?: Pick<Binding, 'runtimeId' | 'storedId' | 'epoch'>;
}
export const savedMessageNotSent = (action: Action) => action.sendStage === 'preparing' || action.receipt === 'rejected';
export const canReconnectUnsentConversation = (actions: Action[]) => actions.length > 0 && actions.every(a =>
  a.kind === 'send' && a.sendStage === 'preparing' && ['failed', 'unknown'].includes(a.state) &&
  ['rejected', 'unknown'].includes(a.receipt) && !a.turnStarted && !a.terminal && !a.liveText);
export const hasSavedMessage = (action: Action) => action.kind === 'send' && !action.savedMessageDeletedAt &&
  (['failed', 'unknown'].includes(action.state) || ['rejected', 'unknown'].includes(action.receipt));
export function redactSavedMessage(action: Action): Action {
  if (!action.savedMessageDeletedAt) return action;
  const { answers: _answers, ...receipt } = action;
  return { ...receipt, text: '', uploadIds: [] };
}
export interface Upload { owner?:string; id: string; name: string; type: string; size: number; hash: string; complete: boolean }
export class Conflict extends Error { statusCode = 409; constructor(public reason: string) { super(reason); } }
export function messageText(m: ChatMessage): string {
  if (typeof m.display_content === 'string') return m.display_content;
  if (typeof m.content === 'string') return m.content;
  if (Array.isArray(m.content)) return m.content.map((p: any) => typeof p?.text === 'string' ? p.text : p?.type === 'image_url' ? '[Image attachment]' : '').filter(Boolean).join('\n');
  return typeof m.text === 'string' ? m.text : '';
}
