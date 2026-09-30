import type { ChatMessage } from './core';

// Hermes injects background results with role=user for the model. Presentation
// metadata identifies the author; matching text alone would hide pasted reports.
export function backgroundResultLabel(message: ChatMessage): string | undefined {
  if (message.display_kind === 'async_delegation_complete') return 'Background task result';
  if (message.display_kind === 'process_complete') return 'Background process result';
}
