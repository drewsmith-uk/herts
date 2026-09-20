import { useEffect, useRef, useState } from 'react';
import { Search, X, MessageSquare, LoaderCircle, Plus, ChevronLeft, Eye, EyeOff } from 'lucide-react';
import { db, useApp, cacheRead, api, setConversationHidden, contextForConversation, openConversation, createLocalConversation } from './data';
import { conversationHidden, messageText, type Conversation } from '../shared/core';
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
    const [query, setQuery] = useState(''), [includeHidden, setIncludeHidden] = useState(false), [filters, setFilters] = useState<Record<string, boolean>>({}), [rows, setRows] = useState<Conversation[]>([]), [offset, setOffset] = useState(0), [more, setMore] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [cached, setCached] = useState(false), [notice, setNotice] = useState<{
        text: string;
        route?: string;
        undo?: Conversation;
    }>(), [working, setWorking] = useState(''), [chooser, setChooser] = useState<Conversation>(), [draftIds, setDraftIds] = useState<string[]>([]);
    const filterPlugins = plugins.filter(p => p.definition.filter), swipes = plugins.filter(p => p.definition.swipe);
    const filterKey = JSON.stringify(filters), listVersion = JSON.stringify([state.snapshot.hiddenConversations, state.plugins.revision, ...plugins.map(p => state.pluginData[p.id]?.revision), state.pluginPending.map(p => p.id)]);
    useEffect(() => { setOffset(0); setRows([]); }, [query, includeHidden, filterKey]);
    useEffect(() => {
        let alive = true;
        setBusy(true);
        const timer = setTimeout(() => {
            const activeFilters = filterPlugins.filter(p => !filters[p.id]).map(p => `${p.id}:${p.definition.filter!.id}`).join(',');
            void Promise.all(Array.from({ length: offset / 50 + 1 }, (_, i) => cacheRead(`conversations:plugins:${activeFilters}:${includeHidden}:${query}:${i * 50}`, () => api(`/conversations?q=${encodeURIComponent(query)}&offset=${i * 50}&includeLinked=true&includeHidden=${includeHidden}&filters=${encodeURIComponent(activeFilters)}`).then(value => ({ ...value, query }))))).then(async (pages) => {
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
        return () => { alive = false; clearTimeout(timer); };
    }, [query, offset, includeHidden, filterKey, listVersion]);
    async function hide(c: Conversation) { setWorking(c.key); setError(''); try {
        await setConversationHidden(c, !c.hidden);
        setNotice({ text: c.hidden ? 'Conversation unhidden.' : 'Conversation hidden.', undo: c.hidden ? undefined : c });
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setWorking('');
    } }
    async function swipe(c: Conversation, plugin = swipes[0]) { if (!plugin)
        return; if (swipes.length > 1 && !chooser) {
        setChooser(c);
        return;
    } setChooser(undefined); setWorking(c.key); try {
        const result = await plugin.definition.swipe!.run(c);
        if (result)
            setNotice(result);
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setWorking('');
    } }
    const visible = rows.map(c => ({ ...c, hidden: conversationHidden(c, state.snapshot.hiddenConversations || []) })).filter(c => (includeHidden || !c.hidden) && filterPlugins.every(p => filters[p.id] || pluginHook(p, () => p.definition.filter!.visible(c, state.pluginData[p.id]?.records || {}, state.snapshot.contexts), true)));
    useEffect(() => { void db.kv.where('key').startsWith('context-draft:').toArray().then(rows => setDraftIds(rows.map(r => r.key.slice('context-draft:'.length)))); }, [state.snapshot.contexts.length]);
    const drafts = state.snapshot.contexts.filter(c => !c.link && (draftIds.includes(c.id) || state.actions.some(a => !a.cancelled && a.taskId === c.id)));
    return <><div className="page-heading"><div><div className="eyebrow">HERMES CONVERSATIONS</div><h1>Conversations</h1><p>Read, start and continue your personal Hermes conversations.</p></div><a className="primary-button" href="#/new"><Plus size={16}/> New conversation</a></div>
    <div className="search-field"><Search size={19}/><input aria-label="Search conversations" placeholder="Search conversations…" value={query} onChange={e => setQuery(e.target.value)}/>{query && <button className="icon-button" aria-label="Clear search" onClick={() => setQuery('')}><X size={16}/></button>}</div>
    <div className="conversation-filters">{filterPlugins.map(p => <label className="conversation-filter" key={p.id}><input type="checkbox" checked={!!filters[p.id]} onChange={e => setFilters({ ...filters, [p.id]: e.target.checked })}/>{p.definition.filter!.label}</label>)}<label className="conversation-filter"><input type="checkbox" checked={includeHidden} onChange={e => setIncludeHidden(e.target.checked)}/>Show hidden items</label></div>
    <p className="conversation-gesture-hint">{swipes.length ? 'Swipe right for conversation actions, left to hide.' : 'Swipe left to hide.'}</p>
    {notice && <div className="conversation-notice" role="status"><span>{notice.text}</span>{notice.route && <a href={`#${notice.route}`}>Open</a>}{notice.undo && <button onClick={() => void hide({ ...notice.undo!, hidden: true })}>Undo</button>}</div>}
    {error && <p role="alert" className="error-banner">{error}</p>}{cached && <div><span className="eyebrow">SAVED ON THIS DEVICE</span><p>Offline results cover conversations previously viewed on this device.</p></div>}
    <div className="conversation-list">{visible.map(c => <ConversationRow key={c.key} conversation={c} badges={<ConversationBadges conversation={c}/>} canActOffline={swipes.some(p=>pluginHook(p,()=>p.definition.swipe?.canRunOffline?.(c)||false,false))} updatedAt={time(c.updatedAt)} online={state.online} busy={working === c.key} actionLabel={swipes.length === 1 ? pluginHook(swipes[0], () => swipes[0].definition.swipe!.label(c), 'Actions') : swipes.length ? 'Actions' : undefined} onAction={kind => kind === 'visibility' ? hide(c) : swipe(c)}/>)}</div>
    {busy && <p className="loading"><LoaderCircle className="spin" size={17}/> Loading conversations…</p>}{!busy && !visible.length && !error && <div className="empty"><MessageSquare size={30}/><h2>No conversations found</h2><p>{query ? 'Try a different search.' : 'Your personal Hermes conversations will appear here.'}</p>{filterPlugins.filter(p=>!filters[p.id]&&p.definition.filter?.hiddenMessage&&rows.some(c=>!pluginHook(p,()=>p.definition.filter!.visible(c,state.pluginData[p.id]?.records||{},state.snapshot.contexts),true))).map(p=><p key={p.id}>{p.definition.filter!.hiddenMessage}</p>)}</div>}{more && !busy && <button className="load-more" onClick={() => setOffset(offset + 50)}>Load more conversations</button>}
    {drafts.length > 0 && <div className="conversation-drafts"><h2>Saved conversation drafts</h2>{drafts.map(c => <p key={c.id}><a href={`#/draft/${c.id}`}>{c.title}</a></p>)}</div>}
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
        setError(e.message); }); return () => { alive = false; }; }, [id, !!context, state.online, attempt]);
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
    return <div className="conversation-detail"><ConversationHeader><a className="back-link" href="#/conversations"><ChevronLeft size={17}/> Conversations</a><div className="page-heading conversation-detail-heading">{context ? <ConversationTitle context={context}/> : <h1>{current.title}</h1>}</div><div className="conversation-header-actions"><ConversationContributions context={context} conversation={current}/><button disabled={busy} onClick={() => void hide()}>{hidden ? <Eye size={16}/> : <EyeOff size={16}/>} {hidden ? 'Unhide conversation' : 'Hide conversation'}</button></div></ConversationHeader>
    {context ? <ConversationPanel key={context.id} context={context} showActions={false}/> : <><HistoryView conversationId={id}/><p role="status">{state.online ? error || 'Opening conversation…' : 'Connect once to enable messaging for this conversation.'}</p>{state.online && error && <button onClick={() => setAttempt(n => n + 1)}>Try again</button>}</>}{context && error && <p role="alert">{error}</p>}</div>;
}
export function NewConversation({ id, shared }: {
    id?: string;
    shared?: SharedContent;
}) {
    const state = useApp(), [draftId] = useState(() => id || crypto.randomUUID()), [error, setError] = useState('');
    const context = state.snapshot.contexts.find(c => c.id === draftId);
    useEffect(() => { if (context)
        return; let active = true; void createLocalConversation(shared?.title || 'New conversation', draftId).then(async () => { if (shared)
        await db.drafts.put({ id: draftId, text: [shared.text, shared.url].filter((v, i, a) => v && a.indexOf(v) === i).join('\n'), files: [] }); if (active) { history.replaceState(null, '', `/#/draft/${draftId}`); dispatchEvent(new PopStateEvent('popstate')); } }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [draftId]);
    return <div className="conversation-detail"><ConversationHeader><a href="#/conversations" className="back-link"><ChevronLeft size={17}/> Conversations</a>{context ? <ConversationTitle context={context}/> : <h1>New conversation</h1>}</ConversationHeader>{context && <ConversationPanel context={context}/>} {error && <p role="alert">{error}</p>}</div>;
}
