import { useTaskDestination } from './Spaces';
import { spaceName } from '../shared/model';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { BookOpen, Bookmark, BookmarkCheck, Plus, Check, Circle, ArrowUp, ArrowDown, Pencil, ChevronLeft, ExternalLink, Download, Trash2, LoaderCircle, Send } from 'lucide-react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { useHoldSensors, holdListeners, useDragClickGuard } from './TaskDragging';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { emptyReading, normalizeUrl, sharedUrls, type ReadingItem, type Article } from '../shared/reading';
import { useApp, addReading, readingChange, db, sync, sendReadingLink, publish, createTaskFromConversation, getArticle } from './data';
import { ConversationPanel } from './App';
import { ConversationHeader } from './ConversationHeader';

const navigate = (path: string) => { location.hash = path; };
const date = (at: number) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(at);
function useReadingAction() {
  const [error, setError] = useState('');
  const run = (action: () => Promise<unknown>) => { setError(''); void action().catch(e => setError(e.message)); };
  return { run, error };
}
export function ReadingList({ read }: { read: boolean }) {
  const state = useApp(), reading = state.snapshot.reading || emptyReading();
  const [edit, setEdit] = useState(false), { run, error } = useReadingAction();
  const items = read ? reading.items.filter(i => i.readAt !== null).sort((a, b) => b.readAt! - a.readAt! || a.id.localeCompare(b.id)) : reading.unread.ids.map(id => reading.items.find(i => i.id === id)!).filter(Boolean);
  const sensors = useHoldSensors(), clickGuard = useDragClickGuard();
  function drag({ active, over }: DragEndEvent) {
    clickGuard.end();
    if (read || !over || active.id === over.id) return;
    const from = items.findIndex(i => i.id === active.id), to = items.findIndex(i => i.id === over.id);
    run(() => readingChange(String(active.id), { kind: 'reorder', beforeId: from < to ? items[to + 1]?.id || null : String(over.id) }));
  }
  return <><div className="page-heading"><div><div className="eyebrow">YOUR READING</div><h1>Reading list <span className="heading-count">{items.length}</span></h1><p>Links to return to, in your order.</p></div><button className={`quiet-button ${edit ? 'selected' : ''}`} onClick={() => setEdit(!edit)}><Pencil size={15}/>{edit ? 'Finish editing' : 'Edit list'}</button></div>
    <div className="reading-toolbar"><div className="reading-tabs"><a href="#/reading" className={!read ? 'active' : ''}>Unread <small>{reading.unread.ids.length}</small></a><a href="#/reading/read" className={read ? 'active' : ''}>Read <small>{reading.items.length - reading.unread.ids.length}</small></a></div><a className="primary-button reading-add" href="#/reading/add"><Plus size={17}/> Add link</a></div>
    {error && <p role="alert" className="inline-error">{error}</p>}<div className="list-summary"><span>{read ? 'READ' : 'MANUAL ORDER'}</span><span>{read ? 'Most recently read first' : 'New links at the top'}</span></div>
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={drag} onDragStart={clickGuard.start} onDragCancel={clickGuard.end}><SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}><div className="task-list">{items.map((item, index) => <ReadingRow key={item.id} item={item} index={index} items={items} edit={edit}/>)}</div></SortableContext></DndContext>
    {!items.length && <div className="empty"><div className="empty-icon"><BookOpen size={30}/></div><h2>{read ? 'Nothing marked read yet' : 'Your next good read'}</h2><p>{read ? 'Finished articles will appear here.' : 'Add a link, share one from another app, or bookmark a link in a conversation.'}</p></div>}
  </>;
}
function ReadingRow({ item, index, items, edit }: { item: ReadingItem; index: number; items: ReadingItem[]; edit: boolean }) {
  const state = useApp(), { run, error } = useReadingAction(), title = useReadingTitle(item);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled: item.readAt !== null });
  const article = state.articleCopies[item.id], pending = state.readingPending.some(p => p.op.itemId === item.id);
  return <div><div ref={setNodeRef} className={`task-row reading-row ${isDragging ? 'dragging' : ''}`} style={{ transform: CSS.Transform.toString(transform), transition }} {...(item.readAt === null ? attributes : {})} {...holdListeners(listeners)} role="group" aria-label={item.title} aria-roledescription={item.readAt === null ? 'sortable reading item' : undefined} onContextMenu={e => { if (!(e.target as Element).closest('input,textarea')) e.preventDefault(); }} onDragStart={e => e.preventDefault()}>
    <button className="completion-button" aria-label={`${item.readAt === null ? 'Mark read' : 'Mark unread'}: ${item.title}`} onClick={() => run(() => readingChange(item.id, { kind: 'read', read: item.readAt === null }))}>{item.readAt === null ? <Circle size={21}/> : <Check size={18}/>}</button>
    <div className="task-row-body">{edit ? <input className="inline-title" aria-label="Edit reading title" value={title.text} maxLength={2000} onChange={e => title.setText(e.target.value)} onBlur={() => void title.save()} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/> : <a className="task-title" draggable={false} href={`#/reading-item/${item.id}`}>{item.title}</a>}<div className="task-meta"><span>{new URL(item.url).hostname}</span>{pending && <span>Saved on device</span>}{item.readAt !== null ? <span>{date(item.readAt)}</span> : article?.html ? <span><Download size={11}/> Available offline{article.status === 'excerpt' ? ' · excerpt' : ''}</span> : null}</div></div>
    {edit && item.readAt === null && <div className="reorder-controls"><button className="icon-button" aria-label={`Move ${item.title} up`} disabled={!index} onClick={() => run(() => readingChange(item.id, { kind: 'reorder', beforeId: items[index - 1].id }))}><ArrowUp size={16}/></button><button className="icon-button" aria-label={`Move ${item.title} down`} disabled={index === items.length - 1} onClick={() => run(() => readingChange(item.id, { kind: 'reorder', beforeId: items[index + 2]?.id || null }))}><ArrowDown size={16}/></button></div>}
  </div>{(error || title.error) && <p role="alert" className="inline-error">{error || title.error}</p>}</div>;
}
export function ReadingCapture() {
  const state = useApp(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const params = new URLSearchParams(location.search), shared = location.pathname === '/share';
  const [candidates] = useState(() => shared ? sharedUrls(params.get('url') || '', params.get('text') || '', params.get('title') || '') : []);
  const [url, setUrl] = useState(() => candidates.length === 1 ? candidates[0] : ''), [title, setTitle] = useState(() => shared && !sharedUrls(params.get('title') || '').length ? (params.get('title') || '').slice(0, 2000) : ''), [loaded, setLoaded] = useState(shared);
  const submitting = useRef(false);
  useEffect(() => { if (!shared) void db.drafts.get('reading-capture').then(d => { if (d) { try { const v = JSON.parse(d.text); setUrl(v.url); setTitle(v.title); } catch { setUrl(d.text); } } setLoaded(true); }).catch(() => setError('Your draft could not be opened. Reload to try again.')); }, []);
  function update(nextUrl: string, nextTitle: string) { setUrl(nextUrl); setTitle(nextTitle); void db.drafts.put({ id: 'reading-capture', text: JSON.stringify({ url: nextUrl, title: nextTitle }), files: [] }).catch(() => setError('The draft could not be saved on this device.')); }
  async function capture(e: FormEvent) {
    e.preventDefault(); if (submitting.current) return; submitting.current = true; setBusy(true); setError('');
    try {
      const normalized = normalizeUrl(url), canSend = state.online && state.gateway.online;
      const itemId = await addReading(normalized, title);
      await db.drafts.delete('reading-capture');
      if (shared) history.replaceState(null, '', '/');
      navigate(`/reading-item/${itemId}`);
      if (canSend) void sync().then(() => sendReadingLink(itemId)).catch(e => publish({ error: `Link saved. ${e.message}` }));
    } catch (e) { setError((e as Error).message); } finally { submitting.current = false; setBusy(false); }
  }
  function cancel() { if (shared) history.replaceState(null, '', '/'); navigate('/reading'); }
  return <><a href="#/reading" className="back-link" onClick={e => { e.preventDefault(); cancel(); }}><ChevronLeft size={17}/> Reading list</a><div className="page-heading"><div><div className="eyebrow">SAVE SOMETHING TO READ</div><h1>Add a link</h1><p>Save it to Reading and send the link to Hermes.</p></div></div>
    <form className="reading-capture" onSubmit={capture}>{candidates.length > 1 && <fieldset><legend>Choose the link to save</legend>{candidates.map(candidate => <label className="share-choice" key={candidate}><input type="radio" name="shared-link" value={candidate} checked={url === candidate} onChange={() => update(candidate, title)}/><span>{candidate}</span></label>)}</fieldset>}
      <label>Link<input type="url" aria-label="Article link" value={url} disabled={!loaded || busy} onChange={e => update(e.target.value, title)} placeholder="https://…" required maxLength={8192}/></label>
      <label>Title <span className="subtle-note">(optional)</span><input aria-label="Reading title" value={title} disabled={!loaded || busy} onChange={e => update(url, e.target.value)} maxLength={2000}/></label>
      <div className="button-row"><button className="primary-button" disabled={!loaded || busy || !url.trim()}>{busy ? <LoaderCircle className="spin" size={16}/> : <Plus size={16}/>} {state.online && state.gateway.online ? 'Add & send' : 'Save link'}</button><button type="button" onClick={cancel}>Cancel</button></div>
      {(!state.online || !state.gateway.online) && <p>Hermes is unavailable. Save the link now and use Send to Hermes when connected.</p>}{error && <p role="alert" className="inline-error">{error}</p>}
    </form></>;
}
export function ReadingDetail({ id }: { id: string }) {
  const state = useApp(), item = state.snapshot.reading?.items.find(i => i.id === id), { run, error } = useReadingAction();
  const [showTask, setShowTask] = useState(false), [title, setTitle] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { if (!item) void db.kv.get(`reading-alias:${id}`).then(row => { if (row) navigate(`/reading-item/${row.value}`); }); }, [id, item, state.snapshot.revision]);
  const context = state.snapshot.contexts?.find(c => c.id === item?.contextId);
  const destination = useTaskDestination(context?.link?.key);
  if (!item) return <div className="empty"><p>This reading item is not available on this device yet.</p><a href="#/reading">Reading list</a></div>;
  const task = state.snapshot.tasks.find(t => t.contextId === item.contextId), article = state.articleCopies[id];
  const hasSubmission = state.actions.some(a => a.taskId === item.contextId && !a.cancelled) || state.localSubmissions.some(s => s.taskId === item.contextId);
  async function makeTask(e: FormEvent) { e.preventDefault(); if (!context?.link) return; setBusy(true); try { const taskId = await createTaskFromConversation(context.link.key, title.trim(), destination); navigate(`/task/${taskId}`); } finally { setBusy(false); } }
  return <div className="reading-detail"><ConversationHeader><a href={item.readAt === null ? '#/reading' : '#/reading/read'} className="back-link"><ChevronLeft size={17}/> Reading list</a><ReadingTitle item={item}/><div className="reading-detail-controls">
    <a className="primary-button" href={!state.online && article?.html ? `#/reader/${id}` : item.url} {...(state.online || !article?.html ? { target: '_blank', rel: 'noopener noreferrer' } : {})}><BookOpen size={16}/> Read article</a>
    <a className="quiet-button" href={`#/reader/${id}`}>Reading mode</a><button onClick={() => run(() => readingChange(id, { kind: 'read', read: item.readAt === null }))}><Check size={16}/>{item.readAt === null ? 'Mark read' : 'Mark unread'}</button>
    {task ? <a className="quiet-button" href={`#/task/${task.id}`}>Open task</a> : context?.link && <button disabled={!state.online} onClick={() => { setTitle(item.title); setShowTask(!showTask); }}><Plus size={16}/> Make a task</button>}
  </div>{showTask && !task && <form className="create-from-chat" onSubmit={e => run(() => makeTask(e))}><label>New task in {spaceName(state.snapshot, destination)} Inbox<input aria-label="New task from conversation title" value={title} onChange={e => setTitle(e.target.value)} maxLength={2000}/></label><div className="button-row"><button disabled={busy || !title.trim()}>Create task</button><button type="button" onClick={() => setShowTask(false)}>Cancel</button></div></form>}</ConversationHeader>
    <div className="article-status"><a href={item.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14}/> {new URL(item.url).hostname}</a><OfflineControls item={item}/></div>
    {error && <p role="alert" className="inline-error">{error}</p>}
    {context && !context.link && !hasSubmission && <div className="reading-send-note"><p>Your link is saved. Send it to start its Hermes conversation.</p><button className="primary-button" disabled={!state.online || !state.gateway.online || busy} onClick={() => { setBusy(true); run(() => sync().then(() => sendReadingLink(id)).finally(() => setBusy(false))); }}><Send size={16}/> Send to Hermes</button></div>}
    {context && <ConversationPanel key={context.id} context={context} initialText={!context.link && !hasSubmission ? item.url : ''}/>}
  </div>;
}
function useReadingTitle(item: ReadingItem) {
  const [draft, setDraft] = useState<{ text: string; baseTitle: string } | null>(null), [error, setError] = useState('');
  async function save() {
    if (!draft) return;
    const title = draft.text.trim(); setError('');
    if (!title || title === draft.baseTitle) { setDraft(null); return; }
    try {
      await readingChange(item.id, { kind: 'title', title, baseTitle: draft.baseTitle });
      setDraft(current => current === draft ? null : current && current.baseTitle === draft.baseTitle ? { ...current, baseTitle: title } : current);
    } catch { setError('The title could not be saved. Your edit is still here; tap the title and leave the field to try again.'); }
  }
  return { text: draft?.text ?? item.title, setText: (text: string) => setDraft(current => ({ text, baseTitle: current?.baseTitle ?? item.title })), save, error };
}
function ReadingTitle({ item }: { item: ReadingItem }) {
  const title = useReadingTitle(item);
  return <><textarea className="detail-title" aria-label="Reading title" rows={2} maxLength={2000} value={title.text} onChange={e => title.setText(e.target.value)} onBlur={() => void title.save()}/>{title.error && <p className="inline-error" role="alert">{title.error}</p>}</>;
}
function OfflineControls({ item }: { item: ReadingItem }) {
  const state = useApp(), article = state.articleCopies[item.id], { run, error } = useReadingAction();
  const storageError = state.articleErrors[item.id]?.version === item.downloadVersion ? state.articleErrors[item.id]?.message : undefined;
  const enabled = item.offline === 'keep' || (item.offline === 'auto' && (state.snapshot.reading?.autoDownload ?? true));
  return <div className="offline-controls"><span role="status">{article?.html ? `Available offline${article.status === 'excerpt' ? ' · saved excerpt' : ''}` : article ? 'Unavailable offline' : item.readAt !== null ? 'Download removed after reading' : storageError ? 'Unavailable offline' : enabled ? 'Waiting for offline copy' : 'No offline download'}</span>
    {article?.warning && <p>{article.warning}</p>}{storageError && <p role="alert">{storageError}</p>}
    {item.readAt === null && <div className="button-row">{(!article?.html || !enabled) && <button onClick={() => run(() => readingChange(item.id, { kind: 'offline', offline: 'keep' }))}><Download size={14}/>{article || storageError ? 'Retry download' : 'Make available offline'}</button>}{(enabled || article) && <button onClick={() => run(() => readingChange(item.id, { kind: 'offline', offline: 'remove' }))}><Trash2 size={14}/> Remove download</button>}</div>}
    {error && <p role="alert" className="inline-error">{error}</p>}
  </div>;
}
export function Reader({ id }: { id: string }) {
  const state = useApp(), item = state.snapshot.reading?.items.find(i => i.id === id);
  const [article, setArticle] = useState<Article>(), [error, setError] = useState(''), [busy, setBusy] = useState(true);
  useEffect(() => { let current = true; setBusy(true); void getArticle(id).then(a => { if (current) setArticle(a); }).catch(e => { if (current) setError(e.message); }).finally(() => { if (current) setBusy(false); }); return () => { current = false; }; }, [id]);
  return <><ConversationHeader><a className="back-link" href={`#/reading-item/${id}`}><ChevronLeft size={17}/> Conversation</a><div className="reader-heading"><h1>{article?.title || item?.title || 'Reading mode'}</h1>{item && <a className="quiet-button" href={item.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/> Open in browser</a>}</div></ConversationHeader>
    {busy && <p className="loading"><LoaderCircle size={17} className="spin"/>Preparing article…</p>}{error && <p className="inline-error" role="alert">{error}</p>}
    {article && <><p className="reader-source">{article.siteName}{article.byline ? ` · ${article.byline}` : ''} · Saved {date(article.fetchedAt)}</p><p className="reader-warning">{article.warning}</p>{article.html && <article className="markdown reader-article" dangerouslySetInnerHTML={{ __html: article.html }}/>}</>}
  </>;
}
export function BookmarkLink({ href, conversationId, children }: { href?: string; conversationId: string; children: ReactNode }) {
  const state = useApp(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  let url: string | undefined; try { if (href) url = normalizeUrl(href); } catch { /* Render unsupported links as text. */ }
  const context = state.snapshot.contexts?.find(c => c.aliases.includes(conversationId));
  const existing = context && state.snapshot.reading?.items.find(i => i.contextId === context.id && i.urlKey === url);
  async function bookmark() {
    if (!url || busy) return; if (existing) { navigate(`/reading-item/${existing.id}`); return; }
    setBusy(true); setError(''); try { await addReading(url, '', conversationId); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <><a href={url} target="_blank" rel="noopener noreferrer">{children}</a>{url && <button className={`bookmark-button ${existing ? 'saved' : ''}`} aria-label={`${existing ? 'Open reading item' : 'Save to reading list'}: ${url}`} title={existing ? 'Open reading item' : 'Save to reading list'} disabled={busy} onClick={() => void bookmark()}>{busy ? <LoaderCircle size={15} className="spin"/> : existing ? <BookmarkCheck size={16}/> : <Bookmark size={16}/>}</button>}{error && <span role="alert" className="inline-error">{error}</span>}</>;
}
export function ReadingSettings() {
  const state = useApp(), { run, error } = useReadingAction();
  return <section className="settings-card"><div className="settings-icon"><Download size={22}/></div><div><h2>Offline reading</h2><label className="reading-setting"><input type="checkbox" checked={state.snapshot.reading?.autoDownload ?? true} onChange={e => run(() => readingChange(crypto.randomUUID(), { kind: 'settings', autoDownload: e.target.checked }))}/> Automatically download unread articles</label><p>Article text is saved on this device when Herts is reachable. Marking an item read removes its download; other devices clean up when they next sync.</p><p className="subtle-note">Some websites only provide an excerpt. Open the original link if the saved article is incomplete.</p>{error && <p className="inline-error" role="alert">{error}</p>}</div></section>;
}
