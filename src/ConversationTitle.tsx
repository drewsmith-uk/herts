import type { ConversationContext } from '../shared/conversations';
import { createLocalConversation, getState, renameConversationTitle, useApp } from './data';
import { RenameAction } from './RenameAction';
import { cleanConversationTitle } from '../shared/conversationTitles';

export function ConversationTitle({ context }: { context: ConversationContext }) {
  const { online } = useApp();
  if (context.botChat) return null;
  return <RenameAction title={context.link?.title || context.title} label="Rename conversation" fieldLabel="Conversation title" maxLength={100} disabled={!!context.link && !online}
    save={async (title, base) => {
      const next = cleanConversationTitle(title);
      if (!next || next === base) return;
      if (!getState().snapshot.contexts.some(c => c.id === context.id)) await createLocalConversation(next, context.id);
      else await renameConversationTitle(context.id, next, base);
    }}/>;
}
