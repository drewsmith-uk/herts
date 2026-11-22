import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Phone } from 'lucide-react';
import * as sdk from '@herts/plugin-api/client';
import type { ClientPlugin, ConversationActionProps, RouteProps } from '@herts/plugin-api/client';
import type { VoiceLiveStatus } from '@herts/plugin-api/types';
import { isLive, transcriptTurns, type CallRecord } from './controller';
import { callRoute, createCallStore, type CallStore } from './store';

const { Button, ButtonLink, ActionRow, ConversationView, StatusMessage, EmptyState, DialogFrame, DialogHeading, SessionBar, SettingsSection, SettingRow } = sdk;
const labels = { starting: 'Starting call', active: 'Call in progress', closing: 'Ending call', ended: 'Call ended', failed: 'Call failed', unconfirmed: 'Closure unconfirmed' };
const useCalls = (store: CallStore) => useSyncExternalStore(store.subscribe, store.get);

function CallAction({ store, context, conversation }: ConversationActionProps & { store: CallStore }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const open = async () => {
    setBusy(true); setError('');
    try {
      if (!context?.link) await sdk.openConversation(conversation.id);
      const target = context?.link ? context : sdk.contextForConversation(conversation.id, conversation.aliases);
      if (!target?.link) throw new Error('The conversation could not be opened. Retry.');
      location.hash = callRoute(target.id);
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  };
  if (context && (!context.link || location.hash === `#${callRoute(context.id)}`)) return null;
  return <><ActionRow icon={<Phone size={20}/>} disabled={busy} onClick={() => void open()}>Call</ActionRow>{error && <p role="alert">{error}</p>}</>;
}

function LiveControls({ store, record }: { store: CallStore; record: CallRecord }) {
  return <>
    {record.state === 'active' && <Button aria-pressed={record.muted} onClick={() => store.controller.mute()}>{record.muted ? 'Unmute' : 'Mute'}</Button>}
    <Button variant="danger" onClick={() => store.controller.end()} disabled={record.state === 'closing'}>End call</Button>
  </>;
}

function GlobalStatus({ store }: { store: CallStore }) {
  const { record } = useCalls(store);
  const [route, setRoute] = useState(location.hash);
  useEffect(() => { const changed = () => setRoute(location.hash); window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed); }, []);
  sdk.useUpdatePreparation({ pause: () => store.controller.end(false, 'update'), settle: () => store.prepareUpdate() });
  if (!record || !isLive(record.state) || route === `#${callRoute(record.contextId)}`) return null;
  return <SessionBar title={record.title} status={labels[record.state]}>
    <ButtonLink href={`#${callRoute(record.contextId)}`}>Return to call</ButtonLink>
    <LiveControls store={store} record={record}/>
  </SessionBar>;
}

function Transcript({ record, close }: { record?: CallRecord; close(): void }) {
  const scroll = useRef<HTMLDivElement>(null), following = useRef(true);
  const [error, setError] = useState('');
  const turns = transcriptTurns(record?.transcript || []);
  const unsent = record?.requests.filter(request => request.state === 'unsent') || [];
  useLayoutEffect(() => {
    if (following.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [record]);
  return <DialogFrame size="wide" close={close} aria-labelledby="call-transcript-title">
    <DialogHeading id="call-transcript-title" close={close}>Transcript</DialogHeading>
    <div className="call-transcript-scroll" ref={scroll} onScroll={event => {
      const node = event.currentTarget;
      following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 32;
    }}>
      {unsent.length > 0 && <section aria-label="Unsent requests"><h3>Unsent requests</h3>
        {unsent.map(request => <div key={request.id}><p className="call-transcript">{request.text || 'No transcript available'}</p><Button disabled={!request.text} onClick={() => {
          void navigator.clipboard.writeText(request.text).catch(() => setError('Copy failed. Select and copy the request text.'));
        }}>Copy request</Button></div>)}
      </section>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {turns.length ? turns.map((turn, index) => <div className="call-turn" key={index}><strong>{turn.speaker === 'user' ? 'You' : 'Voice'}</strong><p className="call-transcript">{turn.text}</p></div>) : <p>No transcript yet.</p>}
    </div>
  </DialogFrame>;
}

function CallSettings({ store }: { store: CallStore }) {
  const call = useCalls(store), core = sdk.useCore();
  const [status, setStatus] = useState<VoiceLiveStatus>(), [loading, setLoading] = useState(true);
  const [statusError, setStatusError] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [attempt, setAttempt] = useState(0);
  const contextId = isLive(call.record?.state) ? call.record?.contextId : undefined;
  const profile = contextId ? call.record!.profile : core.gateway.profile;
  useEffect(() => {
    let current = true;
    setStatus(undefined); setStatusError(''); setLoading(true);
    if (!core.online || !core.gateway.online) { setLoading(false); return; }
    void sdk.pluginQuery('calls', 'status', contextId ? { contextId } : {}).then(value => {
      if (current) { setStatus(value); setLoading(false); }
    }, () => { if (current) { setStatusError('Voice status could not be loaded. Select Retry.'); setLoading(false); } });
    return () => { current = false; };
  }, [contextId, profile, core.online, core.gateway.online, attempt]);
  const change = async (run: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await run(); } catch { setError('Call settings could not be saved. Try the control again.'); }
    finally { setBusy(false); }
  };
  if (!call.loaded) return <StatusMessage tone="notice">Loading call settings…</StatusMessage>;
  return <>
    <SettingsSection title="Preferences" icon={<Phone size={20}/>}>
      <SettingRow label="Call notifications" htmlFor="calls-notices" control={<Button id="calls-notices" aria-label="Call notifications" aria-pressed={call.notices} disabled={busy} onClick={() => void change(() => call.notices ? store.disableNotices() : store.permit())}>{call.notices ? 'On' : 'Off'}</Button>}/>
      <SettingRow label="Connection sounds" htmlFor="calls-sounds" control={<Button id="calls-sounds" aria-label="Connection sounds" aria-pressed={call.sounds} disabled={busy} onClick={() => void change(() => store.setSounds(!call.sounds))}>{call.sounds ? 'On' : 'Off'}</Button>}/>
      {error && <StatusMessage>{error}</StatusMessage>}
      {call.notificationError && <StatusMessage>{call.notificationError} <Button disabled={busy} onClick={() => { if (call.notices) store.retryNotice(); else void change(() => store.permit()); }}>Retry notification</Button></StatusMessage>}
    </SettingsSection>
    <SettingsSection title="Configured in Hermes">
      <SettingRow label="Hermes profile" htmlFor="calls-profile" control={<output className="setting-value" id="calls-profile">{profile || 'default'}</output>}/>
      {loading ? <StatusMessage tone="notice">Loading voice configuration…</StatusMessage> : <>
        <SettingRow label="Voice" htmlFor="calls-voice" control={<output className="setting-value" id="calls-voice">{status?.voice || 'Unavailable'}</output>}/>
        <SettingRow label="Model" htmlFor="calls-model" control={<output className="setting-value" id="calls-model">{status?.model || 'Unavailable'}</output>}/>
      </>}
      {(statusError || !core.online || !core.gateway.online) && <StatusMessage>{statusError || 'Hermes is unavailable. Reconnect, then select Retry.'} <Button onClick={() => { setAttempt(value => value + 1); void sdk.refresh(); }}>Retry</Button></StatusMessage>}
    </SettingsSection>
  </>;
}

function CallScreen({ store, parts }: RouteProps & { store: CallStore }) {
  const core = sdk.useCore(), call = useCalls(store);
  const id = parts.at(-1) || '';
  const context = core.snapshot.contexts.find(context => context.id === id);
  const record = call.record?.contextId === id ? call.record : undefined;
  const [status, setStatus] = useState<VoiceLiveStatus>(), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0), [details, setDetails] = useState(false);
  useEffect(() => {
    let active = true; setLoading(true); setStatus(undefined); setError('');
    if (!context?.link || !core.online || !core.gateway.online) { setLoading(false); return; }
    void sdk.pluginQuery('calls', 'status', { contextId: id }).then(value => {
      if (active) { setStatus(value); setLoading(false); }
    }, () => { if (active) { setLoading(false); setError('Voice status could not be loaded. Select Retry.'); } });
    return () => { active = false; };
  }, [id, !!context?.link, core.online, core.gateway.online, attempt]);
  if (!core.loaded || !call.loaded) return <StatusMessage>Loading call…</StatusMessage>;
  if (!context?.link) return <EmptyState icon={<Phone size={24}/>} description="Open the conversation from Conversations, then retry." title={core.online ? 'Conversation unavailable' : 'Conversation unavailable offline'}>
    <ButtonLink href="#/conversations">Conversations</ButtonLink>
  </EmptyState>;
  const active = isLive(record?.state), other = isLive(call.record?.state) && !record;
  const ready = status?.available && status.mode === 'gpt-live' && core.online && core.gateway.online;
  const retry = () => { setAttempt(value => value + 1); void sdk.refresh(); };
  const conversationHref = `#/conversation/${encodeURIComponent(context.link.storedId)}`;
  const callStatus = record ? labels[record.state] : other ? 'Another call is open' : loading ? 'Checking voice…' : ready ? 'Ready to call' : 'Call unavailable';
  const problem = error || call.error || record?.error;
  return <>
    <ConversationView id={context.id} backHref={conversationHref} backLabel="Conversation" className="calls-screen" actions={<Button onClick={() => setDetails(true)}>Transcript</Button>}>
      <SessionBar status={<>{callStatus}{record?.endReason === 'background' && <div className="call-status-detail">App in background</div>}</>}>
        {active && record ? <LiveControls store={store} record={record}/> : <Button variant="primary" disabled={!ready || other || loading} onClick={() => void store.begin(context)}>{record ? 'Call again' : 'Start call'}</Button>}
      </SessionBar>
      {(!core.online || !core.gateway.online) ? <StatusMessage className="call-recovery">Hermes is unavailable. Reconnect, then select Retry. <Button onClick={retry}>Retry</Button></StatusMessage>
        : error ? <StatusMessage className="call-recovery">{error} <Button onClick={retry}>Retry</Button></StatusMessage>
        : status && !ready && <StatusMessage className="call-recovery">Configure GPT-Live for this Hermes profile, then retry. <Button onClick={retry}>Retry</Button></StatusMessage>}
      {problem && !error && <StatusMessage className="call-recovery">{problem}{record?.state === 'unconfirmed' && <ButtonLink href={conversationHref}>Review conversation</ButtonLink>}</StatusMessage>}
    </ConversationView>
    {details && <Transcript record={record} close={() => setDetails(false)}/>}
    <style>{`.call-status-detail{color:var(--color-text-secondary);font-size:var(--text-secondary)}.call-recovery{flex-shrink:0;max-height:22dvh;overflow:auto;margin-block:8px}.call-recovery .ui-button{margin-inline-start:8px}.call-transcript-scroll{max-height:65dvh;overflow:auto;padding:16px;overflow-anchor:none}.call-transcript{white-space:pre-wrap;overflow-wrap:anywhere;margin-block:4px 0}.call-turn+.call-turn{margin-top:24px}.call-turn strong{font-size:var(--text-secondary)}.calls-screen h1{overflow-wrap:anywhere}@media(max-height:600px){.calls-screen:has(.composer-docked.is-expanded) .conversation-scroll{min-height:0;padding-block:0}}`}</style>
  </>;

}

export default function activate(): ClientPlugin {
  if (sdk.voiceLiveClientVersion !== 1 || !sdk.SessionBar || !sdk.voiceLiveGreeting || !sdk.ConversationView) {
    const Update = () => <StatusMessage>Calls requires a newer Herts browser app. Open Settings → App updates. <ButtonLink href="#/settings">Settings</ButtonLink></StatusMessage>;
    return { routes: [{ match: path => path.startsWith('/plugins/calls/'), component: Update }], ConversationActions: Update };
  }
  const store = createCallStore();
  return {
    routes: [{ match: path => /^\/plugins\/calls\/[a-f0-9-]{36}$/.test(path), component: props => <CallScreen {...props} store={store}/> }],
    ConversationActions: props => <CallAction {...props} store={store}/>,
    GlobalStatus: () => <GlobalStatus store={store}/>,
    Settings: () => <CallSettings store={store}/>,
    start: () => store.start(),
  };
}
