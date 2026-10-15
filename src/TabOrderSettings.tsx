import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowUp, ArrowDown, GripVertical, Settings } from 'lucide-react';
import { useHoldSensors } from './dragging';
import { IconButton, SettingsSection, StatusMessage } from './ui';
import { PluginIcon } from './plugins';
import { useNavigationTabs, useNavigationLayout } from './navigationLayout';
import { setNavigationOrder, useNavigationPreferences, moveNavigation, moreDividerId } from './navigationPreferences';
import type { NavigationTab } from './ShellNavigation';

export function TabOrderSettings() {
  const tabs = useNavigationTabs(), preferences = useNavigationPreferences(), sensors = useHoldSensors();
  const { capacity, maximum, measurement } = useNavigationLayout(tabs);
  const order = tabs.map(tab => tab.id);
  const items = [...order.slice(0, capacity), moreDividerId, ...order.slice(capacity)];
  const move = (from: number, to: number) => {
    if (from < 0 || to < 0 || to >= items.length) return;
    if (from === capacity + 1 && to === capacity && capacity === maximum && capacity > 0) to--;
    const next = moveNavigation(order, capacity, maximum, from, to);
    setNavigationOrder(next.order, [...next.more, ...preferences.more.filter(id => !order.includes(id))]);
  };
  return <SettingsSection collapsible className="tab-order" title="Tab order" description="Drag to reorder on this device.">
    {measurement}
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => {
      if (over && active.id !== over.id) move(items.indexOf(String(active.id)), items.indexOf(String(over.id)));
    }}>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <div className="tab-order-label">Main tabs</div>
        {items.map((id, index) => id === moreDividerId ? <MoreDivider key={id}/> : <TabOrderRow key={id} tab={tabs.find(tab => tab.id === id)!} index={index} count={items.length} move={move}/>)}
        <div className="tab-order-fixed"><Settings size={20}/><span>Settings</span></div>
      </SortableContext>
    </DndContext>
    {preferences.error && <StatusMessage>{preferences.error}</StatusMessage>}
  </SettingsSection>;
}
function TabOrderRow({ tab, index, count, move }: { tab: NavigationTab; index: number; count: number; move(from: number, to: number): void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id });
  return <div ref={setNodeRef} className={`tab-order-row ${isDragging ? 'dragging' : ''}`} data-tab-id={tab.id} style={{ transform: CSS.Transform.toString(transform), transition }}>
    <button ref={setActivatorNodeRef} type="button" className="icon-button tab-order-handle" {...attributes} {...listeners} aria-label={`Drag ${tab.title}`}><GripVertical size={18}/></button>
    <PluginIcon id={tab.id} icon={tab.Icon} size={20}/><span className="tab-order-name">{tab.title}</span>
    <div className="tab-order-actions"><IconButton aria-label={`Move ${tab.title} up`} disabled={index === 0} onClick={() => move(index, index - 1)}><ArrowUp size={17}/></IconButton><IconButton aria-label={`Move ${tab.title} down`} disabled={index === count - 1} onClick={() => move(index, index + 1)}><ArrowDown size={17}/></IconButton></div>
  </div>;
}

function MoreDivider() {
  const { setNodeRef } = useSortable({id: moreDividerId, disabled: {draggable: true}});
  return <div ref={setNodeRef} className="tab-order-divider">More</div>;
}
