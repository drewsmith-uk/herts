import { useSyncExternalStore } from 'react';
import { defaultTheme, isTheme, themeStorageKey, themeFontCache, maxThemeCount, themeApiVersion, type Theme } from '../shared/themeValues';
import { applyTheme, readAppearance } from './themeAppearance';

const cached = readAppearance();
let state = { selected: cached.theme, themes: cached.catalogue, loading: false, notice: '', refreshError: '', storageError: '', errors: [] as { file: string; message: string }[] };
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const getSnapshot = () => state;
export const useThemes = () => useSyncExternalStore(subscribe, getSnapshot);
function publish(patch: Partial<typeof state>) { state = { ...state, ...patch }; listeners.forEach(listener => listener()); }
function persist() {
  try {
    localStorage.setItem(themeStorageKey, JSON.stringify({ id: state.selected.id, theme: state.selected, catalogue: state.themes }));
    publish({ storageError: '' });
  } catch { publish({ storageError: 'Your theme is applied, but this browser could not save it for your next visit.' }); }
}
async function cacheFonts(theme: Theme) {
  if (!theme.fonts.length || !('caches' in window)) return;
  try {
    const cache = await caches.open(themeFontCache);
    await Promise.all(theme.fonts.map(async font => { if (!await cache.match(font.href)) await cache.add(font.href); }));
  } catch { /* System font fallbacks remain available offline. */ }
}
export function selectTheme(id: string) {
  const selected = state.themes.find(theme => theme.id === id);
  if (!selected) return;
  applyTheme(selected);
  publish({ selected, notice: '' });
  persist();
  void cacheFonts(selected);
}
let refreshing: Promise<void> | undefined;
class ThemeRefreshError extends Error {}
const invalidCatalogueMessage = 'Herts returned an unreadable theme list. Try again; if this continues, update and restart the Herts app service.';
const offlineMessage = 'You are offline. Custom themes will refresh automatically when you reconnect.';
const availableThemesMessage = 'The themes listed here still work.';
export function refreshThemes(): Promise<void> {
  if (refreshing) return refreshing;
  publish({ loading: true });
  refreshing = (async () => {
    try {
      const response = await fetch('/api/v1/themes', { headers: { 'X-Herts-Theme-API': themeApiVersion }, cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!response.ok) {
        if (response.status === 404) throw new ThemeRefreshError('This Herts server does not provide a theme list yet. Restart the Herts app service to load the update, then try again.');
        if (response.status === 401 || response.status === 403) throw new ThemeRefreshError('Herts could not verify access. Open Herts using its usual Tailscale address, then try again.');
        throw new ThemeRefreshError('Herts could not load custom themes. Try again in a moment.');
      }
      const catalogue = await response.json().catch(() => { throw new ThemeRefreshError(invalidCatalogueMessage); });
      if (!catalogue || catalogue.defaultThemeId !== 'fieldwork' || !Array.isArray(catalogue.themes) || !catalogue.themes.length || catalogue.themes.length > maxThemeCount ||
          !catalogue.themes.every(isTheme) || !Array.isArray(catalogue.errors) || catalogue.errors.length > 200 ||
          !catalogue.errors.every((error: {file?: unknown; message?: unknown}) => error && typeof error.file === 'string' && typeof error.message === 'string')) throw new ThemeRefreshError(invalidCatalogueMessage);
      const themes: Theme[] = catalogue.themes;
      if (!themes.some(theme => theme.id === defaultTheme.id) || new Set(themes.map(t => t.id)).size !== themes.length) throw new ThemeRefreshError(invalidCatalogueMessage);
      // Use the current selection, not the selection at request start: switching
      // while a refresh is in flight must not be undone by its response.
      const found = themes.find(theme => theme.id === state.selected.id);
      const selected = found || defaultTheme;
      applyTheme(selected);
      publish({ selected, themes, errors: catalogue.errors, refreshError: '',
        notice: found ? '' : 'The selected theme is unavailable. Fieldwork is now selected.' });
      persist();
      void cacheFonts(selected);
    } catch (error) {
      const message = !navigator.onLine
        ? offlineMessage
        : error instanceof ThemeRefreshError ? error.message
        : error instanceof Error && error.name === 'TimeoutError'
          ? 'Herts took too long to return the theme list. Try again in a moment.'
          : 'Could not reach Herts to refresh custom themes. Check your connection to Herts, then try again.';
      publish({ refreshError: `${message} ${availableThemesMessage}` });
    } finally { publish({ loading: false }); refreshing = undefined; }
  })();
  return refreshing;
}
export function initialiseThemes() {
  applyTheme(state.selected);
  void refreshThemes();
  window.addEventListener('online', () => { void refreshThemes(); });
  window.addEventListener('offline', () => { publish({ refreshError: `${offlineMessage} ${availableThemesMessage}` }); });
  window.addEventListener('storage', event => {
    if (event.key !== themeStorageKey && event.key !== null) return;
    const saved = readAppearance();
    applyTheme(saved.theme);
    publish({ selected: saved.theme, themes: saved.catalogue, storageError: '', notice: '' });
  });
}
