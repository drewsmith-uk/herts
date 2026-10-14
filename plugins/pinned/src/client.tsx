import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, Pin, PinOff } from 'lucide-react';
import * as sdk from '@herts/plugin-api/client';
import type { ClientPlugin, ConversationActionProps } from '@herts/plugin-api/client';
import { identities, matchingPin, pinRoute, type PinMetadata, type PinRecord } from './model';

const ID = 'pinned', path = '/plugins/pinned';
const { Button, ButtonLink, EmptyState, ItemList, ItemRow, PageHeader, SearchField, StatusMessage, useListState, useUpdateWork } = sdk;
const message = (error: unknown) => error instanceof Error ? error.message : 'Pinned notifications could not be loaded.';
function createStore() {
  const service = sdk.pluginNotifications<PinMetadata>(ID);
  let state = { rows: [] as PinRecord[], loading: true, checking: true, error: '', compatibility: '', permission: 'default' };
  const listeners = new Set<() => void>();
  let alive = true, readVersion = 0, checkVersion = 0;
  const publish = (patch: Partial<typeof state>) => { if (!alive) return; state = { ...state, ...patch }; for (const listener of listeners) listener(); };
  const permission = () => 'Notification' in window ? Notification.permission : 'unsupported';
  async function check() {
    const version = ++checkVersion;
    publish({ checking: true, permission: permission() });
    try { await service.ready(); if (version === checkVersion) publish({ checking: false, compatibility: '' }); }
    catch (error) { if (version === checkVersion) publish({ checking: false, compatibility: message(error) }); }
  }
  async function reload() {
    const version = ++readVersion;
    try { const rows = await service.list(); if (version === readVersion) { publish({ rows, loading: false, error: '' }); void updateTitles(); } }
    catch (error) { if (version === readVersion) publish({ loading: false, error: message(error) }); }
  }
  let updating = false, updateAgain = false;
  const attempted = new Set<string>();
  async function updateTitles() {
    if (updating) { updateAgain = true; return; }
    updating = true;
    do {
      updateAgain = false;
      for (const row of state.rows) {
        if (!alive || state.compatibility) continue;
        const title = (row.metadata.contextId && sdk.getConversationTitle(row.metadata.contextId, row.route)) || row.title;
        const attempt = JSON.stringify([row.key, row.revision, title]);
        if ((title === row.title && row.body === 'Pinned') || attempted.has(attempt)) continue;
        attempted.add(attempt);
        try { await service.set({ ...row, title, body: 'Pinned' }, row.revision); }
        catch (error) { if (alive) publish({ error: message(error) }); }
      }
    } while (alive && updateAgain);
    updating = false;
  }
  return {
    service, get: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    reload: async () => { attempted.clear(); await reload(); await check(); void updateTitles(); },
    start() {
      const stop = service.watch(() => { void reload(); }, error => { readVersion++; publish({ loading: false, error: message(error) }); });
      const stopCore = sdk.subscribeCore(() => { void updateTitles(); });
      void check();
      const visible = () => { if (document.visibilityState === 'visible') publish({ permission: permission() }); };
      const controller = () => { void check(); };
      document.addEventListener('visibilitychange', visible);
      navigator.serviceWorker?.addEventListener('controllerchange', controller);
      return () => { alive = false; stop(); stopCore(); document.removeEventListener('visibilitychange', visible); navigator.serviceWorker?.removeEventListener('controllerchange', controller); };
    },
    async permit() { await service.requestPermission(); publish({ permission: permission() }); },
  };
}
type PinStore = ReturnType<typeof createStore>;
function usePins(store: PinStore) { return useSyncExternalStore(store.subscribe, store.get); }

function PinAction({ store, ...props }: ConversationActionProps & { store: PinStore }) {
  const state = usePins(store), ids = identities(props), pin = matchingPin(state.rows, ids);
  const title = props.suggestedTitle || props.conversation.title;
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const work = useUpdateWork(), operating = useRef(false);
  const route = pinRoute(props.context?.id);
  const pinRevision = pin?.revision;
  useEffect(() => {
    if (!pin || pin.route !== route || pin.title === title || busy || error || state.compatibility) return;
    if (pin.metadata.contextId && sdk.getConversationTitle(pin.metadata.contextId, pin.route)) return;
    let alive = true;
    void work(store.service.set({ ...pin, title, metadata: { identities: [...new Set([...pin.metadata.identities, ...ids])], contextId: props.context?.id || pin.metadata.contextId } }, pin.revision))
      .catch(reason => { if (alive) setError(message(reason)); });
    return () => { alive = false; };
  }, [pinRevision, title, route, busy, error, state.compatibility]);
  async function toggle() {
    if (operating.current) return;
    operating.current = true; setBusy(true); setError('');
    try {
      if (pin) await work(store.service.remove(pin.key));
      else {
        await store.permit();
        const current = matchingPin(await store.service.list(), ids);
        if (!current) await work(store.service.set({
          key: props.context?.link?.key || props.conversation.key || props.context!.id,
          title, body: 'Pinned', route, restoreOnDismiss: true,
          metadata: { identities: ids, contextId: props.context?.id },
        }, null));
      }
    } catch (reason) { setError(message(reason)); }
    finally { await store.reload(); operating.current = false; setBusy(false); }
  }
  const problem = error || state.error || state.compatibility || pin?.displayError;
  return <><sdk.IconButton aria-pressed={!!pin} aria-label={pin ? 'Unpin notification' : 'Pin notification'}
    title={pin ? 'Unpin notification' : 'Pin notification'} disabled={busy || state.loading || state.checking || !!state.compatibility || !!state.error}
    onClick={() => void toggle()}>{pin ? <PinOff size={16}/> : <Pin size={16}/>}</sdk.IconButton>
    {problem && <ButtonLink className="icon-button" aria-label={`Open Pinned: ${problem}`} title={problem} href={`#${path}`}><AlertTriangle size={16}/></ButtonLink>}
  </>;
}

function PinnedScreen({ store }: { store: PinStore }) {
  const state = usePins(store), [query, setQuery] = useListState('pinned:query', '');
  const [working, setWorking] = useState(''), [error, setError] = useState('');
  const work = useUpdateWork(), operating = useRef(false);
  const rows = state.rows.filter(row => row.title.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => b.createdAt - a.createdAt);
  async function run(row: PinRecord, remove: boolean) {
    if (operating.current) return;
    operating.current = true; setWorking(row.key); setError('');
    try {
      if (remove) await work(store.service.remove(row.key));
      else { await store.permit(); await work(store.service.retry(row.key)); }
    } catch (reason) { setError(message(reason)); }
    finally {
      await store.reload(); operating.current = false; setWorking('');
      if (remove) requestAnimationFrame(() => (document.querySelector<HTMLElement>('.pinned-list button') || document.querySelector<HTMLElement>('input[aria-label="Search pinned notifications"]'))?.focus());
    }
  }
  return <><PageHeader title="Pinned" count={state.rows.length}/>
    <SearchField label="Search pinned notifications" value={query} onChange={setQuery}/>
    {state.permission !== 'granted' && !state.rows.some(row => row.displayError) && <StatusMessage tone="warning">{state.permission === 'unsupported' ? 'Notifications are unavailable in this browser.' : 'Allow notifications in browser settings.'}</StatusMessage>}
    {(error || state.error || state.compatibility) && <StatusMessage>{error || state.error || state.compatibility} <Button disabled={!!working} onClick={() => { setError(''); void store.reload(); }}>Check again</Button></StatusMessage>}
    {state.loading && <p role="status">Loading pinned notifications…</p>}
    <ItemList className="pinned-list" style={{ marginTop: 'var(--section-gap)' }}>{rows.map(row => <ItemRow key={row.key} trailing={
      <sdk.IconButton title="Unpin" aria-label={`Unpin: ${row.title}`} aria-busy={working === row.key} disabled={!!working || !!state.compatibility} onClick={() => void run(row, true)}><PinOff size={16}/></sdk.IconButton>
    }><a href={`#${row.route}`} className="draft-open" title={row.title}><h2 className="item-title item-title--clamped">{row.title}</h2></a>
      {row.displayError && <StatusMessage>{row.displayError} <Button disabled={!!working || !!state.compatibility} onClick={() => void run(row, false)}>Retry</Button></StatusMessage>}
    </ItemRow>)}</ItemList>
    {!state.loading && !state.error && !rows.length && <EmptyState icon={<Pin size={30}/>} title={query ? 'No pins match this search' : 'No pinned notifications'}
      description={query ? undefined : 'Pin a conversation or task.'}><ButtonLink href="#/conversations">Open Conversations</ButtonLink></EmptyState>}
  </>;
}

export default function activate(): ClientPlugin {
  if (!sdk.pluginNotifications || !sdk.SearchField || !sdk.getConversationTitle || !sdk.subscribeCore) return { tab: { title: 'Pinned', path, icon: Pin }, routes: [{ match: route => route === path, component: () => <p>Update Herts through Settings → App updates to use Pinned.</p> }] };
  const store = createStore();
  return { tab: { title: 'Pinned', path, icon: Pin }, routes: [{ match: route => route === path, component: () => <PinnedScreen store={store}/> }],
    ConversationActions: props => <PinAction {...props} store={store}/>, start: store.start };
}
