import { useState, type FormEvent } from 'react';
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
    const [error, setError] = useState('');
    async function save(event: FormEvent) {
        event.preventDefault();
        try {
            const id = crypto.randomUUID();
            await mutatePlugin('notes', 'save', { id, title }, id);
            setTitle('');
            location.hash = `/plugins/notes/${id}`;
        }
        catch (error) {
            setError((error as Error).message);
        }
    }
    if (note) {
        const context = core.snapshot.contexts.find(context => context.id === note.contextId)
            || { id: note.contextId, title: note.title, link: null, aliases: [] };
        return <><a href="#/plugins/notes">Notes</a><h1>{note.title}</h1><ConversationPanel context={context}/></>;
    }
    return <>
    <h1>Notes</h1>
    <form onSubmit={save}>
      <label>New note<input value={title} onChange={event => setTitle(event.target.value)}/></label>
      <button disabled={!title.trim()}>Save note</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {notes.map(note => <p key={note.id}><a href={`#/plugins/notes/${note.id}`}>{note.title}</a></p>)}
  </>;
}
function SaveConversation({ conversation, context }: ConversationActionProps) {
    const [error, setError] = useState('');
    async function save() {
        try {
            const id = crypto.randomUUID();
            await mutatePlugin('notes', 'save', { id, title: conversation.title, conversationId: conversation.key });
            location.hash = `/plugins/notes/${id}`;
        }
        catch (error) {
            setError((error as Error).message);
        }
    }
    if (context && !context.link)
        return null;
    return <><button onClick={() => void save()}>Save as note</button>{error && <span role="alert">{error}</span>}</>;
}
export default function activate(): ClientPlugin {
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
