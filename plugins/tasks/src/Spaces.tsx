import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Layers, Plus } from 'lucide-react';
import { liveQuery } from '@herts/plugin-api/client';
import { useDroppable } from '@dnd-kit/core';
import { originalSpaceId, spaceName, spacePath, type Space } from './model';
import { db, useApp, createSpace, renameSpace, setDefaultSpace, rememberSpace, resolveSpaceConflict, type PendingSpace } from './data';
import { TaskDropLink, useTaskInteractions } from './TaskDragging';
import { useUpdatePreparation } from '@herts/plugin-api/client';
export function useTaskDestination(conversationId?: string) {
    const state = useApp(), [saved, setSaved] = useState<{
        conversationId: string;
        spaceId?: string;
    }>();
    useEffect(() => {
        if (!conversationId)
            return;
        const query = liveQuery(() => db.kv.get(`link-intent:${conversationId}`)).subscribe(row => setSaved({ conversationId, spaceId: row ? row.value.spaceId || originalSpaceId : undefined }));
        return () => query.unsubscribe();
    }, [conversationId]);
    return (saved?.conversationId === conversationId ? saved?.spaceId : undefined) || state.snapshot.defaultSpaceId || originalSpaceId;
}
export function SpaceSwitcher({ spaceId, label = 'Viewing space' }: {
    spaceId: string;
    label?: string;
}) {
    const state = useApp();
    return <label className="space-switcher"><span>SPACE</span><select aria-label={label} value={spaceId} onChange={e => { rememberSpace(e.target.value); location.hash = spacePath(e.target.value); }}>{state.snapshot.spaces?.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label>;
}
export function SpaceTabs({ spaceId }: {
    spaceId: string;
}) {
    const { snapshot } = useApp(), { activeTask } = useTaskInteractions();
    const tabs = useRef<HTMLElement>(null), [creating, setCreating] = useState(false);
    const { setNodeRef: setScrollSurface } = useDroppable({ id: 'space-tabs-scroll-surface', data: { kind: 'scroll-surface' } });
    useLayoutEffect(() => {
        const container = tabs.current, selected = container?.querySelector<HTMLElement>('[aria-current="page"]');
        if (!container || !selected)
            return;
        // Reveal the selected space on direct links and after creation, without
        // scrolling the document or undoing a manual scroll during dragging.
        const bounds = container.getBoundingClientRect(), item = selected.getBoundingClientRect();
        if (item.left < bounds.left)
            container.scrollLeft += item.left - bounds.left - 4;
        else if (item.right > bounds.right)
            container.scrollLeft += item.right - bounds.right + 4;
    }, [spaceId, snapshot.spaces?.map(space => space.name).join('\n')]);
    return <><div className="task-space-bar"><nav ref={tabs} className="space-tabs" aria-label="Task spaces" data-task-drop-scroll>
    <span ref={setScrollSurface} className="space-scroll-surface" aria-hidden="true"/>
    {snapshot.spaces?.map(space => <TaskDropLink key={space.id} surface="spaces" status="inbox" spaceId={space.id} className={`space-tab ${space.id === spaceId ? 'active' : ''}`} current={space.id === spaceId} destinationLabel={`${space.name} Inbox`} title={space.name}><span>{space.name}</span></TaskDropLink>)}
    <button className="space-add" aria-label="Create space" title="Create space" disabled={!!activeTask} onClick={() => setCreating(true)}><Plus size={20}/></button>
  </nav></div>{creating && <CreateSpaceDialog close={() => setCreating(false)}/>}</>;
}
function CreateSpaceDialog({ close }: {
    close: () => void;
}) {
    const { online } = useApp(), dialog = useRef<HTMLDialogElement>(null);
    const [name, setName] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    useLayoutEffect(() => { const node = dialog.current!; node.showModal(); return () => { if (node.open)
        node.close(); }; }, []);
    async function save(event: FormEvent) {
        event.preventDefault();
        if (busy || !name.trim())
            return;
        setBusy(true);
        setError('');
        try {
            const id = await createSpace(name);
            close();
            rememberSpace(id);
            location.hash = spacePath(id);
        }
        catch (e) {
            setError((e as Error).message);
            setBusy(false);
        }
    }
    return <dialog ref={dialog} className="space-dialog" aria-labelledby="create-space-heading" onCancel={event => { event.preventDefault(); if (!busy)
        close(); }} onClick={event => {
            if (event.target !== event.currentTarget || busy)
                return;
            const r = event.currentTarget.getBoundingClientRect();
            if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)
                close();
        }}><form onSubmit={save}>
    <h2 id="create-space-heading"><Layers size={21}/>Create space</h2><p>Keep a separate set of task lists for work, family or anything else.</p>
    <label>Space name<input aria-label="New space name" placeholder="e.g. Work" value={name} onChange={event => setName(event.target.value)} maxLength={80} required disabled={busy}/></label>
    {!online && <p>Saved on this device and synced when you reconnect.</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    <div className="button-row"><button type="button" disabled={busy} onClick={close}>Cancel</button><button className="primary-button" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create space'}</button></div>
  </form></dialog>;
}
export function SpaceSettings() {
    const state = useApp(), [name, setName] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    useUpdatePreparation({ blocked: () => name || busy ? 'Save or clear the new space name before updating.' : undefined });
    async function add(e: FormEvent) {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
            await createSpace(name);
            setName('');
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    }
    return <section className="settings-card spaces-settings"><div className="settings-icon"><Layers size={22}/></div><div><h2>Task spaces</h2><p>Each space has its own Inbox, Next, Waiting, Parked and Done. Conversations and Reading are shared.</p>
    <label className="default-space-label">Default space<select aria-label="Default space" value={state.snapshot.defaultSpaceId} onChange={e => { setError(''); void setDefaultSpace(e.target.value).catch(e => setError(e.message)); }}>{state.snapshot.spaces?.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label><p className="subtle-note">New tasks from conversations and the home-screen voice shortcut go to this space’s Inbox. Capture on a task-list screen uses the space you are viewing.</p>
    <div className="space-management-list">{state.snapshot.spaces?.map(space => <SpaceName key={space.id} space={space}/>)}</div>
    <form className="new-space-form" onSubmit={add}><label>New space<input aria-label="New space name" placeholder="e.g. Work" value={name} onChange={e => setName(e.target.value)} maxLength={80}/></label><button disabled={busy || !name.trim()}><Plus size={16}/> Create space</button></form>
    {error && <p role="alert" className="inline-error">{error}</p>}
  </div></section>;
}
function SpaceName({ space }: {
    space: Space;
}) {
    const [name, setName] = useState(space.name), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    useUpdatePreparation({ blocked: () => name !== space.name || busy ? 'Save the space name before updating.' : undefined });
    useEffect(() => setName(space.name), [space.name]);
    async function save(e: FormEvent) { e.preventDefault(); setBusy(true); setError(''); try {
        await renameSpace(space.id, name);
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } }
    return <div><form className="space-name-form" onSubmit={save}><input aria-label={`Name of ${space.name} space`} value={name} onChange={e => setName(e.target.value)} maxLength={80}/><button disabled={busy || !name.trim() || name.trim() === space.name}>Rename</button><a className="text-link" href={`#${spacePath(space.id)}`}>Open</a></form>{error && <p role="alert" className="inline-error">{error}</p>}</div>;
}
export function SpaceConflict({ pending }: {
    pending: PendingSpace;
}) {
    const state = useApp(), [name, setName] = useState(pending.op.name || ''), [error, setError] = useState('');
    useUpdatePreparation({ blocked: () => name !== (pending.op.name || '') ? 'Save your choice of space name before updating.' : undefined });
    const creating = pending.op.kind === 'create';
    const resolve = (keep: boolean) => { setError(''); void resolveSpaceConflict(pending.id, keep, pending.op.kind === 'default' ? undefined : name).catch(e => setError(e.message)); };
    return <div className="conflict-banner"><strong>A space change needs your choice</strong><p>{pending.conflict}</p>
    {pending.op.kind === 'default' ? <><p>Your default: {spaceName(state.snapshot, pending.op.spaceId)}</p><p>Synced default: {spaceName(state.remote, state.remote.defaultSpaceId)}</p></> : <><label>Space name<input aria-label="Resolve space name" value={name} onChange={e => setName(e.target.value)} maxLength={80}/></label>{!creating && <p>Synced name: {spaceName(state.remote, pending.op.spaceId)}</p>}</>}
    {creating && <p>Choose another name to keep this space and its saved tasks.</p>}
    <div className="button-row"><button onClick={() => resolve(true)} disabled={pending.op.kind !== 'default' && !name.trim()}>{creating ? 'Retry with this name' : 'Keep my change'}</button>{!creating && <button onClick={() => resolve(false)}>Use synced version</button>}</div>{error && <p role="alert" className="inline-error">{error}</p>}
  </div>;
}
