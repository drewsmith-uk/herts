import { PageHeader, Button, ButtonLink, DialogFrame, ItemList, ItemRow, ItemMeta, EmptyState, StatusMessage } from './ui';
import { useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { Search, X, MessageSquare, LoaderCircle, Plus, Trash2, Eye, EyeOff } from 'lucide-react';
import { db, useApp, cacheRead, api, setConversationHidden, contextForConversation, openConversation, createLocalConversation, deleteConversationDraft, saveConversationDraft, type Draft } from './data';
import { conversationHidden, messageText, type Conversation } from '../shared/core';
import { MessageComposer } from './MessageComposer';
import { useListState } from './listState';
import { useEntryDraft } from './entryDraft';
import { ConversationPanel, HistoryView } from './Conversation';
import { ConversationHeader } from './ConversationHeader';
import { ConversationTitle } from './ConversationTitle';
import { ConversationRow } from './ConversationRow';
import { ConversationContributions, ConversationBadges, usePlugins, pluginHook } from './plugins';
import type { SharedContent } from '../shared/plugins';
const time = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
async function savedConversations(query: string, known: Conversation[] = []) { const entries = await db.kv.toArray(), lists = entries.filter(r => r.key.startsWith('conversations:')); const matches = new Set(known.map(c => c.key)); const all = [...new Map(lists.flatMap(r => r.value.conversations || []).map((c: Conversation) => [c.key, c])).values()] as Conversation[]; return all.filter(c => matches.has(c.key) || `${c.title} ${c.preview} ${entries.filter(e => c.aliases.some(id => e.key.startsWith(`history:${id}:`))).flatMap(e => e.value.messages || []).map(messageText).join(' ')}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.updatedAt - a.updatedAt); }
export function Conversations() {
    const state = useApp(), plugins = usePlugins();
    const [showAll, setShowAll] = useListState('conversations:all', false);
    const [retry, setRetry] = useState(0);
    const [actionError, setActionError] = useState('');
    const [query, setQuery] = useListState('conversations:query', ''), [rows, setRows] = useState<Conversation[]>([]), [offset, setOffset] = useListState('conversations:offset', 0), [more, setMore] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [cached, setCached] = useState(false), [notice, setNotice] = useState<{
        text: string;
        route?: string;
        undo?: Conversation;
    }>(), [working, setWorking] = useState(''), [chooser, setChooser] = useState<Conversation>();
    const [savedDrafts, setSavedDrafts] = useState<{ ids: string[]; deleted: string[]; messages: Draft[]; routes: Record<string, string>; recordings: string[] }>({ ids: [], deleted: [], messages: [], routes: {}, recordings: [] });
    const [draftError, setDraftError] = useState(''), [showAllDrafts, setShowAllDrafts] = useState(false);
    const [deletingDraft, setDeletingDraft] = useState<{ id: string; title: string }>(), [deleting, setDeleting] = useState(false), [deleteError, setDeleteError] = useState(''), [draftNotice, setDraftNotice] = useState('');
    async function removeDraft() {
        if (!deletingDraft || deleting) return;
        setDeleting(true); setDeleteError('');
        try {
            await deleteConversationDraft(deletingDraft.id);
            setDeletingDraft(undefined); setDraftNotice('Draft deleted from this device.');
            requestAnimationFrame(() => (document.querySelector<HTMLElement>('.conversation-drafts .draft-open') || document.querySelector<HTMLElement>('a[href="#/new"]'))?.focus());
        } catch (e) { setDeleteError((e as Error).message); }
        finally { setDeleting(false); }
    }
    const filterPlugins = plugins.filter(p => p.definition.filter), swipes = plugins.filter(p => p.definition.swipe);
    const activeFilterPlugins = showAll ? [] : filterPlugins;
    const filterKey = activeFilterPlugins.map(p => `${p.id}:${p.definition.filter!.id}`).join(','), listVersion = JSON.stringify([state.snapshot.hiddenConversations, state.plugins.revision, ...plugins.map(p => state.pluginData[p.id]?.revision), state.pluginPending.map(p => p.id)]);
    const previousFilter = useRef([query, showAll, filterKey].join(':'));
    useEffect(() => { const key = [query, showAll, filterKey].join(':'); if (previousFilter.current !== key) { setOffset(0); setRows([]); previousFilter.current = key; } }, [query, showAll, filterKey]);
    useEffect(() => {
        let alive = true;
        const controller = new AbortController();
        setBusy(true);
        const timer = setTimeout(() => {
            const activeFilters = filterKey;
            void Promise.all(Array.from({ length: offset / 50 + 1 }, (_, i) => cacheRead(`conversations:plugins:${activeFilters}:${showAll}:${query}:${i * 50}`, () => api(`/conversations?q=${encodeURIComponent(query)}&offset=${i * 50}&includeLinked=true&includeHidden=${showAll}&filters=${encodeURIComponent(activeFilters)}`, undefined, 'GET', 45000, controller.signal).then(value => ({ ...value, query }))))).then(async (pages) => {
                const offline = pages.some(p => p.cached), next = pages.flatMap(p => p.value.conversations) as Conversation[];
                const found = offline ? await savedConversations(query, next) : next;
                if (alive) {
                    setRows(found);
                    setCached(offline);
                    setMore(!offline && pages.at(-1)!.value.hasMore);
                    setError('');
                }
            }).catch(async (e) => { const saved = await savedConversations(query); if (alive) {
                setRows(saved);
                setCached(true);
                setMore(false);
                if (!saved.length)
                    setError(e.message);
            } }).finally(() => { if (alive)
                setBusy(false); });
        }, 250);
        return () => { alive = false; controller.abort(); clearTimeout(timer); };
    }, [query, offset, showAll, filterKey, listVersion, state.connectionVersion, retry]);
    useEffect(() => {
        if (busy || (!cached && !error) || !state.online) return;
        const timer = setInterval(() => { if (!document.hidden && navigator.onLine) setRetry(n => n + 1); }, 8000);
        return () => clearInterval(timer);
    }, [busy, cached, error, state.online]);
    async function hide(c: Conversation) { setWorking(c.key); setActionError(''); try {
        await setConversationHidden(c, !c.hidden);
        setNotice({ text: c.hidden ? 'Conversation unhidden.' : 'Conversation hidden.', undo: c.hidden ? undefined : c });
    }
    catch (e) {
        setActionError((e as Error).message);
    }
    finally {
        setWorking('');
    } }
    async function swipe(c: Conversation, plugin = swipes[0]) { if (!plugin)
        return; if (swipes.length > 1 && !chooser) {
        setChooser(c);
        return;
    } setChooser(undefined); setWorking(c.key); setActionError(''); try {
        const result = await plugin.definition.swipe!.run(c);
        if (result)
            setNotice(result);
    }
    catch (e) {
        setActionError((e as Error).message);
    }
    finally {
        setWorking('');
    } }
    const visible = rows.map(c => ({ ...c, hidden: conversationHidden(c, state.snapshot.hiddenConversations || []) })).filter(c => (showAll || !c.hidden) && activeFilterPlugins.every(p => pluginHook(p, () => p.definition.filter!.visible(c, state.pluginData[p.id]?.records || {}, state.snapshot.contexts), true)));
    useEffect(() => {
        const subscription = liveQuery(async () => ({
            ids: (await db.kv.where('key').startsWith('context-draft:').primaryKeys()).map(key => key.slice('context-draft:'.length)),
            deleted: (await db.kv.where('key').startsWith('context-draft-deleted:').primaryKeys()).map(key => key.slice('context-draft-deleted:'.length)),
            messages: await db.drafts.toArray(),
            routes: Object.fromEntries((await db.kv.where('key').startsWith('entry-route:').toArray()).map(row => [row.key.slice('entry-route:'.length), row.value])),
            recordings: (await db.recordings.toArray()).map(row => row.owner),
        })).subscribe({ next: value => { setSavedDrafts(value); setDraftError(''); }, error: () => setDraftError('Saved drafts could not be loaded. Reload to try again.') });
        return () => subscription.unsubscribe();
    }, []);
    const messages = new Map(savedDrafts.messages.map(draft => [draft.id, draft]));
    const drafts = state.snapshot.contexts.filter(c => !c.link && !savedDrafts.deleted.includes(c.id) && (savedDrafts.ids.includes(c.id) || state.actions.some(a => !a.cancelled && a.taskId === c.id))).map(context => {
        const message = messages.get(context.id);
        const attempt = state.actions.filter(a => !a.cancelled && a.kind === 'send' && a.taskId === context.id).sort((a, b) => b.createdAt - a.createdAt)[0];
        const hasDraft = !!message?.text.trim() || !!message?.files.length;
        return { ...context, preview: hasDraft ? message!.text : attempt?.text || '', files: hasDraft ? message!.files.length : attempt?.uploadIds.length || 0 };
    }).filter(c => c.preview.trim() || c.files || savedDrafts.recordings.includes(`chat:${c.id}`) || savedDrafts.routes[c.id] || c.title !== 'New conversation' || state.actions.some(a => a.taskId === c.id && !a.cancelled));
    const draftQuery = query.trim().toLowerCase();
    const matchingDrafts = drafts.filter(c => `${c.title} ${c.preview}`.toLowerCase().includes(draftQuery));
    const displayedDrafts = showAllDrafts || draftQuery ? matchingDrafts : matchingDrafts.slice(0, 3);
    return <><PageHeader title="Conversations" actions={<ButtonLink variant="primary" href="#/new"><Plus size={16}/> New conversation</ButtonLink>}/>
    <div className="search-field"><Search size={19}/><input aria-label="Search conversations" placeholder="Search conversations…" value={query} onChange={e => setQuery(e.target.value)}/>{query && <button className="icon-button" aria-label="Clear search" onClick={() => setQuery('')}><X size={16}/></button>}</div>
    {draftError && <StatusMessage>{draftError}</StatusMessage>}
    {draftNotice && <StatusMessage tone="notice">{draftNotice}</StatusMessage>}
    {drafts.length > 0 && <section className="conversation-drafts" aria-labelledby="conversation-drafts-heading">
      <h2 id="conversation-drafts-heading">Drafts <span className="heading-count">{matchingDrafts.length}</span></h2>
      <ItemList id="conversation-drafts-list">{displayedDrafts.map(c => <ItemRow key={c.id} trailing={<Button variant="quiet" aria-label={`Delete draft: ${c.title}`} onClick={() => { setDeleteError(''); setDraftNotice(''); setDeletingDraft({ id: c.id, title: c.title }); }}><Trash2 size={16} aria-hidden="true"/> Delete</Button>}>
        <a className="draft-open" href={`#${savedDrafts.routes[c.id] || `/draft/${encodeURIComponent(c.id)}`}`}><h3 className="item-title">{c.title}</h3><p className="item-preview">{c.preview || (c.files ? `${c.files} attachment${c.files === 1 ? '' : 's'}` : 'No message yet')}</p>
        {!!c.files && !!c.preview && <ItemMeta><span>{c.files} attachment{c.files === 1 ? '' : 's'}</span></ItemMeta>}
        </a>
      </ItemRow>)}</ItemList>
      {!matchingDrafts.length && <p className="conversation-drafts-note">No drafts match this search.</p>}
      {!draftQuery && drafts.length > 3 && <Button variant="quiet" aria-expanded={showAllDrafts} aria-controls="conversation-drafts-list" onClick={() => setShowAllDrafts(value => !value)}>{showAllDrafts ? 'Show fewer drafts' : `Show all ${drafts.length} drafts`}</Button>}
    </section>}
    {deletingDraft && <DialogFrame aria-labelledby="delete-draft-heading" aria-describedby="delete-draft-description" busy={deleting} close={() => setDeletingDraft(undefined)}>
      <form onSubmit={event => { event.preventDefault(); void removeDraft(); }}>
        <h2 id="delete-draft-heading">Delete draft?</h2>
        <p id="delete-draft-description">Delete “{deletingDraft.title}” and its saved text and attachments from this device? This cannot be undone.</p>
        {deleteError && <StatusMessage>{deleteError}</StatusMessage>}
        <div className="button-row"><Button autoFocus disabled={deleting} onClick={() => setDeletingDraft(undefined)}>Cancel</Button><Button type="submit" variant="danger" disabled={deleting}>{deleting ? 'Deleting…' : 'Delete draft'}</Button></div>
      </form>
    </DialogFrame>}
    {drafts.length > 0 && <h2 className="conversation-list-heading">Hermes conversations</h2>}
    <div className="conversation-filters"><label className="conversation-filter"><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)}/>Show all</label></div>
    {notice && <StatusMessage tone="notice" className="conversation-notice"><span>{notice.text}</span>{notice.route && <a href={`#${notice.route}`}>Open</a>}{notice.undo && <button onClick={() => void hide({ ...notice.undo!, hidden: true })}>Undo</button>}</StatusMessage>}
    {actionError && <StatusMessage>{actionError}</StatusMessage>}{error && <StatusMessage>{error}</StatusMessage>}{cached && <div><span className="eyebrow">SAVED ON THIS DEVICE</span><p>Offline results cover conversations previously viewed on this device.</p></div>}
    <ItemList divided className="conversation-list">{visible.map(c => <ConversationRow key={c.key} conversation={c} badges={<ConversationBadges conversation={c}/>} canActOffline={swipes.some(p=>pluginHook(p,()=>p.definition.swipe?.canRunOffline?.(c)||false,false))} updatedAt={time(c.updatedAt)} online={state.online} busy={working === c.key} actionLabel={swipes.length === 1 ? pluginHook(swipes[0], () => swipes[0].definition.swipe!.label(c), 'Actions') : swipes.length ? 'Actions' : undefined} onAction={kind => kind === 'visibility' ? hide(c) : swipe(c)}/>)}</ItemList>
    {busy && <p className="loading"><LoaderCircle className="spin" size={17}/> Loading conversations…</p>}{!busy && !visible.length && !error && !actionError && <EmptyState icon={<MessageSquare size={30}/>} title={drafts.length ? 'No Hermes conversations found' : 'No conversations found'} description={query ? 'Try a different search.' : 'Your personal Hermes conversations will appear here.'}>{!showAll && <p>Turn on “Show all” to include linked and hidden conversations.</p>}</EmptyState>}{more && !busy && <button className="load-more" onClick={() => setOffset(offset + 50)}>Load more conversations</button>}
    {chooser && <div className="action-chooser" role="dialog" aria-label="Conversation actions">{swipes.map(p => <button key={p.id} onClick={() => void swipe(chooser, p)}>{pluginHook(p, () => p.definition.swipe!.label(chooser), 'Actions')}</button>)}<button onClick={() => setChooser(undefined)}>Cancel</button></div>}</>;
}
export function ConversationView({ id }: {
    id: string;
}) {
    const state = useApp(), [conversation, setConversation] = useState<Conversation>(), [error, setError] = useState(''), [attempt, setAttempt] = useState(0), [busy, setBusy] = useState(false);
    const context = contextForConversation(id, conversation ? [conversation.id, ...conversation.aliases] : []);
    useEffect(() => { let alive = true; void db.kv.toArray().then(rows => { const c = rows.filter(r => r.key.startsWith('conversations:')).flatMap(r => r.value.conversations || []).find(c => c.key === id || c.id === id || c.aliases.includes(id)); if (alive && c)
        setConversation(c); }); return () => { alive = false; }; }, [id]);
    useEffect(() => { if (context || !state.online)
        return; let alive = true; void openConversation(id).catch(e => { if (alive)
        setError(e.message); }); return () => { alive = false; }; }, [id, !!context, state.online, state.connectionVersion, attempt]);
    const current = { ...(conversation || { id: context?.link?.storedId || id, key: context?.link?.key || id, aliases: context?.aliases || [id], title: 'Conversation', preview: '', source: context?.link?.source || '', updatedAt: 0 }), ...(context ? { title: context.link?.title || context.title } : {}) };
    const hidden = conversationHidden(current, state.snapshot.hiddenConversations || []);
    async function hide() { setBusy(true); try {
        await setConversationHidden(current, !hidden);
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } }
    return <div className="conversation-detail"><ConversationHeader title={current.title} backHref="#/conversations" backLabel="Conversations" context={context} conversation={current}><div className="page-heading conversation-detail-heading">{context ? <ConversationTitle context={context}/> : <h1>{current.title}</h1>}</div><div className="conversation-header-actions"><button disabled={busy} onClick={() => void hide()}>{hidden ? <Eye size={16}/> : <EyeOff size={16}/>} {hidden ? 'Unhide conversation' : 'Hide conversation'}</button></div></ConversationHeader>
    <ConversationPanel context={context || { id, title: current.title, aliases: current.aliases, link: { ...current, storedId: id } }} readOnly={!context} showActions={false} showHeading={false}/>{!context && error && <p role="alert"><span>{error}</span> <button onClick={() => setAttempt(n => n + 1)}>Try again</button></p>}</div>;
}
export function NewConversation({ id, shared, initialId }: { id?: string; shared?: SharedContent; initialId?: string }) {
    const state = useApp(), [draftId] = useState(() => id || initialId || crypto.randomUUID());
    const entry = useEntryDraft({ key: shared ? `share:${JSON.stringify(shared)}` : 'new', id: shared ? undefined : draftId, route: draftId => `/draft/${draftId}`,
      initialText: shared ? [shared.text, shared.url].filter((v, i, a) => v && a.indexOf(v) === i).join('\n') || shared.title : undefined,
      initialFields: shared?.title ? { title: shared.title } : undefined });
    const [deleted, setDeleted] = useState(false);
    useEffect(() => { if (!id && !shared && entry.id && state.snapshot.contexts.some(c => c.id === entry.id)) { history.replaceState(history.state, '', `/#/draft/${entry.id}`); dispatchEvent(new PopStateEvent('popstate')); } }, [id, shared, entry.id, state.snapshot.contexts]);
    useEffect(() => { if (!entry.id) return; const sub = liveQuery(() => db.kv.get(`context-draft-deleted:${entry.id}`)).subscribe(row => setDeleted(!!row)); return () => sub.unsubscribe(); }, [entry.id]);
    if ((deleted && !entry.context.link) || (id && entry.id && state.loaded && !state.snapshot.contexts.some(c => c.id === id))) return <><PageHeader title="Draft unavailable" description="This draft was deleted from this device."/><ButtonLink href="#/conversations">Back to conversations</ButtonLink></>;
    return <div className="conversation-detail"><ConversationHeader title={entry.context.title} backHref="#/conversations" backLabel="Conversations" context={entry.id ? entry.context : undefined}>{entry.id && <ConversationTitle context={entry.context}/>}</ConversationHeader>
      {entry.id && (entry.context.link ? <ConversationPanel context={entry.context} showActions={false} showHeading={false}/> : <MessageComposer context={entry.context} persist={entry.persist} allowSaveEmpty={entry.context.title !== 'New conversation'} saveLabel="Save draft" onSaved={async () => { await entry.complete(); location.hash = '/conversations'; }} onSent={async () => { await entry.complete(); history.replaceState(null, '', `/#/draft/${entry.id}`); dispatchEvent(new PopStateEvent('popstate')); }}/>) }
      {entry.error && <p role="alert">{entry.error}</p>}
    </div>;
}
