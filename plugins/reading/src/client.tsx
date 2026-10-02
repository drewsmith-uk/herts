import { BookOpen } from 'lucide-react';
import { PageHeader, MessageComposer, type ClientPlugin, type RouteProps, type ConversationActionProps } from '@herts/plugin-api/client';
import { ReadingList, ReadingCapture, ReadingDetail, Reader, BookmarkLink, ReadingSettings } from './Reading';
import { applyReadingOp, emptyReading, conversationReadingItems, type ReadingState, type ReadingOp } from './model';
import { useApp, resolveReadingConflict, startReading, db } from './data';
function ReadingBadge({ conversation }: ConversationActionProps) {
    const { snapshot } = useApp();
    const count = conversationReadingItems(conversation, snapshot.reading, snapshot.contexts).length;
    return count ? <span><BookOpen size={12}/>Reading · {count} {count === 1 ? 'item' : 'items'}</span> : null;
}
function Screen({ parts, path, shared }: RouteProps) { const [screen, id] = parts; return screen === 'reading-item' ? <ReadingDetail key={id} id={id}/> : screen === 'reader' ? <Reader key={id} id={id}/> : id === 'add' ? <ReadingCapture sharedContent={shared} id={parts[2]}/> : <ReadingList read={id === 'read'}/>; }
function Conflicts() { const state = useApp(); return <>{state.readingPending.filter(p => p.conflict).map(p => <div className="conflict-banner" key={p.op.id}><strong>A reading-list change needs your choice</strong><p>{p.conflict}</p>{p.op.kind === 'title' && <><p>Your title: {p.op.title}</p><p>Synced title: {state.remote.reading.items.find(i => i.id === p.op.itemId)?.title}</p></>}<div className="button-row"><button onClick={() => void resolveReadingConflict(p.op.id, true)}>Keep my change</button><button onClick={() => void resolveReadingConflict(p.op.id, false)}>Use synced version</button></div></div>)}</>; }
export default function activate(): ClientPlugin {
    if (!PageHeader || !MessageComposer) throw new Error('Update Herts in Settings → App updates to use this version of Reading.');
    return {
        tab: { title: 'Reading', path: '/reading', icon: BookOpen }, routes: [{ match: path => /^\/(reading|reading-item|reader)(\/|$)/.test(path), component: Screen }],
        Settings: ReadingSettings, Conflicts, MessageLink: BookmarkLink, ConversationBadge: ReadingBadge,
        filter: { id: 'linked', label: 'Show linked conversations', visible: (conversation, records, contexts) => !conversationReadingItems(conversation, (records.state || emptyReading()) as ReadingState, contexts).length },
        shares: [{ id: 'link', title: 'Reading', accepts: c => /https?:\/\//i.test(`${c.url} ${c.text} ${c.title}`), path: '/reading/add' }],
        reduce(records, operation) { return { ...records, state: applyReadingOp((records.state || emptyReading()) as ReadingState, operation.input as ReadingOp, false) }; },
        async reconcile(result, operation) { const op = operation.input as ReadingOp; if (result.itemId && result.itemId !== op.itemId)
            await db.kv.put({ key: `reading-alias:${op.itemId}`, value: result.itemId }); },
        start: startReading,
    };
}
