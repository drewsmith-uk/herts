import { useState, type FormEvent } from 'react';
import { NotebookPen } from 'lucide-react';
import { Button, ConversationHeader, EmptyState, FormField, ItemList, ItemRow, PageHeader, StatusMessage } from '@herts/plugin-api/client';
const pluginName = 'Notes';
import { ConversationPanel, mutatePlugin, useCore, usePluginRecords, type ClientPlugin, type ConversationActionProps, type RouteProps, } from '@herts/plugin-api/client';
type Note = {
    id: string;
    title: string;
    contextId: string;
};
function Notes({ parts }: RouteProps) {
    const core = useCore();
    const records = usePluginRecords<Record<string, Note>>('notes');
    const notes = Object.entries(records).filter(([key]) => key.startsWith('note:')).map(([, note]) => note);
    const note = notes.find(note => note.id === parts[2]);
    const [title, setTitle] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    async function save(event: FormEvent) {
        event.preventDefault();
        if (busy) return;
        setBusy(true); setError('');
        try {
            const id = crypto.randomUUID();
            await mutatePlugin('notes', 'save', { id, title }, id);
            setTitle('');
            location.hash = `/plugins/notes/${id}`;
        }
        catch (error) {
            setError((error as Error).message);
        } finally { setBusy(false); }
    }
    if (note) {
        const context = core.snapshot.contexts.find(context => context.id === note.contextId)
            || { id: note.contextId, title: note.title, link: null, aliases: [] };
        return <div className="conversation-detail"><ConversationHeader title={note.title} backHref="#/plugins/notes" backLabel={pluginName} context={context}><h1>{note.title}</h1></ConversationHeader><ConversationPanel context={context} showHeading={false} showActions={false}/></div>;
    }
    return <>
      <PageHeader title={pluginName} count={notes.length}/>
      <form onSubmit={save}>
        <FormField label="New note"><input required maxLength={2000} disabled={busy} value={title} onChange={event => setTitle(event.target.value)}/></FormField>
        <Button type="submit" variant="primary" disabled={busy || !title.trim()}>{busy ? 'Saving…' : 'Save note'}</Button>
      </form>
      {error && <StatusMessage>{error}</StatusMessage>}
      <ItemList>{notes.map(note => <ItemRow key={note.id} href={`#/plugins/notes/${note.id}`}><h2 className="item-title">{note.title}</h2></ItemRow>)}</ItemList>
      {!notes.length && <EmptyState icon={<NotebookPen/>} title="No notes yet" description="Save a note to start a conversation."/>}
    </>;

}
function SaveConversation({ conversation, context }: ConversationActionProps) {
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    async function save() {
        if (busy) return;
        setBusy(true); setError('');
        try {
            const id = crypto.randomUUID();
            await mutatePlugin('notes', 'save', { id, title: conversation.title, conversationId: conversation.key });
            location.hash = `/plugins/notes/${id}`;
        }
        catch (error) {
            setError((error as Error).message);
        } finally { setBusy(false); }
    }
    if (context && !context.link)
        return null;
    return <><Button disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save as note'}</Button>{error && <StatusMessage>{error}</StatusMessage>}</>;
}
export default function activate(): ClientPlugin {
    if (!PageHeader) throw new Error('Update Herts in Settings → App updates to use this plugin.');
    return {
        tab: { title: 'Notes', path: '/plugins/notes' },
        routes: [{ match: path => path === '/plugins/notes' || path.startsWith('/plugins/notes/'), component: Notes }],
        ConversationActions: SaveConversation,
        reduce(records, operation) {
            const input = operation.input as {
                id: string;
                title: string;
                conversationId?: string;
            };
            if (input.conversationId)
                return records; // The server resolves the canonical identity.
            return { ...records, [`note:${input.id}`]: { id: input.id, title: input.title, contextId: input.id } };
        },
    };
}
