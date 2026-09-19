import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, ArrowDown, RefreshCw, Trash2, Plug } from 'lucide-react';
import { api, useApp, acceptPlugins, refresh } from './data';
import { prepareForUpdate } from './updateSafety';
import { PluginContent, pluginError, usePlugins } from './plugins';
import type { PluginEntry } from '../shared/plugins';
export function PluginSettings() {
    const state = useApp(), loaded = usePlugins();
    const [busy, setBusy] = useState(''), [error, setError] = useState(''), [reset, setReset] = useState<PluginEntry>(), [dragged, setDragged] = useState<string>();
    async function run(id: string, action: string, confirmation?: string) {
        setError('');
        setBusy(id);
        try {
            await prepareForUpdate();
            const data = await api(`/plugins/${id}/manage`, { action, confirmation, revision: state.plugins.revision });
            await acceptPlugins(data.catalogue, data.data);
            await refresh();
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setBusy('');
        }
    }
    async function rescan() { setError(''); setBusy('scan'); try {
        await prepareForUpdate();
        const data = await api('/plugins/rescan', {});
        await acceptPlugins(data.catalogue, data.data);
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy('');
    } }
    const known = ['conversations', ...state.plugins.entries.filter(e => !e.manifest.id.startsWith('invalid-')).map(e => e.manifest.id)];
    const order = [...state.plugins.order.filter(id => known.includes(id)), ...known.filter(id => !state.plugins.order.includes(id))];
    async function move(id: string, before: string | undefined) {
        const next = order.filter(key => key !== id);
        next.splice(before ? next.indexOf(before) : next.length, 0, id);
        setBusy('order');
        setError('');
        try {
            const data = await api('/plugins/order', { order: next, revision: state.plugins.revision });
            await acceptPlugins(data.catalogue);
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setBusy('');
        }
    }
    return <><section className="settings-card"><div className="settings-icon"><Plug size={22}/></div><div><h2>Plugins</h2><p>Enable features for every device using this Herts installation. Disabling keeps saved data and pauses background activity.</p><p className="subtle-note">Plugins are trusted code installed by the server owner. Only enable packages you trust.</p><button disabled={!state.online || !!busy} onClick={() => void rescan()}><RefreshCw size={16}/> Rescan plugins</button></div></section>
    {state.plugins.entries.map(entry => { const id = entry.manifest.id, p = loaded.find(p => p.id === id), Settings = p?.definition.Settings; return <section className="settings-card plugin-card" key={id}><div className="plugin-heading"><label><input type="checkbox" aria-label={`Enable ${entry.manifest.name}`} checked={entry.enabled} disabled={!state.online || !!busy || !entry.available || entry.status === 'incompatible'} onChange={e => void run(id, e.target.checked ? 'enable' : 'disable')}/><strong>{entry.manifest.name}</strong></label><span>{entry.manifest.version} · {entry.status}</span></div><p>{entry.manifest.description}</p>{(entry.error || pluginError(id)) && <p role="alert">{entry.error || pluginError(id)}</p>}<div className="button-row">{entry.candidateHash && <button disabled={!state.online || !!busy} onClick={() => void run(id, 'update')}>Apply update {entry.candidateVersion}</button>}<button className="danger-button" disabled={!state.online || !!busy} onClick={() => setReset(entry)}><Trash2 size={15}/> Reset data</button></div>{Settings && p && <PluginContent plugin={p}><Settings /></PluginContent>}</section>; })}
    <section className="settings-card tab-order"><h2>Tab order</h2><p>The first enabled tab is the default when you open Herts. Changes apply to all devices.</p>{order.map((id, index) => { const entry = state.plugins.entries.find(e => e.manifest.id === id), name = id === 'conversations' ? 'Conversations' : entry?.manifest.name || id; return <div className="tab-order-row" key={id} draggable={state.online && !busy} onDragStart={() => setDragged(id)} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (dragged && dragged !== id)
        void move(dragged, id); setDragged(undefined); }}><span>{name}{id === 'conversations' ? ' · always enabled' : entry?.enabled ? '' : ' · disabled'}</span><button className="icon-button" aria-label={`Move ${name} up`} disabled={!state.online || !!busy || index === 0} onClick={() => void move(id, order[index - 1])}><ArrowUp size={17}/></button><button className="icon-button" aria-label={`Move ${name} down`} disabled={!state.online || !!busy || index === order.length - 1} onClick={() => void move(id, order[index + 2])}><ArrowDown size={17}/></button></div>; })}</section>
    {error && <p className="error-banner" role="alert">{error}</p>}{reset && <ResetDialog entry={reset} close={() => setReset(undefined)} confirm={name => { const id = reset.manifest.id; setReset(undefined); setTimeout(() => void run(id, 'reset', name), 0); }}/>}</>;
}
function ResetDialog({ entry, close, confirm }: {
    entry: PluginEntry;
    close: () => void;
    confirm: (name: string) => void;
}) {
    const dialog = useRef<HTMLDialogElement>(null), [name, setName] = useState('');
    useLayoutEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
    return <dialog ref={dialog} className="space-dialog" aria-labelledby="reset-plugin-title" onCancel={e => { e.preventDefault(); close(); }}><form onSubmit={e => { e.preventDefault(); if (name === entry.manifest.name)
        confirm(name); }}><h2 id="reset-plugin-title">Permanently reset {entry.manifest.name}?</h2><p>This deletes all {entry.manifest.name} records, preferences, downloads, saved capture drafts, reminders and pending changes. This cannot be undone.</p><p>Hermes conversations, their message drafts and accepted work remain. Other plugins are unaffected.</p><p>Offline devices clear their copies when they reconnect. Their older edits will be discarded rather than restoring deleted data.</p><label>Type {entry.manifest.name} to confirm<input autoFocus aria-label="Confirm plugin name" value={name} onChange={e => setName(e.target.value)}/></label><div className="button-row"><button type="button" onClick={close}>Cancel</button><button className="danger-button" disabled={name !== entry.manifest.name}>Permanently reset data</button></div></form></dialog>;
}
