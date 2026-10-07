import { useState } from 'react';
import type { ConversationContext } from '../shared/conversations';
import { createLocalConversation, getState, renameConversationTitle, useApp } from './data';
import { useUpdatePreparation, useUpdateWork } from './updateSafety';
import { cleanConversationTitle } from '../shared/conversationTitles';

export function ConversationTitle({ context }: { context: ConversationContext }) {
  const { online } = useApp(), title = context.link?.title || context.title;
  const [draft, setDraft] = useState<{ text: string; baseTitle: string } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const saving = useUpdateWork();
  useUpdatePreparation({ blocked: () => draft || busy ? 'Save the conversation title before updating.' : undefined });
  async function save() {
    if (!draft || busy) return;
    const next = cleanConversationTitle(draft.text);
    if (!next || next === draft.baseTitle) { setDraft(null); setError(''); return; }
    setBusy(true); setError('');
    try { if (!getState().snapshot.contexts.some(c => c.id === context.id)) await createLocalConversation(next, context.id); else await renameConversationTitle(context.id, next, draft.baseTitle); setDraft(null); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  if (context.botChat) return <div className="conversation-title-editor"><h1>{context.title}</h1><p>Permanent Bot Chat. Edit the bot’s title in Bots.</p></div>;
  return <div className="conversation-title-editor"><textarea className="detail-title" rows={2} aria-label="Conversation title" maxLength={100}
    value={draft?.text ?? title} disabled={busy || (!!context.link && !online)}
    onChange={event => setDraft(previous => ({ text: event.target.value, baseTitle: previous?.baseTitle ?? title }))}
    onBlur={() => { void saving(save()); }}/>{error && <p role="alert" className="inline-error">{error}</p>}</div>;
}
