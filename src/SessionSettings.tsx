import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, Folder, RefreshCw, SlidersHorizontal, X } from 'lucide-react';
import type { ConversationContext } from '../shared/conversations';
import { effectiveSettings, emptySettings, efforts, hasSettings, sameSetting, type Effort, type ModelChoice, type SessionValues, type SettingsView } from '../shared/sessionSettings';
import { api, db, saveSessionChoices, useApp, useSyncedSessionChoices } from './data';
import { useUpdatePreparation, useUpdateWork } from './updateSafety';

const labels: Record<Effort, string> = { none: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' };
const modelKey = (model?: ModelChoice) => model ? JSON.stringify({ id: model.id, provider: model.provider }) : '';
function useSettingsView(contextId?: string) {
  const state = useApp(), [view, setView] = useState<SettingsView>(), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const alive = useRef(true), sequence = useRef(0);
  const refresh = async (force = false) => {
    if (!state.online) return;
    const seq = ++sequence.current; setLoading(true);
    try {
      const query = new URLSearchParams({ ...(contextId ? { contextId } : {}), ...(force ? { refresh: 'true' } : {}) });
      const data: SettingsView = await api(`/session-settings?${query}`, undefined, undefined, 20000);
      if (alive.current && seq === sequence.current) { setView(data); setError(data.error || ''); await db.kv.put({ key: `settings-view:${contextId || 'defaults'}`, value: data }); }
      return data;
    } catch (e) { if (alive.current && seq === sequence.current) setError((e as Error).message); }
    finally { if (alive.current && seq === sequence.current) setLoading(false); }
  };
  useEffect(() => {
    alive.current = true; const seq = sequence.current;
    void db.kv.get(`settings-view:${contextId || 'defaults'}`).then(row => { if (alive.current && seq === sequence.current && row) setView(row.value); });
    return () => { alive.current = false; sequence.current++; };
  }, [contextId]);
  const settings = state.snapshot.sessionSettings || emptySettings();
  const change = `${settings.defaults.revision}:${contextId ? settings.conversations[contextId]?.revision || 0 : ''}:${state.actions.find(a => a.taskId === contextId && a.kind === 'send')?.updatedAt || ''}`;
  useEffect(() => { void refresh(); }, [contextId, state.online, state.gateway.online, change]);
  const merged = view ? { ...view, defaults: settings.defaults, pending: contextId ? settings.conversations[contextId] || { revision: 0, values: {} } : view.pending } : undefined;
  return { view: merged, error, loading, refresh };
}

export function SessionSettingsControls({ context, onOpen }: { context: ConversationContext; onOpen: () => void }) {
  const state = useApp(), { view, error, loading, refresh } = useSettingsView(context.id), [editing, setEditing] = useState(false);
  const local = state.settingsPending?.find(p => p.contextId === context.id), values = view ? effectiveSettings(view, !context.link) : {};
  const pending = hasSettings(view?.pending.values), saving = state.actions.some(a => a.taskId === context.id && a.kind === 'send' && a.receipt === 'pending');
  function open() { onOpen(); setEditing(true); }
  const effort = values.effort ? labels[values.effort] : 'Effort unknown';
  return <div className="session-settings-controls">
    <div className="session-settings-buttons">
      <button type="button" className="session-setting-chip" aria-label="Choose conversation model" disabled={!view || saving} onClick={open}><span>{values.model?.id || (loading ? 'Loading settings…' : 'Model unknown')}</span><ChevronDown size={14}/></button>
      <button type="button" className="session-setting-chip" aria-label="Choose reasoning effort" disabled={!view || saving} onClick={open}>{effort}{view?.wireEffort && !pending && view.wireEffort !== values.effort ? ` → ${view.wireEffort}` : ''}<ChevronDown size={14}/></button>
      <button type="button" className="icon-button" aria-label="Conversation settings" title="Conversation settings" disabled={!view || saving} onClick={open}><SlidersHorizontal size={18}/></button>
    </div>
    <p className="session-settings-note">{pending ? 'Applies on next Send · kept for this conversation' : !context.link ? 'New conversation defaults' : view?.source === 'live' ? 'Current conversation settings' : view?.source === 'saved' ? 'Saved Hermes settings' : 'Current settings are not confirmed'}{local ? ' · Saved on this device' : ''}</p>
    {local?.conflict && <p role="alert" className="inline-error">{local.conflict} <button type="button" className="text-button" onClick={() => void useSyncedSessionChoices(context.id)}>Use synced choices</button><button type="button" className="text-button" onClick={open}>Review choices</button></p>}
    {error && <p className="session-settings-note">{error} <button type="button" className="text-button" disabled={loading} onClick={() => void refresh(true)}>Refresh settings</button></p>}
    {editing && view && <SettingsDialog context={context} initial={view} reload={() => refresh(true)} close={() => setEditing(false)}/>}
  </div>;
}

export function NewConversationDefaults() {
  const state = useApp(), { view, error, loading, refresh } = useSettingsView(), [editing, setEditing] = useState(false);
  const defaults = state.snapshot.sessionSettings?.defaults.values || {}, local = state.settingsPending?.find(p => !p.contextId);
  return <section className="settings-card"><div className="settings-icon"><SlidersHorizontal size={22}/></div><div><h2>New conversation defaults</h2>
    <p>Choose the model, effort, fast mode and working folder for conversations started in Herts. These defaults apply across your devices.</p>
    <p className="subtle-note">Existing conversations keep their settings. Individual conversations can override these defaults.</p>
    <p>{defaults.model?.id || 'Hermes profile model'} · {defaults.effort ? `${labels[defaults.effort]} effort` : 'Hermes profile effort'}{defaults.fast !== undefined ? ` · Fast mode ${defaults.fast ? 'on' : 'off'}` : ''}</p>
    {defaults.cwd && <p className="settings-path">{defaults.cwd}</p>}
    <button disabled={!view} onClick={() => setEditing(true)}>Edit conversation defaults</button>
    {local && <p className="subtle-note">Saved on this device until synced.</p>}
    {local?.conflict && <p role="alert" className="inline-error">{local.conflict} <button className="text-button" onClick={() => void useSyncedSessionChoices()}>Use synced defaults</button></p>}
    {error && <p className="inline-error">{error} <button className="text-button" disabled={loading} onClick={() => void refresh(true)}>Refresh settings</button></p>}
    {editing && view && <SettingsDialog initial={view} reload={() => refresh(true)} close={() => setEditing(false)}/>}
  </div></section>;
}

function SettingsDialog({ context, initial, reload, close }: { context?: ConversationContext; initial: SettingsView; reload: () => Promise<SettingsView | undefined>; close: () => void }) {
  const state = useApp(), dialog = useRef<HTMLDialogElement>(null), [view, setView] = useState(initial);
  const defaults = !context, [values, setValues] = useState<SessionValues>(structuredClone(defaults ? initial.defaults.values : initial.pending.values));
  const [revision, setRevision] = useState(defaults ? initial.defaults.revision : initial.pending.revision);
  const [reviewed, setReviewed] = useState(false);
  const [search, setSearch] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [browsing, setBrowsing] = useState(false);
  const [folder, setFolder] = useState<{ path: string; parent: string | null; directories: { name: string; path: string }[] }>();
  const work = useUpdateWork(); useUpdatePreparation({ blocked: () => 'Finish or cancel the conversation settings dialog before updating.' });
  useLayoutEffect(() => { const node = dialog.current!; node.showModal(); return () => { if (node.open) node.close(); }; }, []);
  const inherited = defaults ? view.profile : context.link ? view.current : { ...view.profile, ...view.defaults.values };
  const effective = { ...inherited, ...values }, choice = effective.model;
  const selected = view.models.find(m => m.id === choice?.id && m.provider === choice?.provider);
  const filtered = view.models.filter(m => !search || `${m.providerName} ${m.id}`.toLowerCase().includes(search.toLowerCase()) || (m.id === choice?.id && m.provider === choice.provider));
  const providers = [...new Set(filtered.map(m => m.provider))];
  const unsupported = values.effort !== undefined && (selected?.reasoning !== true || (values.effort === 'none' && selected.canDisableReasoning === false))
    ? 'This model does not support that effort choice. Use its existing/default effort or choose another model.'
    : effective.fast === true && selected?.fast !== true ? 'Fast mode is unavailable for this model. Choose Off or a model that supports it.' : '';
  const set = <K extends keyof SessionValues>(key: K, value: SessionValues[K]) => setValues(old => { const next = { ...old }; if (value === undefined) delete next[key]; else next[key] = value; return next; });
  async function browse(path?: string) {
    setBusy(true); setError('');
    try { setFolder(await api(`/session-directories${path ? `?path=${encodeURIComponent(path)}` : ''}`, undefined, undefined, 20000)); setBrowsing(true); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function save(next = values) {
    if (busy) return; setBusy(true); setError('');
    try {
      let selectedValues = { ...next };
      if (next.cwd !== undefined) { if (next.cwd.trim()) selectedValues.cwd = next.cwd.trim(); else delete selectedValues.cwd; }
      if (selectedValues.cwd && state.online && state.gateway.online) {
        const result = await api(`/session-directories?path=${encodeURIComponent(selectedValues.cwd)}`, undefined, undefined, 20000);
        selectedValues = { ...selectedValues, cwd: result.path };
      }
      if (view.uncertain && !reviewed) throw new Error('Refresh the current settings before saving reviewed choices.');
      await saveSessionChoices(context?.id, revision, selectedValues, context?.link ? view.current : undefined, view.uncertain && reviewed);
      close();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function refreshView() {
    setBusy(true); setError('');
    try { const next = await reload(); if (next) { setView(next); setRevision(defaults ? next.defaults.revision : next.pending.revision); setReviewed(next.available && next.source !== 'unknown'); } }
    finally { setBusy(false); }
  }
  const inheritLabel = defaults ? 'Use Hermes profile default' : context.link ? 'Keep current Hermes setting' : 'Use Herts / Hermes default';
  return <dialog ref={dialog} className="session-settings-dialog" aria-labelledby="session-settings-title" onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <form onSubmit={event => { event.preventDefault(); void work(save()); }}>
      <div className="session-dialog-heading"><h2 id="session-settings-title">{defaults ? 'New conversation defaults' : 'Conversation settings'}</h2><button className="icon-button" type="button" aria-label="Close settings" disabled={busy} onClick={close}><X size={20}/></button></div>
      <p>{defaults ? 'Used when the first message starts a new conversation in Herts.' : 'Choices apply only on your next Send, then stay with this conversation until changed.'}</p>
      {!defaults && <p className="subtle-note">{view.source === 'live' ? 'Current Hermes settings' : view.source === 'saved' ? 'Saved Hermes settings' : context.link ? 'Current Hermes settings are not fully confirmed' : 'Inherited defaults'}: {inherited.model?.id || 'model unknown'}{inherited.effort ? ` · ${labels[inherited.effort]}` : ''}{inherited.cwd ? ` · ${inherited.cwd}` : ''}</p>}
      {view.uncertain && <p role="alert" className="error-banner">An earlier settings change is unconfirmed. Refresh and review the current values. Applying reviewed choices allows them to be tried again only when you next press Send.</p>}
      <label>Find a model<input type="search" aria-label="Find a model" value={search} onChange={e => setSearch(e.target.value)} placeholder="Model or provider" disabled={busy}/></label>
      <label>Model and provider<select aria-label="Conversation model" disabled={busy || !view.models.length} value={modelKey(choice)} onChange={e => set('model', e.target.value ? JSON.parse(e.target.value) as ModelChoice : undefined)}>
        <option value="">{inheritLabel}{inherited.model ? ` (${inherited.model.id})` : ''}</option>
        {choice && !view.models.some(m => m.id === choice.id && m.provider === choice.provider) && <option value={modelKey(choice)}>{choice.provider} · {choice.id} (current)</option>}
        {providers.map(provider => <optgroup key={provider} label={filtered.find(m => m.provider === provider)!.providerName}>{filtered.filter(m => m.provider === provider).map(m => <option key={modelKey({ id: m.id, provider })} value={modelKey({ id: m.id, provider })} disabled={!m.available}>{m.id}{!m.available ? ' (unavailable)' : ''}</option>)}</optgroup>)}
      </select></label>
      {values.model && <button type="button" className="text-button settings-inherit" disabled={busy} onClick={() => set('model', undefined)}>{inheritLabel}</button>}
      <div className="session-settings-grid"><label>Reasoning effort<select aria-label="Reasoning effort" value={values.effort ?? ''} disabled={busy} onChange={e => set('effort', e.target.value ? e.target.value as Effort : undefined)}>
        <option value="">{inheritLabel}{inherited.effort ? ` (${labels[inherited.effort]})` : ''}</option>
        {efforts.map(e => <option key={e} value={e} disabled={selected?.reasoning !== true || (e === 'none' && selected.canDisableReasoning === false)}>{labels[e]}</option>)}
      </select></label><label>Fast mode<select aria-label="Fast mode" disabled={busy} value={values.fast === undefined ? '' : String(values.fast)} onChange={e => set('fast', e.target.value === '' ? undefined : e.target.value === 'true')}>
        <option value="">{inheritLabel}{inherited.fast === undefined ? '' : ` (${inherited.fast ? 'On' : 'Off'})`}</option><option value="false">Off</option><option value="true" disabled={selected?.fast !== true}>On</option>
      </select></label></div>
      <label>Working folder on Hermes<input aria-label="Working folder" value={values.cwd ?? inherited.cwd ?? ''} disabled={busy} onChange={e => set('cwd', e.target.value)} placeholder="Full path on the Hermes server"/></label>
      <div className="button-row"><button type="button" disabled={busy || !state.online || !state.gateway.online} onClick={() => void work(browse(effective.cwd))}><Folder size={16}/> Browse folders</button>{values.cwd && <button type="button" className="text-button" disabled={busy} onClick={() => set('cwd', undefined)}>{inheritLabel}</button>}</div>
      {browsing && folder && <div className="session-folder-browser"><div className="settings-path">{folder.path}</div><div className="button-row">{folder.parent && <button type="button" disabled={busy} onClick={() => void work(browse(folder.parent!))}>Parent folder</button>}<button type="button" disabled={busy} onClick={() => { set('cwd', folder.path); setBrowsing(false); }}>Use this folder</button><button type="button" disabled={busy} onClick={() => setBrowsing(false)}>Close browser</button></div><ul>{folder.directories.map(dir => <li key={dir.path}><button type="button" disabled={busy} onClick={() => void work(browse(dir.path))}><Folder size={16}/>{dir.name}</button></li>)}</ul>{!folder.directories.length && <p>No subfolders.</p>}</div>}
      {unsupported && <p role="alert" className="inline-error">{unsupported}</p>}
      {view.error && <p className="subtle-note">{view.error}</p>}
      {!state.online && <p className="subtle-note">Choices are saved on this device and synced when Herts is reachable. They do not send a message.</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="session-dialog-actions"><button type="button" className="text-button" disabled={busy || !state.online} onClick={() => void work(refreshView())}><RefreshCw size={15}/> Refresh current settings</button>
        {!defaults && hasSettings(view.pending.values) && <button type="button" disabled={busy} onClick={() => void work(save({}))}>Discard pending changes</button>}
        {defaults && hasSettings(values) && <button type="button" disabled={busy} onClick={() => setValues({})}>Use Hermes defaults for all</button>}
        <div className="button-row"><button type="button" disabled={busy} onClick={close}>Cancel</button><button className="primary-button" disabled={busy || !!unsupported || (view.uncertain && !reviewed)}>{busy ? 'Saving…' : defaults ? 'Save defaults' : view.uncertain ? 'Save reviewed choices' : 'Apply'}</button></div>
      </div>
    </form>
  </dialog>;
}
