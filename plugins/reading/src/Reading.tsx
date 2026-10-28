import { readingTitle, ComposerPlaceholder, MessageComposer, useEntryDraft, type Draft } from '@herts/plugin-api/client';
import { DragPreview, DragHandle, ActionRow, ActionRowLink, RenameAction, PageHeader, Button, ButtonLink, IconButton, SectionNav, SectionLink, ItemList, ItemRow, ItemMeta, EmptyState, StatusMessage, SettingsSection, SettingRow } from '@herts/plugin-api/client';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { BookOpen, Bookmark, BookmarkCheck, Plus, Check, Circle, ExternalLink, Download, Trash2, LoaderCircle } from 'lucide-react';
import { DndContext, DragOverlay, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { useHoldSensors, holdListeners, useDragClickGuard } from '@herts/plugin-api/client';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { emptyReading, normalizeUrl, sharedUrls, type ReadingItem, type Article } from './model';
import { useApp, addReading, readingChange, changeReadingWithUndo, db, sync, publish, getArticle } from './data';
import { ConversationPanel } from '@herts/plugin-api/client';
import { ConversationHeader } from '@herts/plugin-api/client';
import { readingReturnTarget, saveReadingReturnTarget, replaceReadingAlias } from './navigation';
const navigate = (path: string) => { location.hash = path; };
const date = (at: number) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(at);
function useReadingAction() {
    const [error, setError] = useState('');
    const run = (action: () => Promise<unknown>) => { setError(''); void action().catch(e => setError(e.message)); };
    return { run, error };
}
function readingEntry(item: ReadingItem, available: boolean) {
    try { const mode = sessionStorage.getItem(`herts:reading-mode:${item.id}`); if (mode) return `#/${mode === 'article' ? 'reader' : 'reading-item'}/${item.id}`; } catch {}
    return `#/${available ? 'reader' : 'reading-item'}/${item.id}`;
}
export function ReadingList({ read }: {
    read: boolean;
}) {
    const state = useApp(), reading = state.snapshot.reading || emptyReading();
    const [activeId, setActiveId] = useState<string>();
    const { run, error } = useReadingAction();
    const items = read ? reading.items.filter(i => i.readAt !== null).sort((a, b) => b.readAt! - a.readAt! || a.id.localeCompare(b.id)) : reading.unread.ids.map(id => reading.items.find(i => i.id === id)!).filter(Boolean);
    const sensors = useHoldSensors(), clickGuard = useDragClickGuard();
    const activeItem = items.find(item => item.id === activeId);
    function drag({ active, over }: DragEndEvent) {
        clickGuard.end(); setActiveId(undefined);
        if (read || !over || active.id === over.id)
            return;
        const from = items.findIndex(i => i.id === active.id), to = items.findIndex(i => i.id === over.id);
        run(() => readingChange(String(active.id), { kind: 'reorder', beforeId: from < to ? items[to + 1]?.id || null : String(over.id) }));
    }
    return <><PageHeader title="Reading list" count={items.length}/>
    <div className="reading-toolbar"><SectionNav className="reading-tabs" aria-label="Reading lists"><SectionLink href="#/reading" active={!read}>Unread <small>{reading.unread.ids.length}</small></SectionLink><SectionLink href="#/reading/read" active={read}>Read <small>{reading.items.length - reading.unread.ids.length}</small></SectionLink></SectionNav><ButtonLink variant="primary" className="reading-add" href="#/reading/add"><Plus size={17}/> Add link</ButtonLink></div>
    {error && <StatusMessage>{error}</StatusMessage>}
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={drag} onDragStart={({active}) => { clickGuard.start(); setActiveId(String(active.id)); }} onDragCancel={() => { clickGuard.end(); setActiveId(undefined); }}><SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}><ItemList className="task-list">{items.map((item, index) => <ReadingRow key={item.id} item={item} index={index} items={items}/>)}</ItemList></SortableContext><DragOverlay dropAnimation={null}>{activeItem && <DragPreview metadata={<ReadingMetadata item={activeItem}/>}>{readingTitle(activeItem.title, activeItem.url)}</DragPreview>}</DragOverlay></DndContext>
    {!items.length && <EmptyState icon={<BookOpen size={30}/>} title={read ? 'Nothing marked read yet' : 'Your next good read'} description={read ? 'Finished articles will appear here.' : 'Add a link, share one from another app, or bookmark a link in a conversation.'}/>}
  </>;
}
function ReadingMetadata({ item }: { item: ReadingItem }) {
    const state = useApp(), article = state.articleCopies[item.id], pending = state.readingPending.some(p => p.op.itemId === item.id);
    return <ItemMeta><span>{new URL(item.url).hostname}</span>{pending && <span>Saved on device</span>}{item.readAt !== null ? <span>{date(item.readAt)}</span> : article?.html ? <span><Download size={11}/> Available offline{article.status === 'excerpt' ? ' · excerpt' : ''}</span> : null}</ItemMeta>;
}
function ReadingRow({ item, index, items }: {
    item: ReadingItem;
    index: number;
    items: ReadingItem[];
}) {
    const state = useApp();
    const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging, isOver, activeIndex, overIndex } = useSortable({ id: item.id, disabled: item.readAt !== null });
    const article = state.articleCopies[item.id];
    return <div><ItemRow ref={setNodeRef} className={`task-row reading-row ${isDragging ? 'dragging' : ''} ${isOver && !isDragging ? activeIndex < overIndex ? 'task-insertion-after' : 'task-insertion-before' : ''}`} style={{ transform: CSS.Transform.toString(transform), transition }} {...(item.readAt === null ? attributes : {})} {...holdListeners(listeners)} role="group" tabIndex={-1} aria-label={item.title} aria-roledescription={item.readAt === null ? 'sortable reading item' : undefined} onDragStart={e => e.preventDefault()} leading={<IconButton className="completion-button" aria-label={`${item.readAt === null ? 'Mark read' : 'Mark unread'}: ${item.title}`} onClick={() => void changeReadingWithUndo(item, items[index + 1]?.id || null)}>{item.readAt === null ? <Circle size={21}/> : <Check size={18}/>}</IconButton>} trailing={item.readAt === null && <DragHandle ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Drag ${item.title}`}/>}>
    <a className="task-title" title={item.title || item.url} aria-label={item.title || item.url} draggable={false} href={readingEntry(item, !!article?.html)}>{readingTitle(item.title, item.url)}</a><ReadingMetadata item={item}/>

  </ItemRow></div>;
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
      let title = entry.fields.title?.trim() || '';
      if (/^https?:\/\/\S*$/i.test(title)) {
        try { if (normalizeUrl(title) !== normalizeUrl(chosen)) title = ''; }
        catch { title = ''; }
      }
      await addReading(chosen, title, undefined, draft.id);
    }
    const leave = async (sent: boolean) => { await entry.complete(); if (shared) history.replaceState(null, '', '/'); navigate(sent ? `/reading-item/${entry.id}` : '/reading'); };
    return <><a href="#/reading" className="back-link">Reading list</a><PageHeader title="Add to Reading"/>
      {entry.id ? <MessageComposer context={entry.context} persist={entry.persist} prepare={prepare} owner={entry.owner} saveLabel="Save only" onSaved={() => leave(false)} onSent={() => leave(true)} fields={draft => {
        const urls = sharedUrls(draft.text);
        return urls.length > 1 && <fieldset className="entry-links"><legend>Which link belongs in Reading?</legend>{urls.map(url => <label className="share-choice" key={url}><input type="radio" name="reading-link" checked={entry.fields.url === url} onChange={() => void entry.updateFields({ url })}/><span>{url}</span></label>)}</fieldset>;
      }}/> : <ComposerPlaceholder/>}{entry.error && <StatusMessage>{entry.error}</StatusMessage>}
    </>;
}
type ReadingMode = 'discussion' | 'article';
function savedSplit(id: string) { try { return sessionStorage.getItem(`herts:reading-split:${id}`) === 'true'; } catch { return false; } }
const articlePositions = new Map<string, number>();
export function ReadingDetail({ id, initialMode = 'discussion' }: { id: string; initialMode?: ReadingMode }) {
    const state = useApp(), item = state.snapshot.reading?.items.find(i => i.id === id);
    const back = readingReturnTarget(id, item?.readAt != null);
    useLayoutEffect(() => { if (item) saveReadingReturnTarget(back); }, [id, item, back.href, back.label]);
    const { run, error } = useReadingAction();
    const [mode, setMode] = useState<ReadingMode>(initialMode), [split, setSplit] = useState(() => savedSplit(id));
    const [wide, setWide] = useState(() => matchMedia('(min-width:1280px)').matches);
    useEffect(() => { setMode(initialMode); }, [initialMode]);
    useEffect(() => { const query = matchMedia('(min-width:1280px)'); const update = () => setWide(query.matches); query.addEventListener('change', update); return () => query.removeEventListener('change', update); }, []);
    useEffect(() => { let current = true; if (!item) void db.kv.get(`reading-alias:${id}`).then(row => { if (current && row) replaceReadingAlias(id, row.value); }); return () => { current = false; }; }, [id, item, state.snapshot.revision]);
    const context = state.snapshot.contexts?.find(c => c.id === item?.contextId) || (item ? { id: item.contextId, title: item.title, link: null, aliases: [] } : undefined);
    if (!item) return <EmptyState icon={<BookOpen/>} title={state.online ? 'Reading item unavailable' : 'Reading item not saved on this device'} description={state.online ? 'Refresh to check this item.' : 'Reconnect to check this item.'}><ButtonLink href="#/reading">Reading list</ButtonLink><Button disabled={!state.online} onClick={() => void sync()}>Refresh</Button></EmptyState>;
    const alongside = wide && split;
    const showArticle = alongside || mode === 'article', showDiscussion = alongside || mode === 'discussion';
    const hasSubmission = state.activitySummaries[item.contextId]?.hasSubmission || state.actions.some(a => a.taskId === item.contextId && !a.cancelled) || state.localSubmissions.some(s => s.taskId === item.contextId);
    function chooseMode(next: ReadingMode) { setMode(next); try { sessionStorage.setItem(`herts:reading-mode:${id}`, next); } catch {} }
    function toggleSplit() { const next = !split; setSplit(next); try { sessionStorage.setItem(`herts:reading-split:${id}`, String(next)); } catch {} }
    return <div className={`reading-detail reading-workspace ${alongside ? 'reading-split' : ''}`}>
      <ConversationHeader title={item.title} backHref={back.href} backLabel={back.label} context={context}>
        <ReadingTitle item={item}/><ActionRowLink icon={<ExternalLink size={20}/>} href={item.url} target="_blank" rel="noopener noreferrer">Open original</ActionRowLink><ActionRow icon={<Check size={20}/>} onClick={() => run(() => readingChange(id, { kind: 'read', read: item.readAt === null }))}>{item.readAt === null ? 'Mark read' : 'Mark unread'}</ActionRow>
        <OfflineControls item={item}/>{error && <StatusMessage>{error}</StatusMessage>}
      </ConversationHeader>
      <div className="reading-mode-bar"><SectionNav aria-label="Reading mode"><SectionLink href={`#/reading-item/${id}`} active={mode === 'discussion'} onClick={() => chooseMode('discussion')}>Discussion</SectionLink><SectionLink href={`#/reader/${id}`} active={mode === 'article'} onClick={() => chooseMode('article')}>Article</SectionLink></SectionNav>{wide && <Button aria-pressed={split} onClick={toggleSplit}>{split ? 'Show one pane' : 'Show alongside'}</Button>}</div>
      <div className="reading-panes">
        <section className="reading-article-pane" aria-label="Article pane" hidden={!showArticle} onFocusCapture={() => { if (alongside) setMode('article'); }} onPointerDown={() => { if (alongside) setMode('article'); }}>
          <ArticleContent key={id} item={item} active={showArticle}/>
        </section>
        <section className="reading-discussion-pane" aria-label="Discussion pane" hidden={!showDiscussion} onFocusCapture={() => { if (alongside) setMode('discussion'); }} onPointerDown={() => { if (alongside) setMode('discussion'); }}>
          {context && <ConversationPanel fullTitle={item.title} key={context.id} context={context} initialText={!context.link && !hasSubmission ? item.url : ''} showActions={false} showHeading={false}/>}
        </section>
      </div>
    </div>;
}
function ReadingTitle({ item }: {
    item: ReadingItem;
}) {
    return <RenameAction title={item.title} label="Rename article" fieldLabel="Reading title" save={(title, baseTitle) => readingChange(item.id, { kind: 'title', title, baseTitle })}/>;
}
function OfflineControls({ item }: { item: ReadingItem }) {
    const state = useApp(), article = state.articleCopies[item.id], { run, error } = useReadingAction();
    const storageError = state.articleErrors[item.id]?.version === item.downloadVersion ? state.articleErrors[item.id]?.message : undefined;
    const enabled = item.offline === 'keep' || (item.offline === 'auto' && (state.snapshot.reading?.autoDownload ?? true));
    const pending = state.readingPending.some(p => p.op.itemId === item.id);
    const downloading = state.articleDownloads.some(key => key.endsWith(`:${item.id}:${item.downloadVersion}`));
    const label = article?.html ? 'Available offline' : item.readAt !== null ? 'Download removed after reading' : downloading && state.online ? 'Downloading…' : storageError ? 'Download failed' : !state.online ? 'Unavailable offline' : article ? 'Article unavailable' : enabled ? 'Waiting for offline copy' : 'No offline download';
    return <div className="offline-controls"><p role="status">{label}</p><div className="offline-actions">
      {storageError && <StatusMessage>{storageError}</StatusMessage>}
      {!state.online && item.readAt === null && <p>Reconnect to download this article.</p>}
      {item.readAt !== null && <ActionRow icon={<Download size={20}/>} disabled={pending} onClick={() => run(() => readingChange(item.id, { kind: 'read', read: false }))}>Mark unread to download</ActionRow>}
      {item.readAt === null && <>{(!enabled || storageError || article && !article.html) ? <ActionRow icon={<Download size={20}/>} disabled={!state.online || pending} onClick={() => run(() => readingChange(item.id, { kind: 'offline', offline: 'keep' }))}>{storageError || article ? 'Retry download' : 'Make available offline'}</ActionRow> : <ActionRow icon={<Trash2 size={20}/>} disabled={pending} onClick={() => run(() => readingChange(item.id, { kind: 'offline', offline: 'remove' }))}>{article?.html ? 'Remove download' : 'Cancel download'}</ActionRow>}</>}
      {error && <StatusMessage>{error}</StatusMessage>}
    </div></div>;
}
function ArticleContent({ item, active }: { item: ReadingItem; active: boolean }) {
    const state = useApp();
    const cached = state.articleCopies[item.id];
    const { run: download, error: downloadError } = useReadingAction();
    const storageError = state.articleErrors[item.id]?.version === item.downloadVersion ? state.articleErrors[item.id]?.message : undefined;
    const pending = state.readingPending.some(p => p.op.itemId === item.id);
    const [article, setArticle] = useState<Article | undefined>(cached), [error, setError] = useState(''), [busy, setBusy] = useState(!cached), [attempt, setAttempt] = useState(0);
    const root = useRef<HTMLDivElement>(null), position = useRef(articlePositions.get(item.id) || 0);
    useEffect(() => {
      if (!active) return;
      let current = true; setError(''); setBusy(true);
      void getArticle(item.id).then(value => { if (current && value.version === item.downloadVersion) setArticle(value); }).catch(reason => { if (current) setError(reason.message); }).finally(() => { if (current) setBusy(false); });
      return () => { current = false; };
    }, [item.id, item.downloadVersion, attempt, state.connectionVersion, active]);
    useLayoutEffect(() => {
      const pane = root.current?.parentElement; if (!pane || !active) return;
      pane.scrollTop = position.current;
      const remember = () => { position.current = pane.scrollTop; articlePositions.set(item.id, pane.scrollTop); };
      pane.addEventListener('scroll', remember, { passive: true });
      return () => pane.removeEventListener('scroll', remember);
    }, [item.id, article?.html, active]);
    const content = article?.version === item.downloadVersion ? article : cached;
    const downloadFailure = storageError || (content?.status === 'unavailable' ? content.warning || 'Article unavailable.' : '');
    return <div ref={root} className="article-content"><div className="reader-heading"><h1>{item.title}</h1>
      <div className="reader-meta"><span className="reader-source">{content?.siteName || new URL(item.url).hostname}{content?.byline ? ` · ${content.byline}` : ''}</span>
        {content?.status === 'excerpt' && <span className="reader-excerpt">Saved excerpt</span>}
        <a className="reader-original" href={item.url} target="_blank" rel="noopener noreferrer">Open original <ExternalLink size={16} aria-hidden="true"/></a>
      </div></div>
      {busy && <p role="status">{content?.html ? 'Refreshing article…' : 'Preparing article…'}</p>}
      {error && <StatusMessage>{state.online ? error : 'Offline. This article could not be loaded.'}<Button disabled={!state.online} onClick={() => setAttempt(value => value + 1)}>Try again</Button></StatusMessage>}
      {downloadFailure && <StatusMessage>{downloadFailure}<Button disabled={!state.online || pending} onClick={() => download(() => readingChange(item.id, { kind: 'offline', offline: 'keep' }))}>Retry download</Button></StatusMessage>}
      {downloadError && <StatusMessage>{downloadError}</StatusMessage>}
      {content?.html && <article className="markdown reader-article" dangerouslySetInnerHTML={{ __html: content.html }}/>}
    </div>;
}
export function Reader({ id }: { id: string }) { return <ReadingDetail id={id} initialMode="article"/>; }
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
    return <SettingsSection title="Offline reading" icon={<Download size={22}/>}><SettingRow label="Automatically download unread articles" htmlFor="reading-auto-download" description="Marking an item read removes its offline download." control={<input id="reading-auto-download" type="checkbox" checked={state.snapshot.reading?.autoDownload ?? true} onChange={e => run(() => readingChange(crypto.randomUUID(), { kind: 'settings', autoDownload: e.target.checked }))}/>}/>{error && <StatusMessage>{error}</StatusMessage>}</SettingsSection>;
}
