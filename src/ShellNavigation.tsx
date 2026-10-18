import { useEffect, useRef, useState, type ComponentType } from 'react';
import { ChevronRight, Ellipsis, Settings } from 'lucide-react';
import { Button, DialogFrame, DialogHeading, ItemList, ItemRow } from './ui';
import { PluginIcon } from './plugins';
import { ConnectionBadge, ConnectionStatusRow } from './ConnectionStatusControls';
import { useNavigationLayout } from './navigationLayout';

export interface NavigationTab { id: string; title: string; path: string; Icon: ComponentType<{ size?: number }> }
export function ShellNavigation({ tabs, activeId, path }: { tabs: NavigationTab[]; activeId: string; path: string }) {
  const [dialog, setDialog] = useState<'more'>();
  const nav = useRef<HTMLElement>(null);
  const { capacity, measurement } = useNavigationLayout(tabs);
  const visible = tabs.slice(0, capacity), overflow = tabs.slice(capacity);
  const hasMore = overflow.length > 0, settings = path.startsWith('/settings');
  const overflowActive = settings || overflow.some(tab => tab.id === activeId);
  useEffect(() => { setDialog(undefined); }, [path]);
  useEffect(() => {
    if (!hasMore && dialog === 'more') {
      setDialog(undefined);
      requestAnimationFrame(() => nav.current?.querySelector<HTMLAnchorElement>('.navigation-end')?.focus());
    }
  }, [hasMore, dialog]);
  return <>
    <nav ref={nav} className="mobile-nav adaptive-nav" aria-label="Main navigation">
      {visible.map((tab) => <a key={tab.id} href={`#${tab.path}`} className={activeId === tab.id ? 'active' : ''} aria-current={activeId === tab.id ? 'page' : undefined} title={tab.title}><PluginIcon id={tab.id} icon={tab.Icon} size={21}/><span>{tab.title}</span></a>)}
      {hasMore ? <Button aria-describedby="connection-status-label" className={`navigation-end ${overflowActive ? 'active' : ''}`} aria-haspopup="dialog" aria-expanded={dialog === 'more'} aria-current={overflowActive ? 'page' : undefined} onClick={() => setDialog('more')}><span className="navigation-icon"><Ellipsis size={21}/></span><ConnectionBadge/><span>More</span></Button>
        : <a aria-describedby="connection-status-label" className={`navigation-end ${settings ? 'active' : ''}`} href="#/settings" aria-current={settings ? 'page' : undefined}><span className="navigation-icon"><Settings size={21}/></span><ConnectionBadge/><span>Settings</span></a>}
    </nav>
    {measurement}
    {dialog === 'more' && <DialogFrame className="navigation-sheet" aria-labelledby="navigation-title" close={() => setDialog(undefined)} dismissOnBackdrop>
      <DialogHeading id="navigation-title" close={() => setDialog(undefined)}>More</DialogHeading>
      <ConnectionStatusRow/>
      <ItemList>{overflow.map(tab => <ItemRow key={tab.id} href={`#${tab.path}`} leading={<PluginIcon id={tab.id} icon={tab.Icon} size={21}/>} trailing={<ChevronRight size={18}/>} aria-current={tab.id === activeId ? 'page' : undefined} onClick={() => setDialog(undefined)}>{tab.title}</ItemRow>)}
        <ItemRow href="#/settings" leading={<Settings size={21}/>} trailing={<ChevronRight size={18}/>} aria-current={settings ? 'page' : undefined} onClick={() => setDialog(undefined)}>Settings</ItemRow>
      </ItemList>
    </DialogFrame>}

  </>;
}
