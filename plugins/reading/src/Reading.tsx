import { MessageComposer, useEntryDraft, type Draft } from '@herts/plugin-api/client';
import { PageHeader, Button, ButtonLink, IconButton, SectionNav, SectionLink, ItemList, ItemRow, ItemMeta, EmptyState, StatusMessage, SettingsSection, SettingRow, FormField } from '@herts/plugin-api/client';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { BookOpen, Bookmark, BookmarkCheck, Plus, Check, Circle, ArrowUp, ArrowDown, Pencil, ChevronLeft, ExternalLink, Download, Trash2, LoaderCircle, Send } from 'lucide-react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { useHoldSensors, holdListeners, useDragClickGuard } from '@herts/plugin-api/client';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { emptyReading, normalizeUrl, sharedUrls, type ReadingItem, type Article } from './model';
import { useApp, addReading, readingChange, db, sync, publish, getArticle } from './data';
import { ConversationPanel } from '@herts/plugin-api/client';
import { ConversationHeader } from '@herts/plugin-api/client';
import { useDraftPersistence, useUpdatePreparation, useUpdateWork } from '@herts/plugin-api/client';
const navigate = (path: string) => { location.hash = path; };
const date = (at: number) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(at);
function useReadingAction() {
    const [error, setError] = useState('');
    const run = (action: () => Promise<unknown>) => { setError(''); void action().catch(e => setError(e.message)); };
    return { run, error };
}
export function ReadingList({ read }: {
    read: boolean;
}) {
    const state = useApp(), reading = state.snapshot.reading || emptyReading();
    const [edit, setEdit] = useState(false), { run, error } = useReadingAction();
    const items = read ? reading.items.filter(i => i.readAt !== null).sort((a, b) => b.readAt! - a.readAt! || a.id.localeCompare(b.id)) : reading.unread.ids.map(id => reading.items.find(i => i.id === id)!).filter(Boolean);
    const sensors = useHoldSensors(), clickGuard = useDragClickGuard();
    function drag({ active, over }: DragEndEvent) {
        clickGuard.end();
        if (read || !over || active.id === over.id)
            return;
        const from = items.findIndex(i => i.id === active.id), to = items.findIndex(i => i.id === over.id);
        run(() => readingChange(String(active.id), { kind: 'reorder', beforeId: from < to ? items[to + 1]?.id || null : String(over.id) }));
    }
    return <><PageHeader title="Reading list" count={items.length} actions={(items.length > 0 || edit) && <Button variant="quiet" className={edit ? 'selected' : ''} onClick={() => setEdit(!edit)}><Pencil size={15}/>{edit ? 'Finish editing' : 'Edit list'}</Button>}/>
    <div className="reading-toolbar"><SectionNav className="reading-tabs" aria-label="Reading lists"><SectionLink href="#/reading" active={!read}>Unread <small>{reading.unread.ids.length}</small></SectionLink><SectionLink href="#/reading/read" active={read}>Read <small>{reading.items.length - reading.unread.ids.length}</small></SectionLink></SectionNav><ButtonLink variant="primary" className="reading-add" href="#/reading/add"><Plus size={17}/> Add link</ButtonLink></div>
    {error && <StatusMessage>{error}</StatusMessage>}
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={drag} onDragStart={clickGuard.start} onDragCancel={clickGuard.end}><SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}><ItemList className="task-list">{items.map((item, index) => <ReadingRow key={item.id} item={item} index={index} items={items} edit={edit}/>)}</ItemList></SortableContext></DndContext>
    {!items.length && <EmptyState icon={<BookOpen size={30}/>} title={read ? 'Nothing marked read yet' : 'Your next good read'} description={read ? 'Finished articles will appear here.' : 'Add a link, share one from another app, or bookmark a link in a conversation.'}/>}
  </>;
}
function ReadingRow({ item, index, items, edit }: {
    item: ReadingItem;
    index: number;
    items: ReadingItem[];
    edit: boolean;
}) {
    const state = useApp(), { run, error } = useReadingAction(), title = useReadingTitle(item);
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled: item.readAt !== null });
    const article = state.articleCopies[item.id], pending = state.readingPending.some(p => p.op.itemId === item.id);
    return <div><ItemRow ref={setNodeRef} className={`task-row reading-row ${isDragging ? 'dragging' : ''}`} style={{ transform: CSS.Transform.toString(transform), transition }} {...(item.readAt === null ? attributes : {})} {...holdListeners(listeners)} role="group" aria-label={item.title} aria-roledescription={item.readAt === null ? 'sortable reading item' : undefined} onContextMenu={e => { if (!(e.target as Element).closest('input,textarea'))
        e.preventDefault(); }} onDragStart={e => e.preventDefault()} leading={<IconButton className="completion-button" aria-label={`${item.readAt === null ? 'Mark read' : 'Mark unread'}: ${item.title}`} onClick={() => run(() => readingChange(item.id, { kind: 'read', read: item.readAt === null }))}>{item.readAt === null ? <Circle size={21}/> : <Check size={18}/>}</IconButton>} trailing={edit && item.readAt === null && <div className="reorder-controls"><IconButton aria-label={`Move ${item.title} up`} disabled={!index} onClick={() => run(() => readingChange(item.id, { kind: 'reorder', beforeId: items[index - 1].id }))}><ArrowUp size={16}/></IconButton><IconButton aria-label={`Move ${item.title} down`} disabled={index === items.length - 1} onClick={() => run(() => readingChange(item.id, { kind: 'reorder', beforeId: items[index + 2]?.id || null }))}><ArrowDown size={16}/></IconButton></div>}>

    {edit ? <input className="inline-title" aria-label="Edit reading title" value={title.text} maxLength={2000} onChange={e => title.setText(e.target.value)} onBlur={() => void title.save()} onKeyDown={e => { if (e.key === 'Enter')
        e.currentTarget.blur(); }}/> : <a className="task-title" draggable={false} href={`#/reading-item/${item.id}`}>{item.title}</a>}<ItemMeta><span>{new URL(item.url).hostname}</span>{pending && <span>Saved on device</span>}{item.readAt !== null ? <span>{date(item.readAt)}</span> : article?.html ? <span><Download size={11}/> Available offline{article.status === 'excerpt' ? ' · excerpt' : ''}</span> : null}</ItemMeta>

  </ItemRow>{(error || title.error) && <StatusMessage>{error || title.error}</StatusMessage>}</div>;
}
export function ReadingCapture({ sharedContent, id }: { sharedContent?: import('@herts/plugin-api/types').SharedContent; id?: string }) {
    const shared = !!sharedContent;
    const text = sharedContent ? [sharedContent.text, sharedContent.url].filter((v, i, a) => v && a.indexOf(v) === i).join('\n') || sharedContent.title : undefined;
    const entry = useEntryDraft({ key: shared ? `share:${JSON.stringify(sharedContent)}` : 'reading-capture', pluginId: 'reading', id,
      route: draftId => `/reading/add/${draftId}`, initialText: text,
      initialFields: sharedContent?.title && !sharedUrls(sharedContent.title).length ? { title: sharedContent.title.slice(0, 2000) } : undefined,
      legacy: shared ? undefined : { read: async () => { const saved = await db.drafts.get('reading-capture'); if (!saved) return; try { const old = JSON.parse(saved.text); return { text: old.url || '', files: saved.files, fields: { title: old.title || '' } }; } catch { return { text: saved.text, files: saved.files }; } }, clear: () => db.drafts.delete('reading-capture') },
    });
    async function prepare(draft: Draft) {
      const urls = sharedUrls(draft.text), chosen = entry.fields.url && urls.includes(entry.fields.url) ? entry.fields.url : urls.length === 1 ? urls[0] : undefined;
      if (!chosen) throw new Error(urls.length ? 'Choose which link to save to Reading.' : 'Add a link to your message first.');
      await addReading(chosen, entry.fields.title || '', undefined, draft.id);
    }
    const leave = async (sent: boolean) => { await entry.complete(); if (shared) history.replaceState(null, '', '/'); navigate(sent ? `/reading-item/${entry.id}` : '/reading'); };
    return <><a href="#/reading" className="back-link">Reading list</a><PageHeader title="Add to Reading"/>
      {entry.id ? <MessageComposer context={entry.context} persist={entry.persist} prepare={prepare} owner={entry.owner} saveLabel="Save link" onSaved={() => leave(false)} onSent={() => leave(true)} fields={draft => {
        const urls = sharedUrls(draft.text);
        return <>{urls.length > 1 && <fieldset className="entry-links"><legend>Which link belongs in Reading?</legend>{urls.map(url => <label className="share-choice" key={url}><input type="radio" name="reading-link" checked={entry.fields.url === url} onChange={() => void entry.updateFields({ url })}/><span>{url}</span></label>)}</fieldset>}
          <details className="entry-details"><summary>Reading details</summary><FormField label="Title (optional)"><input aria-label="Reading title" maxLength={2000} value={entry.fields.title || ''} placeholder="A name for this link" onChange={event => void entry.updateFields({ title: event.target.value })}/></FormField></details></>;
      }}/> : <p role="status">Opening draft…</p>}{entry.error && <StatusMessage>{entry.error}</StatusMessage>}
    </>;
}
export function ReadingDetail({ id }: {
    id: string;
}) {
    const state = useApp(), item = state.snapshot.reading?.items.find(i => i.id === id), { run, error } = useReadingAction();
    const [busy, setBusy] = useState(false);
    useUpdatePreparation({ blocked: () => busy ? 'Wait for the link to finish saving.' : undefined });
    useEffect(() => { if (!item)
        void db.kv.get(`reading-alias:${id}`).then(row => { if (row)
            navigate(`/reading-item/${row.value}`); }); }, [id, item, state.snapshot.revision]);
    const context = state.snapshot.contexts?.find(c => c.id === item?.contextId) || (item ? { id: item.contextId, title: item.title, link: null, aliases: [] } : undefined);
    if (!item)
        return <div className="empty"><p>This reading item is not available on this device yet.</p><a href="#/reading">Reading list</a></div>;
    const article = state.articleCopies[id];
    const hasSubmission = state.actions.some(a => a.taskId === item.contextId && !a.cancelled) || state.localSubmissions.some(s => s.taskId === item.contextId);
    const needsInitialMessage = !!context && !context.link && !hasSubmission;
    return <div className="reading-detail"><ConversationHeader title={item.title} backHref={item.readAt === null ? '#/reading' : '#/reading/read'} backLabel="Reading list" context={context}><ReadingTitle item={item}/><div className="reading-detail-controls">
    <a className="primary-button" href={item.url} target="_blank" rel="noopener noreferrer"><BookOpen size={16}/> Open original</a>
    <a className="quiet-button" href={`#/reader/${id}`}>Read in Herts</a><button onClick={() => run(() => readingChange(id, { kind: 'read', read: item.readAt === null }))}><Check size={16}/>{item.readAt === null ? 'Mark read' : 'Mark unread'}</button>
  </div>{error && <StatusMessage>{error}</StatusMessage>}</ConversationHeader>
    <div className="article-status"><a href={item.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14}/> {new URL(item.url).hostname}</a><OfflineControls item={item}/></div>
    {context && <ConversationPanel key={context.id} context={context} initialText={needsInitialMessage ? item.url : ''} showActions={false}/>}
  </div>;
}
function useReadingTitle(item: ReadingItem) {
    const [draft, setDraft] = useState<{
        text: string;
        baseTitle: string;
    } | null>(null), [error, setError] = useState('');
    const savingTitle = useUpdateWork();
    useUpdatePreparation({ blocked: () => draft && draft.text.trim() !== draft.baseTitle ? 'The reading title is still being saved. Please try updating again after it is saved.' : undefined });
    async function save() {
        if (!draft)
            return;
        const title = draft.text.trim();
        setError('');
        if (!title || title === draft.baseTitle) {
            setDraft(null);
            return;
        }
        try {
            await savingTitle(readingChange(item.id, { kind: 'title', title, baseTitle: draft.baseTitle }));
            setDraft(current => current === draft ? null : current && current.baseTitle === draft.baseTitle ? { ...current, baseTitle: title } : current);
        }
        catch {
            setError('The title could not be saved. Your edit is still here; tap the title and leave the field to try again.');
        }
    }
    return { text: draft?.text ?? item.title, setText: (text: string) => setDraft(current => ({ text, baseTitle: current?.baseTitle ?? item.title })), save, error };
}
function ReadingTitle({ item }: {
    item: ReadingItem;
}) {
    const title = useReadingTitle(item);
    return <><textarea className="detail-title" aria-label="Reading title" rows={2} maxLength={2000} value={title.text} onChange={e => title.setText(e.target.value)} onBlur={() => void title.save()}/>{title.error && <p className="inline-error" role="alert">{title.error}</p>}</>;
}
function OfflineControls({ item }: {
    item: ReadingItem;
}) {
    const state = useApp(), article = state.articleCopies[item.id], { run, error } = useReadingAction();
    const storageError = state.articleErrors[item.id]?.version === item.downloadVersion ? state.articleErrors[item.id]?.message : undefined;
    const enabled = item.offline === 'keep' || (item.offline === 'auto' && (state.snapshot.reading?.autoDownload ?? true));
    return <div className="offline-controls"><span role="status">{article?.html ? `Available offline${article.status === 'excerpt' ? ' · saved excerpt' : ''}` : article ? 'Unavailable offline' : item.readAt !== null ? 'Download removed after reading' : storageError ? 'Unavailable offline' : enabled ? 'Waiting for offline copy' : 'No offline download'}</span>
    {article?.warning && article.status !== 'saved' && <p>{article.warning}</p>}{storageError && <p role="alert">{storageError}</p>}
    {item.readAt === null && <div className="button-row">{(!article?.html || !enabled) && <button onClick={() => run(() => readingChange(item.id, { kind: 'offline', offline: 'keep' }))}><Download size={14}/>{article || storageError ? 'Retry download' : 'Make available offline'}</button>}{(enabled || article) && <button onClick={() => run(() => readingChange(item.id, { kind: 'offline', offline: 'remove' }))}><Trash2 size={14}/> Remove download</button>}</div>}
    {error && <p role="alert" className="inline-error">{error}</p>}
  </div>;
}
export function Reader({ id }: {
    id: string;
}) {
    const state = useApp(), item = state.snapshot.reading?.items.find(i => i.id === id);
    const [article, setArticle] = useState<Article>(), [error, setError] = useState(''), [busy, setBusy] = useState(true);
    useEffect(() => { let current = true; setBusy(true); void getArticle(id).then(a => { if (current)
        setArticle(a); }).catch(e => { if (current)
        setError(e.message); }).finally(() => { if (current)
        setBusy(false); }); return () => { current = false; }; }, [id]);
    return <><ConversationHeader><a className="back-link" href={`#/reading-item/${id}`}><ChevronLeft size={17}/> Conversation</a><div className="reader-heading"><h1>{article?.title || item?.title || 'Reading mode'}</h1>{item && <a className="quiet-button" href={item.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/> Open in browser</a>}</div></ConversationHeader>
    {busy && <p className="loading"><LoaderCircle size={17} className="spin"/>Preparing article…</p>}{error && <p className="inline-error" role="alert">{error}</p>}
    {article && <><p className="reader-source">{article.siteName}{article.byline ? ` · ${article.byline}` : ''} · Saved {date(article.fetchedAt)}</p>{article.warning && article.status !== 'saved' && <p className="reader-warning">{article.warning}</p>}{article.html && <article className="markdown reader-article" dangerouslySetInnerHTML={{ __html: article.html }}/>}</>}
  </>;
}
export function BookmarkLink({ href, conversationId, children }: {
    href?: string;
    conversationId: string;
    children: ReactNode;
}) {
    const state = useApp(), [busy, setBusy] = useState(false), [error, setError] = useState('');
    let url: string | undefined;
    try {
        if (href)
            url = normalizeUrl(href);
    }
    catch { /* Render unsupported links as text. */ }
    const context = state.snapshot.contexts?.find(c => c.aliases.includes(conversationId));
    const existing = context && state.snapshot.reading?.items.find(i => i.contextId === context.id && i.urlKey === url);
    async function bookmark() {
        if (!url || busy)
            return;
        if (existing) {
            navigate(`/reading-item/${existing.id}`);
            return;
        }
        setBusy(true);
        setError('');
        try {
            await addReading(url, '', conversationId);
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    }
    return <>{url && <button className={`bookmark-button ${existing ? 'saved' : ''}`} aria-label={`${existing ? 'Open reading item' : 'Save to reading list'}: ${url}`} title={existing ? 'Open reading item' : 'Save to reading list'} disabled={busy} onClick={() => void bookmark()}>{busy ? <LoaderCircle size={15} className="spin"/> : existing ? <BookmarkCheck size={16}/> : <Bookmark size={16}/>}</button>}{error && <span role="alert" className="inline-error">{error}</span>}</>;
}
export function ReadingSettings() {
    const state = useApp(), { run, error } = useReadingAction();
    return <SettingsSection title="Offline reading" icon={<Download size={22}/>}><SettingRow label="Automatically download unread articles" htmlFor="reading-auto-download" control={<input id="reading-auto-download" type="checkbox" checked={state.snapshot.reading?.autoDownload ?? true} onChange={e => run(() => readingChange(crypto.randomUUID(), { kind: 'settings', autoDownload: e.target.checked }))}/>}/><p>Marking an item read removes its offline download.</p>{error && <StatusMessage>{error}</StatusMessage>}</SettingsSection>;
}
