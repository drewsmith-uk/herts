import type { ConversationContext } from '../shared/conversations';
import { createLocalConversation, getState, renameConversationTitle, useApp } from './data';
import { RenameAction } from './RenameAction';

export function ConversationTitle({ context }: { context: ConversationContext }) {
  const { online } = useApp();
  if (context.botChat) return null;
  return <RenameAction title={context.link?.title || context.title} label="Rename conversation" fieldLabel="Conversation title" maxLength={100} disabled={!!context.link && !online}
    save={async (title, base) => { if (!getState().snapshot.contexts.some(c => c.id === context.id)) await createLocalConversation(title, context.id); else await renameConversationTitle(context.id, title, base); }}/>;
}
