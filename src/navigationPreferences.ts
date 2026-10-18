import { useSyncExternalStore } from 'react';

export const navigationStorageKey = 'herts-navigation-order';
type Preferences = { order: string[]; more: string[]; error: string };
let snapshot: Preferences = { order: [], more: [], error: '' };
const listeners = new Set<() => void>();
const ids = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string'))] : [];
function read() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(navigationStorageKey) || 'null');
    snapshot = { order: ids(Array.isArray(saved) ? saved : saved?.order), more: ids(saved && !Array.isArray(saved) ? saved.more : saved ? [] : JSON.parse(window.localStorage.getItem('herts-navigation-more') || '[]')), error: '' };
  } catch { snapshot = { ...snapshot, error: 'Navigation preferences could not be read on this device.' }; }
}
read();
window.addEventListener('storage', event => {
  if (event.key === navigationStorageKey || event.key === 'herts-navigation-more' || event.key === null) { read(); listeners.forEach(listener => listener()); }
});
export function orderedNavigation(available: string[], preferences = snapshot): string[] {
  const initial = preferences.order.length ? preferences.order : [...available.filter(id => !preferences.more.includes(id)), ...available.filter(id => preferences.more.includes(id))];
  const order = [...initial.filter(id => available.includes(id)), ...available.filter(id => !initial.includes(id))];
  return [...order.filter(id => !preferences.more.includes(id)), ...order.filter(id => preferences.more.includes(id))];
}
export function setNavigationOrder(order: string[], more = snapshot.more) {
  const next = [...order, ...snapshot.order.filter(id => !order.includes(id))];
  try { window.localStorage.setItem(navigationStorageKey, JSON.stringify({order: next, more})); snapshot = { order: next, more, error: '' }; }
  catch { snapshot = { ...snapshot, error: 'Navigation preferences could not be saved. Try again.' }; }
  listeners.forEach(listener => listener());
}
export function useNavigationPreferences() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => snapshot);
}
export function fitNavigation(widths: number[], available: number): number {
  let count = 0;
  while (count < Math.min(5, widths.length) && Math.max(72, ...widths.slice(0, count + 1)) * (count + 2) <= available) count++;
  return count;
}

export const moreDividerId = '__navigation_more__';
export function moveNavigation(order: string[], boundary: number, maximum: number, from: number, to: number) {
  const items = [...order.slice(0, boundary), moreDividerId, ...order.slice(boundary)];
  const [item] = items.splice(from, 1);
  items.splice(to, 0, item);
  const nextBoundary = Math.min(items.indexOf(moreDividerId), maximum);
  const next = items.filter(id => id !== moreDividerId);
  return {order: next, more: next.slice(nextBoundary)};
}
