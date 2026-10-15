import { useLayoutEffect, useRef, useState } from 'react';
import { MessageSquare, Plug } from 'lucide-react';
import { useApp } from './data';
import { usePlugins } from './plugins';
import { fitNavigation, orderedNavigation, useNavigationPreferences } from './navigationPreferences';
import type { NavigationTab } from './ShellNavigation';

export function useNavigationTabs(): NavigationTab[] {
  const state = useApp(), plugins = usePlugins(), preferences = useNavigationPreferences();
  return orderedNavigation(state.plugins.order, preferences).flatMap(id => {
    if (id === 'conversations') return [{ id, title: 'Conversations', path: '/conversations', Icon: MessageSquare }];
    const tab = plugins.find(plugin => plugin.id === id)?.definition.tab;
    return tab ? [{ id, title: tab.title, path: tab.path, Icon: tab.icon || Plug }] : [];
  });
}
export function useNavigationLayout(tabs: NavigationTab[]) {
  const preferences = useNavigationPreferences();
  const measure = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ capacity: 0, widths: [] as number[] });
  const signature = JSON.stringify(tabs.map(tab => [tab.id, tab.title]));
  useLayoutEffect(() => {
    let disposed = false;
    const update = () => {
      if (disposed || !measure.current) return;
      const widths = Array.from(measure.current.children, node => node.getBoundingClientRect().width);
      const capacity = fitNavigation(widths, Math.max(0, document.documentElement.clientWidth - 88));
      setLayout(previous => previous.capacity === capacity && JSON.stringify(previous.widths) === JSON.stringify(widths) ? previous : { capacity, widths });
    };
    const observer = new ResizeObserver(update);
    observer.observe(document.documentElement); observer.observe(measure.current!);
    void document.fonts.ready.then(update);
    document.fonts.addEventListener('loadingdone', update);
    update();
    return () => { disposed = true; observer.disconnect(); document.fonts.removeEventListener('loadingdone', update); };
  }, [signature]);
  const firstMore = tabs.findIndex(tab => preferences.more.includes(tab.id));
  return { ...layout, maximum: layout.capacity, capacity: Math.min(layout.capacity, firstMore < 0 ? tabs.length : firstMore), measurement: <div ref={measure} className="navigation-measure" aria-hidden="true">{tabs.map(tab => <span key={tab.id}>{tab.title}</span>)}</div> };
}
