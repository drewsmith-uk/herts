import { useSyncExternalStore } from 'react';
import { builtinThemes, themeStorageKey } from '../shared/themeValues';
import { applyTheme, readAppearance } from './themeAppearance';

function storedAppearance() {
  try { return localStorage.getItem(themeStorageKey); } catch { return undefined; }
}
let observedAppearance = storedAppearance();
const cached = readAppearance();
let state = { selected: cached.theme, themes: cached.catalogue, notice: cached.notice, storageError: '' };
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const getSnapshot = () => state;
export const useThemes = () => useSyncExternalStore(subscribe, getSnapshot);
function publish(patch: Partial<typeof state>) { state = { ...state, ...patch }; listeners.forEach(listener => listener()); }
function syncAppearance() {
  const raw = storedAppearance();
  if (raw === undefined || raw === observedAppearance) return;
  observedAppearance = raw;
  const saved = readAppearance();
  applyTheme(saved.theme);
  publish({ selected: saved.theme, themes: saved.catalogue, storageError: '', notice: saved.notice });
}
function persist() {
  try {
    const raw = JSON.stringify({ id: state.selected.id, theme: state.selected });
    localStorage.setItem(themeStorageKey, raw);
    observedAppearance = raw;
    publish({ storageError: '' });
  } catch { publish({ storageError: 'Your theme is applied, but this browser could not save it for your next visit.' }); }
}
export function selectTheme(id: string) {
  const selected = builtinThemes.find(theme => theme.id === id);
  if (!selected) return;
  applyTheme(selected);
  publish({ selected, notice: '' });
  persist();
}
export function initialiseThemes() {
  syncAppearance();
  applyTheme(state.selected);
  persist();
  window.addEventListener('storage', event => {
    if (event.key !== themeStorageKey && event.key !== null) return;
    syncAppearance();
  });
}
