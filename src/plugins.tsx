import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as jsx from 'react/jsx-runtime';
import { Component, createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode, type ComponentType } from 'react';
import * as sdk from '../sdk/client';
import { getState, useApp, registerPluginData, publish, api } from './data';
import { Voice } from './Voice';
import { prepareForUpdate } from './updateSafety';
import type { ClientPlugin, RouteProps, ConversationActionProps, MessageLinkProps } from './pluginContract';
import type { ConversationContext, Conversation } from '../sdk/types';
(globalThis as any).__HERTS_PLUGIN_RUNTIME__ = { React, ReactDOM, jsx, sdk };
interface Loaded {
    id: string;
    hash: string;
    generation: number;
    definition: ClientPlugin;
    dispose?: () => void;
}
const loaded = new Map<string, Loaded>(), errors = new Map<string, string>(), listeners = new Set<() => void>();
let version = 0, loading: Promise<void> | undefined, reloadRequested = false;
function changed() { version++; for (const fn of listeners)
    fn(); }
export function usePlugins() { useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn); }, () => version); const state = useApp(); return state.plugins.order.flatMap(id => { const p = loaded.get(id); return p && state.plugins.entries.some(e => e.manifest.id === id && e.enabled && e.hash === p.hash && e.generation === p.generation) ? [p] : []; }); }
export function pluginError(id: string) { return errors.get(id); }
export async function loadPlugins() {
    if (loading) {
        reloadRequested = true;
        return loading;
    }
    loading = (async () => {
        do {
            reloadRequested = false;
            const entries = getState().plugins.entries;
            for (const [id, p] of loaded) {
                const next = entries.find(e => e.manifest.id === id);
                if (!next?.enabled || next.hash !== p.hash || next.generation !== p.generation) {
                    try {
                        p.dispose?.();
                    }
                    catch (error) {
                        errors.set(id, (error as Error).message);
                    }
                    loaded.delete(id);
                    await registerPluginData(id);
                    changed();
                }
            }
            for (const entry of entries) {
                const id = entry.manifest.id;
                if (!entry.enabled || !entry.hash || loaded.has(id) || errors.has(`${id}:${entry.hash}:${entry.generation}:${getState().plugins.revision}`))
                    continue;
                try {
                    const definition: ClientPlugin = entry.manifest.client ? (await import(/* @vite-ignore */ `/_plugins/${id}/${entry.hash}/${entry.manifest.client}`)).default() : { routes: [] };
                    if (!Array.isArray(definition.routes)||definition.routes.some(r=>typeof r.match!=='function'||!r.component))
                        throw new Error('Client entry must return a plugin definition.');
                    if(definition.tab&&(typeof definition.tab.title!=='string'||typeof definition.tab.path!=='string'))throw new Error('Invalid plugin tab.');
                    if(definition.filter&&(typeof definition.filter.id!=='string'||typeof definition.filter.label!=='string'||typeof definition.filter.visible!=='function'))throw new Error('Invalid conversation filter.');
                    if(definition.shares?.some(s=>typeof s.id!=='string'||typeof s.title!=='string'||typeof s.path!=='string'||typeof s.accepts!=='function'))throw new Error('Invalid share destination.');
                    const latest = getState().plugins.entries.find(e => e.manifest.id === id);
                    if (!latest?.enabled || latest.hash !== entry.hash || latest.generation !== entry.generation) {
                        reloadRequested = true;
                        continue;
                    }
                    const p: Loaded = { id, hash: entry.hash, generation: entry.generation, definition };
                    loaded.set(id, p);
                    await registerPluginData(id, definition);
                    p.dispose = definition.start?.() || undefined;
                    errors.delete(id);
                    changed();
                }
                catch (error) {
                    loaded.delete(id);
                    await registerPluginData(id);
                    const message = error instanceof Error ? error.message : 'Plugin could not be opened.';
                    errors.set(id, message);
                    errors.set(`${id}:${entry.hash}:${entry.generation}:${getState().plugins.revision}`, message);
                    changed();
                }
            }
        } while (reloadRequested);
    })().finally(() => { loading = undefined; });
    return loading;
}
export function pluginHook<T>(plugin: Loaded, read: () => T, fallback: T): T { try {
    return read();
}
catch (error) {
    errors.set(plugin.id, (error as Error).message);
    return fallback;
} }
export function matchPluginRoute(plugin: Loaded, path: string) {
    const manifest = getState().plugins.entries.find(e => e.manifest.id === plugin.id)?.manifest;
    const prefixes = [`/plugins/${plugin.id}`, ...(manifest?.routes || [])];
    if (!prefixes.some(prefix => path === prefix || path.startsWith(prefix + '/')))
        return undefined;
    try {
        return plugin.definition.routes.find(route => route.match(path));
    }
    catch (error) {
        errors.set(plugin.id, (error as Error).message);
        return undefined;
    }
}
export function PluginLoader() { const state = useApp(); useEffect(() => { void loadPlugins().catch(e => publish({ error: e.message })); }, [state.plugins.revision, state.online]); return null; }
const Scope = createContext<{
    id: string;
    generation: number;
} | undefined>(undefined);
export function PluginVoice(props: React.ComponentProps<typeof Voice>) { const scope = useContext(Scope); return <Voice {...props} owner={scope ? `plugin:${scope.id}:${scope.generation}:${props.owner}` : props.owner}/>; }
class Boundary extends Component<{
    id: string;
    children: ReactNode;
    fallback?: ReactNode;
}, {
    error: string;
}> {
    state = { error: '' };
    static getDerivedStateFromError(error: Error) { return { error: error.message }; }
    componentDidCatch(error: Error) { errors.set(this.props.id, error.message); changed(); }
    render() { return this.state.error ? this.props.fallback ?? <div role="alert" className="error-banner">This plugin could not display this screen. Your saved data is retained. <a href="#/settings/plugins">Plugin settings</a></div> : this.props.children; }
}
export function PluginContent({ plugin, children }: {
    plugin: Loaded;
    children: ReactNode;
}) { return <Scope.Provider value={{ id: plugin.id, generation: plugin.generation }}><Boundary key={`${plugin.hash}:${plugin.generation}`} id={plugin.id}>{children}</Boundary></Scope.Provider>; }
export function PluginProviders({ children }: {
    children: ReactNode;
}) { const plugins = usePlugins(); return <>{plugins.reduceRight<ReactNode>((child, p) => { const Provider = p.definition.Provider; return Provider ? <Scope.Provider key={p.id} value={{ id: p.id, generation: p.generation }}><Boundary id={p.id} fallback={child}><Provider>{child}</Provider></Boundary></Scope.Provider> : child; }, children)}</>; }
export function ConversationContributions({ context, conversation, suggestedTitle }: {
    context?: ConversationContext;
    conversation?: Conversation;
    suggestedTitle?: string;
}) {
    const plugins = usePlugins();
    const c = conversation || { id: context?.link?.storedId || context?.id || '', key: context?.link?.key || context?.id || '', title: context?.link?.title || context?.title || 'Conversation', preview: '', source: context?.link?.source || '', updatedAt: 0, aliases: context?.aliases || [] };
    return <div className="conversation-plugin-actions">{plugins.map(p => { const Actions = p.definition.ConversationActions; return Actions ? <PluginContent key={p.id} plugin={p}><Actions context={context} conversation={c} suggestedTitle={suggestedTitle}/></PluginContent> : null; })}</div>;
}
export function MessageLinkContributions({ href, conversationId, children }: MessageLinkProps) {
    const plugins = usePlugins();
    return <><a href={href} target="_blank" rel="noopener noreferrer">{children}</a>{plugins.map(p => { const Link = p.definition.MessageLink; return Link ? <PluginContent key={p.id} plugin={p}><Link href={href} conversationId={conversationId}>{children}</Link></PluginContent> : null; })}</>;
}
export function PluginConflicts() { const plugins = usePlugins(); return <>{plugins.map(p => { const Conflicts = p.definition.Conflicts; return Conflicts ? <PluginContent key={p.id} plugin={p}><Conflicts /></PluginContent> : null; })}</>; }
export function PluginUnavailable({ id }: {
    id: string;
}) { const [context, setContext] = useState<ConversationContext>(); const ref = location.hash.split('/').at(-1) || ''; useEffect(() => { let active = true; if (/^[a-f0-9-]{36}$/.test(ref))
    void api(`/contexts/${ref}`).then(data => { if (active)
        setContext(data.context); }).catch(() => { }); return () => { active = false; }; }, [ref]); return <div className="empty"><h1>Plugin unavailable</h1><p>This destination belongs to a plugin that is disabled, missing or still loading. Saved data is retained.</p><a href="#/settings/plugins">Open plugin settings</a>{context && <a href={context.link ? `#/conversation/${encodeURIComponent(context.link.storedId)}` : `#/draft/${context.id}`}>Continue conversation</a>}<a href="#/conversations">Open Conversations</a>{pluginError(id) && <p role="alert">{pluginError(id)}</p>}</div>; }

export function ConversationBadges({conversation}:{conversation:Conversation}){const plugins=usePlugins();return <>{plugins.map(p=>{const Badge=p.definition.ConversationBadge;return Badge?<Boundary key={p.id} id={p.id} fallback={null}><Badge conversation={conversation}/></Boundary>:null;})}</>;}
export function PluginIcon({id,icon:Icon,size}:{id:string;icon:ComponentType<{size?:number}>;size:number}){return <Boundary id={id} fallback={<span aria-hidden="true">◇</span>}><Icon size={size}/></Boundary>;}
