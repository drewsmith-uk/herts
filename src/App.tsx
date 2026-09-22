import { useState } from 'react';
import { MessageSquare, Settings, Check, WifiOff, RefreshCw, LoaderCircle, Plug, Link2 } from 'lucide-react';
import { useApp, refresh } from './data';
import { useRoute } from './useRoute';
import { PluginLoader, PluginIcon, matchPluginRoute, pluginError, pluginHook, PluginContent, PluginConflicts, PluginUnavailable, usePlugins } from './plugins';
import { Conversations, ConversationView, NewConversation } from './Conversations';
import { NotificationLanding } from './NotificationLanding';
import { PluginSettings } from './PluginSettings';
import { NotificationSettings } from './NotificationSettings';
import { AppUpdateSettings } from './AppUpdates';
import { NewConversationDefaults } from './SessionSettings';
import type { RouteProps } from './pluginContract';
import type { SharedContent } from '../shared/plugins';
export { ConversationPanel, HistoryView } from './Conversation';
export function App() { return <><PluginLoader /><Shell /></>; }
function Shell() {
    const state = useApp(), plugins = usePlugins(), route = useRoute();
    const tabs = state.plugins.order.flatMap(id => { if (id === 'conversations')
        return [{ id, title: 'Conversations', path: '/conversations', Icon: MessageSquare }]; const plugin = plugins.find(p => p.id === id), tab = plugin?.definition.tab; return tab ? [{ id, title: tab.title, path: tab.path, Icon: tab.icon || Plug }] : []; });
    const path = route.path === '/' ? (tabs[0]?.path || '/conversations') : route.path, parts = path.split('/').filter(Boolean), [screen, id] = parts;
    const plugin = plugins.find(p => matchPluginRoute(p, path)), match = plugin && matchPluginRoute(plugin, path);
    const sidebar = plugin?.definition.Sidebar;
    const props: RouteProps = { path, parts };
    const pending = state.pluginPending.length + state.visibilityPending.length + (state.settingsPending?.length || 0);
    let page;
    if (!state.loaded || !state.defaultsReady || route.path === '/' && state.plugins.entries.some(e => e.enabled && !plugins.some(p => p.id === e.manifest.id) && !pluginError(e.manifest.id)))
        page = <div className="empty"><LoaderCircle className="spin"/><p>Opening Herts…</p></div>;
    else if (screen === 'notice')
        page = <NotificationLanding key={id} id={id} online={state.online}/>;
    else if (screen === 'conversations')
        page = <Conversations />;
    else if (screen === 'conversation')
        page = <ConversationView key={id} id={decodeURIComponent(id)}/>;
    else if (screen === 'new' || screen === 'draft')
        page = <NewConversation key={id || 'new'} id={id}/>;
    else if (screen === 'settings')
        page = <Preferences plugins={id === 'plugins'}/>;
    else if (screen === 'share')
        page = <ShareChooser />;
    else if (match && plugin) {
        const Screen = match.component;
        page = <PluginContent plugin={plugin}><Screen {...props}/></PluginContent>;
    }
    else
        page = <PluginUnavailable id={screen === 'plugins' || screen === 'plugins-unavailable' ? id : state.plugins.entries.find(e => e.manifest.routes?.some(prefix => path === prefix || path.startsWith(prefix + '/')))?.manifest.id || ''}/>;
    const activeId = plugin?.id || (['conversations', 'conversation', 'draft', 'new'].includes(screen) ? 'conversations' : '');
    const Sidebar = sidebar;
    const layout = <div className="app-shell"><aside className="sidebar"><a href="#/" className="brand"><span className="brand-mark"><MessageSquare size={22}/></span>Herts<span className="personal-label">Private</span></a><nav aria-label="Main navigation">{tabs.map(t => <a key={t.id} href={`#${t.path}`} className={`nav-item ${activeId === t.id ? 'active' : ''}`}><PluginIcon id={t.id} icon={t.Icon} size={19}/><span>{t.title}</span></a>)}</nav>{Sidebar && plugin && <PluginContent plugin={plugin}><div className="sidebar-rule"/><Sidebar {...props}/></PluginContent>}<div className="sidebar-bottom"><span className="private-dot"/> Private workspace</div></aside>
    <main><div className="topbar"><span className="breadcrumb">Herts <span>/</span> {screen === 'settings' ? 'Settings' : tabs.find(t => t.id === activeId)?.title || 'Conversations'}</span><div className={`save-state ${!state.online ? 'offline' : ''}`} aria-live="polite">{!state.online ? <WifiOff size={14}/> : pending ? <RefreshCw size={14}/> : <Check size={14}/>} {!state.online ? 'Offline · saved on device' : pending ? `${pending} change${pending === 1 ? '' : 's'} to sync` : 'All changes saved'}</div><a href="#/settings" className="icon-button settings-link" aria-label="Settings"><Settings size={19}/></a></div><div className="page-content">{state.error && <div className="error-banner" role="alert">{state.error}</div>}{state.lifecycleNotice && <div className="error-banner" role="status">{state.lifecycleNotice}</div>}<PluginConflicts />{page}</div></main>
    <nav className="mobile-nav" aria-label="Main navigation">{tabs.map(t => <a key={t.id} className={activeId === t.id ? 'active' : ''} href={`#${t.path}`}><PluginIcon id={t.id} icon={t.Icon} size={21}/>{t.title}</a>)}</nav></div>;
    const Provider = plugin?.definition.Provider;
    return Provider && plugin ? <PluginContent plugin={plugin}><Provider>{layout}</Provider></PluginContent> : layout;
}
function Preferences({ plugins }: {
    plugins: boolean;
}) { const state = useApp(); return <><div className="page-heading"><div><div className="eyebrow">YOUR WORKSPACE</div><h1>Settings</h1><p>Private by default. In your control.</p></div></div><nav className="settings-tabs" aria-label="Settings sections"><a className={!plugins ? 'active' : ''} href="#/settings">General</a><a className={plugins ? 'active' : ''} href="#/settings/plugins">Plugins</a></nav>{plugins ? <PluginSettings /> : <><AppUpdateSettings /><NewConversationDefaults /><NotificationSettings /><section className="settings-card"><div className="settings-icon"><Link2 size={22}/></div><div><h2>Hermes connection</h2><p>{state.gateway.online ? `Connected to your ${state.gateway.profile || 'default'} profile.` : state.gateway.configured ? 'Hermes is currently unavailable. Saved data remains usable.' : 'The Hermes connection has not been configured yet.'}</p></div></section><section className="settings-card"><div className="settings-icon"><WifiOff size={22}/></div><div><h2>Saved on this device</h2><p>Drafts, recordings and viewed conversations remain available offline. Plugin changes sync when you return. Hermes messages are never automatically resent.</p><p className="subtle-note">Clearing browser storage removes unsynced work.</p><button onClick={() => void refresh()} disabled={!navigator.onLine}>Sync now</button></div></section></>}</>; }
function ShareChooser() {
    const plugins = usePlugins(), core = useApp();
    const [shared] = useState<SharedContent>(() => { const params = new URLSearchParams(location.search); return { title: params.get('title') || '', text: params.get('text') || '', url: params.get('url') || '' }; });
    const destinations = [{ id: 'conversations', title: 'Conversations', path: '/new', plugin: undefined as typeof plugins[number] | undefined }, ...plugins.flatMap(p => (p.definition.shares || []).filter(s => pluginHook(p, () => s.accepts(shared), false)).map(s => ({ ...s, id: `${p.id}:${s.id}`, plugin: p })))];
    const [choice, setChoice] = useState<string>();
    const selected = destinations.find(d => d.id === (choice || (destinations.length === 1 ? 'conversations' : '')));
    if (core.plugins.entries.some(e => e.enabled && !plugins.some(p => p.id === e.manifest.id) && !pluginError(e.manifest.id)))
        return <div className="empty">Opening share destinations…</div>;
    if (selected?.id === 'conversations')
        return <NewConversation shared={shared}/>;
    if (selected?.plugin) {
        const p = selected.plugin, Screen = matchPluginRoute(p, selected.path)?.component;
        return Screen ? <PluginContent plugin={p}><Screen path={selected.path} parts={selected.path.split('/').filter(Boolean)} shared={shared}/></PluginContent> : <PluginUnavailable id={p.id}/>;
    }
    return <><h1>Share to Herts</h1><p>Choose where to save this content.</p><div className="share-destinations">{destinations.map(d => <button key={d.id} onClick={() => setChoice(d.id)}>{d.title}</button>)}</div><a href="#/conversations">Cancel</a></>;
}
