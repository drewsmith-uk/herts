import { useState } from 'react';
import { ArrowUp, ArrowDown, RefreshCw, Trash2, Plug } from 'lucide-react';
import { api, useApp, acceptPlugins, refresh } from './data';
import { prepareForUpdate } from './updateSafety';
import { PluginContent, pluginError, usePlugins } from './plugins';
import type { PluginEntry } from '../shared/plugins';
import { SettingsSection, Button, IconButton, DialogFrame, FormField, StatusMessage } from './ui';
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
    return <><SettingsSection title="Plugins" icon={<Plug size={22}/>} description="Disabling a plugin keeps its data and pauses its background activity.">
      <Button disabled={!state.online || !!busy} onClick={() => void rescan()}><RefreshCw size={16}/> Rescan plugins</Button>
    </SettingsSection>
    {state.plugins.entries.map(entry => {
      const id = entry.manifest.id, p = loaded.find(p => p.id === id), Settings = p?.definition.Settings;
      return <SettingsSection className="plugin-card" key={id} title={<label className="plugin-heading"><input type="checkbox" aria-label={`Enable ${entry.manifest.name}`} checked={entry.enabled} disabled={!state.online || !!busy || !entry.available || entry.status === 'incompatible'} onChange={e => void run(id, e.target.checked ? 'enable' : 'disable')}/>{entry.manifest.name}</label>} actions={<span>{entry.manifest.version}{!(entry.enabled && entry.status === 'enabled') && <> · {entry.status}</>}</span>} description={entry.manifest.description}>
        {(entry.error || pluginError(id)) && <StatusMessage>{entry.error || pluginError(id)}</StatusMessage>}
        {entry.candidateHash && <Button disabled={!state.online || !!busy} onClick={() => void run(id, 'update')}>Apply update {entry.candidateVersion}</Button>}
        {Settings && p && <PluginContent plugin={p}><Settings /></PluginContent>}
        <div className="settings-danger-actions"><Button variant="danger" disabled={!state.online || !!busy} onClick={() => setReset(entry)}><Trash2 size={15}/> Reset data</Button></div>
      </SettingsSection>;
    })}
    <SettingsSection className="tab-order" title="Tab order" description="The first enabled tab opens by default.">{order.map((id, index) => { const entry = state.plugins.entries.find(e => e.manifest.id === id), name = id === 'conversations' ? 'Conversations' : entry?.manifest.name || id; return <div className="tab-order-row" key={id} draggable={state.online && !busy} onDragStart={() => setDragged(id)} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (dragged && dragged !== id)
        void move(dragged, id); setDragged(undefined); }}><span>{name}{id === 'conversations' ? ' · always enabled' : entry?.enabled ? '' : ' · disabled'}</span><IconButton aria-label={`Move ${name} up`} disabled={!state.online || !!busy || index === 0} onClick={() => void move(id, order[index - 1])}><ArrowUp size={17}/></IconButton><IconButton aria-label={`Move ${name} down`} disabled={!state.online || !!busy || index === order.length - 1} onClick={() => void move(id, order[index + 2])}><ArrowDown size={17}/></IconButton></div>; })}</SettingsSection>
    {error && <StatusMessage>{error}</StatusMessage>}{reset && <ResetDialog entry={reset} close={() => setReset(undefined)} confirm={name => { const id = reset.manifest.id; setReset(undefined); setTimeout(() => void run(id, 'reset', name), 0); }}/>}</>;
}
function ResetDialog({ entry, close, confirm }: {
    entry: PluginEntry;
    close: () => void;
    confirm: (name: string) => void;
}) {
    const [name, setName] = useState('');
    return <DialogFrame className="space-dialog" aria-labelledby="reset-plugin-title" close={close}><form onSubmit={e => { e.preventDefault(); if (name === entry.manifest.name)
        confirm(name); }}><h2 id="reset-plugin-title">Permanently reset {entry.manifest.name}?</h2><p>This deletes all {entry.manifest.name} records, preferences, downloads, saved capture drafts, reminders and pending changes. This cannot be undone.</p><p>Hermes conversations, their message drafts and accepted work remain. Other plugins are unaffected.</p><p>Offline devices clear their copies when they reconnect. Their older edits will be discarded rather than restoring deleted data.</p><FormField label={<>Type {entry.manifest.name} to confirm</>}><input autoFocus aria-label="Confirm plugin name" value={name} onChange={e => setName(e.target.value)}/></FormField><div className="button-row"><Button onClick={close}>Cancel</Button><Button type="submit" variant="danger" disabled={name !== entry.manifest.name}>Permanently reset data</Button></div></form></DialogFrame>;
}
