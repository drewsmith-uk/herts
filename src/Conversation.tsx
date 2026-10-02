import { createPortal } from 'react-dom';
import { MessageComposer } from './MessageComposer';
import { outgoingInHistory, outgoingStatus, liveReplyReplacement, type OutgoingMessage } from './transcriptFeedback';
import type { ConversationContext } from '../shared/conversations';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, Square, RefreshCw, Volume2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MessageMedia } from './Media';
import { MessageBoundary } from './MessageBoundary';
import { useConversationHistory } from './useConversationHistory';
import { activitySummary, groupHistory, type HistoryEntry, type HistoryGroup } from './historyGroups';
import { backgroundResultLabel } from '../shared/messagePresentation';
import { HistoryDisclosure } from './HistoryDisclosure';
import { Clarification } from './Clarification';
import { ConversationActivity } from './ConversationActivity';
import { useUpdateWork } from './updateSafety';
import { messageText, type Action, type History } from '../shared/core';
import { useApp, submit, api, cacheRead, saveSessionChoices } from './data';
import { ConversationContributions, MessageLinkContributions } from './plugins';

const messageTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
function MessageTime({ timestamp }: { timestamp?: number }) {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) return null;
  const date = new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  return <time className="message-time" dateTime={date.toISOString()} title={date.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' })}>{messageTimeFormat.format(date)}</time>;
}
const finished = (a?: Action) => !!a && ['finished','failed','ready','unknown'].includes(a.state);

export function ConversationPanel({ context: task, initialText = '', showActions = true, showHeading = true, readOnly = false, saveDraftAction }: { context: ConversationContext; initialText?: string; showActions?: boolean; showHeading?: boolean; showEmptyNotice?: boolean; readOnly?: boolean; saveDraftAction?: () => void }) {
  const state = useApp(); const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [statusHost, setStatusHost] = useState<HTMLDivElement | null>(null), [savedHost, setSavedHost] = useState<HTMLDivElement | null>(null);
  const main = state.actions.find(a => !a.cancelled && a.taskId === task.id && ['send','continue'].includes(a.kind)); const binding = state.bindings[task.id];
  const active = !!main && !finished(main) && !binding?.unavailable; const [historyVersion, setHistoryVersion] = useState(0), [sendVersion, setSendVersion] = useState(0);
  const send = state.actions.find(a => !a.cancelled && a.taskId === task.id && a.kind === 'send');
  const local = state.outgoing.filter(s => s.taskId === task.id && !state.actions.some(a => a.id === s.id && a.cancelled)).sort((a,b) => b.at - a.at)[0];
  const latestOutgoing: OutgoingMessage | undefined = local && (!send || local.id === send.id || local.at > send.createdAt) ? local : send ? { id: send.id, taskId: task.id, text: send.text, uploadIds: send.uploadIds, at: send.createdAt } : undefined;
  const outgoingAction = state.actions.find(a => a.id === latestOutgoing?.id);
  const outgoing = outgoingAction?.savedMessageDeletedAt ? undefined : latestOutgoing;
  const historyChange = `${historyVersion}:${main?.id}:${main?.sendStage}:${main?.receipt}:${main?.state}:${main?.phase}:${main?.terminal}`;
  useEffect(() => { if (main?.terminal || main?.state === 'finished') setHistoryVersion(v => v + 1); }, [main?.terminal, main?.state]);
  async function control(kind: Action['kind'], approvalId?: string, text?: string, answers?: Record<string, string>) {
    setBusy(true); setError(''); try { await submit({ id: crypto.randomUUID(), contextId: task.id, kind, generation: binding?.generation, targetId: main?.id, ...(approvalId ? { approvalId } : {}), ...(text ? { text } : {}), ...(answers ? { answers } : {}) }); } catch(e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const uncertainControls = state.actions.filter(a => a.taskId === task.id && !['send','continue'].includes(a.kind) && a.receipt === 'unknown');
  const failedControls = state.actions.filter(a => a.targetId === main?.id && a.receipt === 'rejected' && a.kind !== 'send' &&
    !(binding?.unavailable && (a.errorCode === 4001 || a.error?.trim().toLowerCase() === 'session not found')));
  const failedControlErrors = [...new Set(failedControls.map(a => a.error).filter(Boolean))];
  const answered = (id: string) => state.actions.some(a => a.targetId === main?.id && a.approvalId === id && a.receipt !== 'rejected');
  const modelConfirmation = !main?.savedMessageDeletedAt && !!main?.settings?.confirmation && state.snapshot.sessionSettings?.conversations[task.id]?.revision === main.settings.revision;
  const needsInput = active && (main.state === 'awaiting_input' || !!main.approvals?.length || !!main.clarification);
  const attention = !!(needsInput || main?.promptWarning || failedControls.length || main?.error || main?.state === 'failed' || main?.state === 'unknown' || main?.receipt === 'unknown' || uncertainControls.length || error || modelConfirmation);
  const statusLabel = needsInput ? 'Needs your input' : modelConfirmation ? 'Confirm model switch' : attention ? main?.sendStage === 'preparing' || main?.receipt === 'rejected' ? 'Message not sent' : main?.state === 'failed' ? 'Conversation failed' : 'Check conversation' : main?.state === 'stopping' ? 'Stopping…' : main?.phase === 'stopped' ? 'Stopped' : main?.state === 'preparing' ? 'Preparing…' : `Working${main?.phase && !['working','streaming'].includes(main.phase) ? ` · ${main.phase}` : '…'}`;
  return <section className="conversation-panel" data-phase={main?.phase || 'idle'}>
    <div className="conversation-scroll" tabIndex={0} aria-label="Conversation messages">
    {showActions&&<ConversationContributions context={task}/>}
    {showHeading && <div className="conversation-heading"><span><MessageSquare size={17}/> Conversation</span></div>}
    <HistoryView conversationId={task.link?.storedId || ''} version={historyChange} liveText={main?.liveText} working={active} phase={main?.phase} outgoing={outgoing} outgoingAction={outgoingAction} sendVersion={sendVersion}/>
    {(active || attention || main?.phase === 'stopped') && <ConversationActivity statusHost={statusHost} label={statusLabel} active={active} attention={attention} stopping={main?.state === 'stopping'} disabled={busy || !state.online || !state.gateway.online || !binding} onStop={() => void control('stop')} onLatest={() => setSendVersion(v => v + 1)}>
      {attention && <>
        {main?.error && !modelConfirmation && <p className="inline-error" role="alert">{main.error}</p>}
        {!main?.error && main?.state === 'failed' && <p className="inline-error" role="alert">Hermes reported that this run failed.</p>}
        {!main?.error && main?.state === 'unknown' && <p className="inline-error" role="alert">The current outcome could not be confirmed.</p>}
        {main?.promptWarning && <p className="inline-error" role="alert">{main.promptWarning}</p>}
        {failedControlErrors.map(message => <p key={message} className="inline-error" role="alert">{message}</p>)}
        {main?.receipt === 'unknown' && <p>The request will not be repeated automatically.</p>}
        {active && main?.approvals?.map(p => <div className="approval" key={p.request_id}><p>{p.description || 'Allow this action?'}</p>{p.command && <pre>{p.command}</pre>}<div className="button-row"><button className="primary-button" disabled={busy || !state.online || !state.gateway.online || answered(p.request_id) || (p.choices !== undefined && !p.choices.includes('once'))} onClick={() => void control('approve', p.request_id)}>Approve once</button><button disabled={busy || !state.online || !state.gateway.online || answered(p.request_id) || (p.choices !== undefined && !p.choices.includes('deny'))} onClick={() => void control('deny', p.request_id)}>Deny</button></div></div>)}
        {active && main?.clarification && <Clarification key={main.clarification.request_id} question={main.clarification} disabled={busy || !state.online || !state.gateway.online || answered(main.clarification.request_id)} onAnswer={(answer, answers) => void control('clarify', main.clarification.request_id, answer, answers)}/>}
        {uncertainControls.map(a => <p className="error-banner" key={a.id}>Your {a.kind === 'stop' ? 'stop request' : a.kind === 'clarify' ? 'answer' : 'decision'} was not confirmed. Refresh to check current state; it will not be repeated.</p>)}
        {error && <p className="inline-error" role="alert">{error}</p>}
        {modelConfirmation && main && <ModelSwitchConfirmation action={main}/>}
      </>}
    </ConversationActivity>}
    <div ref={setSavedHost}/>
    </div><div className="conversation-control-slot" ref={setStatusHost}/>{readOnly ? <div className="composer-placeholder" role="status">{state.online ? 'Opening message controls…' : 'Connect once to enable messaging for this conversation.'}</div> : <MessageComposer key={task.id} savedMessagesHost={savedHost} docked={!!task.link} context={task} saveLabel={saveDraftAction ? 'Save draft' : undefined} onSaved={saveDraftAction} initialText={initialText} canSend={state.online && state.gateway.online && !active} onSending={() => setSendVersion(v => v + 1)} onSent={() => { setHistoryVersion(v => v + 1); }}/>}
  </section>;
}
function ModelSwitchConfirmation({ action }: { action: Action }) {
  const state = useApp(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const work = useUpdateWork();
  async function choose(accept: boolean) {
    if (busy) return; setBusy(true); setError('');
    try {
      if (accept) await submit({ id: crypto.randomUUID(), contextId: action.taskId, kind: 'send', text: action.text, uploadIds: action.uploadIds, settingsConfirmation: action.id });
      else await saveSessionChoices(action.taskId, action.settings!.revision, {});
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="error-banner" role="alert"><strong>Confirm model switch</strong><p>{action.settings!.confirmation}</p><p>Your message is saved and has not been sent.</p><div className="button-row"><button disabled={busy || !state.gateway.online} onClick={() => void work(choose(true))}>Switch and send saved message</button><button disabled={busy} onClick={() => void work(choose(false))}>Keep current settings</button></div>{error && <p>{error}</p>}</section>;
}


export function HistoryView({ conversationId, version = 0, liveText, working = false, phase, outgoing, outgoingAction, sendVersion = 0 }: { conversationId: string; version?: number | string; liveText?: string; working?: boolean; phase?: string; outgoing?: OutgoingMessage; outgoingAction?: Action; sendVersion?: number }) {
  const feedback = `${outgoing?.id}:${outgoingStatus(outgoingAction)}:${working}:${version}`;
  const { pages, cached, busy, error, setError, newMessages, latest, refresh, older, root, end, pauseFollowing } = useConversationHistory(conversationId, version, liveText, working, sendVersion, feedback);
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);
  useEffect(() => { setToolbar(root.current?.closest('.conversation-panel')?.parentElement?.querySelector<HTMLElement>('.conversation-toolbar') || null); }, []);
  const confirmed = useRef(new Set<string>());
  if (outgoing && outgoingInHistory(outgoing, pages)) confirmed.current.add(outgoing.id);
  const showOutgoing = outgoing && !confirmed.current.has(outgoing.id);
  const previousGroups = useRef<HistoryGroup[]>([]);
  const groups = useMemo(() => previousGroups.current = groupHistory(pages, previousGroups.current), [pages]);
  const lastAssistant = pages.flatMap(p => p.messages).findLast(m => m.role === 'assistant' && messageText(m).trim());
  const replaceReply = liveReplyReplacement(pages, liveText, outgoing);
  const showLive = !replaceReply && liveText && messageText(lastAssistant || { role: 'assistant' }).trim() !== liveText.trim();
  const [speaking, setSpeaking] = useState<string | null>(null);
  const playback = useRef(0); const audio = useRef<HTMLAudioElement | null>(null); const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; playback.current++; audio.current?.pause(); }, []);
  async function speak(m: any, page: History, index: number) {
    const generation = ++playback.current; const id = `${page.offset}:${index}`; if (speaking === id) { audio.current?.pause(); setSpeaking(null); return; }
    audio.current?.pause(); setSpeaking(id); setError('');
    try {
      const text = messageText(m); const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(n => n.toString(16).padStart(2,'0')).join('');
      const data = await cacheRead(`speech:${conversationId}:${hash}`, () => api('/audio/speak', { conversationId, ...(m.id === undefined ? {} : { messageId: m.id }), offset: page.offset, order: page.order || 'oldest', index, text }));
      if (!mounted.current || generation !== playback.current) return; const a = new Audio(data.value.data_url); audio.current = a; a.onended = () => setSpeaking(null); await a.play();
    } catch(e) { if (mounted.current && generation === playback.current) { setError((e as Error).message); setSpeaking(null); } }
  }
  const speakRef = useRef(speak); speakRef.current = speak;
  const onSpeak = useCallback((message: any, page: History, index: number) => { void speakRef.current(message, page, index); }, []);
  function renderMessage(entry: HistoryEntry) { if (entry.key === replaceReply) entry = { ...entry, message: { ...entry.message, content: liveText } }; return <MessageBoundary key={entry.key} revision={JSON.stringify(entry.message)}><HistoryMessage entry={entry} conversationId={conversationId} speaking={speaking === `${entry.page.offset}:${entry.index}`} onSpeak={onSpeak} pauseFollowing={pauseFollowing}/></MessageBoundary>; }
  const refreshButton = <button className="icon-button history-refresh" aria-label="Refresh conversation history" disabled={busy || !conversationId} onClick={() => void refresh()}><RefreshCw size={15} className={busy ? 'spin' : ''}/></button>;
  return <div className="history" ref={root}>{(cached || !toolbar) && <div className="history-note">{cached && <span role="status">Showing saved messages</span>}{!toolbar && refreshButton}</div>}{toolbar && createPortal(refreshButton, toolbar)}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {pages[0]?.hasMore && <button className="load-more" disabled={busy} onClick={() => void older()}>{busy ? 'Loading…' : 'Load older messages'}</button>}
    {groups.map(group => group.kind === 'message' ? renderMessage(group.entry) : <HistoryDisclosure key={group.key} activityKey={group.key} label={<><span className="hermes-mark">H</span><span>Hermes activity</span><span className="activity-count">{activitySummary(group)}</span></>} onInteract={pauseFollowing}>{group.entries.map(renderMessage)}</HistoryDisclosure>)}
    {showOutgoing && <OutgoingFeedback message={outgoing} action={outgoingAction}/>}
    {showLive && <article className="message live-message"><div className="message-author"><span className="hermes-mark">H</span>Hermes </div><div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <MessageLinkContributions href={href} conversationId={conversationId}>{children}</MessageLinkContributions>, img: ({alt}) => <span>[{alt || 'Image'}]</span> }}>{liveText}</ReactMarkdown></div></article>}
    {!pages.some(p => p.messages.length) && !outgoing && !liveText && !busy && !error && <p className="history-empty">No messages are available yet.</p>}
    {newMessages && <button className="history-latest" onClick={() => void latest()}>Show latest messages</button>}
    <div ref={end}/>
  </div>;
}
function OutgoingFeedback({ message, action }: { message: OutgoingMessage; action?: Action }) {
  return <article className="message from-user outgoing-message" data-outgoing-id={message.id}><div className="message-author">You <span className="submission-status">{outgoingStatus(action)}</span></div>{message.text && <div className="outgoing-text">{message.text}</div>}{message.uploadIds.length > 0 && <div className="subtle-note">{message.uploadIds.length} attachment{message.uploadIds.length === 1 ? '' : 's'}</div>}</article>;
}

const HistoryMessage = memo(function HistoryMessage({ entry: { key: entryKey, message: m, page, index }, conversationId, speaking, onSpeak, pauseFollowing }: {
  entry: HistoryEntry; conversationId: string; speaking: boolean; onSpeak: (message: any, page: History, index: number) => void; pauseFollowing: () => void;
}) {
    const text = messageText(m), background = backgroundResultLabel(m), assistant = !background && m.role === 'assistant';
    return <article className={`message ${!background && m.role === 'user' ? 'from-user' : ''} ${m.role === 'tool' ? 'tool-message' : ''}`} key={entryKey} data-history-message={entryKey}>
      <div className="message-author">{background ? <><span className="hermes-mark">H</span>{background}</> : assistant ? <><span className="hermes-mark">H</span>Hermes</> : m.role === 'user' ? 'You' : 'Tool output'}<MessageTime timestamp={m.timestamp}/>{assistant && text.trim() && <button className="read-aloud icon-button" aria-label={speaking ? 'Stop reading aloud' : 'Read response aloud'} title="Read response aloud" onClick={() => onSpeak(m, page, index)}>{speaking ? <Square size={15}/> : <Volume2 size={16}/>}</button>}</div>
      {m.role === 'tool' ? <HistoryDisclosure label="View tool output" onInteract={pauseFollowing}><pre>{text || 'No output.'}</pre></HistoryDisclosure> : <div className="markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <MessageLinkContributions href={href} conversationId={conversationId}>{children}</MessageLinkContributions>, img: ({ alt }) => <span className="attachment-placeholder">[{alt || 'Image attachment'}]</span> }}>{text}</ReactMarkdown>
        <MessageMedia message={m} conversationId={conversationId} offset={page.offset} index={index} order={page.order || 'oldest'}/>
        {!!m.tool_calls?.length && <HistoryDisclosure label={`${m.tool_calls.length} tool call${m.tool_calls.length === 1 ? '' : 's'}`} onInteract={pauseFollowing}><pre>{JSON.stringify(m.tool_calls, null, 2)}</pre></HistoryDisclosure>}
      </div>}
    </article>;
}, (a, b) => a.conversationId === b.conversationId && a.speaking === b.speaking && a.entry.key === b.entry.key && a.entry.page.offset === b.entry.page.offset && a.entry.page.order === b.entry.page.order && a.entry.index === b.entry.index && JSON.stringify(a.entry.message) === JSON.stringify(b.entry.message));
