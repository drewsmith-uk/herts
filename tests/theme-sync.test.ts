import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { builtinThemes, defaultTheme, themeStorageKey } from '../shared/themeValues';

const theme = (id: string) => builtinThemes.find(theme => theme.id === id)!;
let dom: JSDOM;
beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://herts.example.com' });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('localStorage', dom.window.localStorage);
});
afterEach(() => { dom.window.close(); vi.unstubAllGlobals(); });

it('preserves a newer theme choice before its storage event arrives', async () => {
  localStorage.clear();
  vi.resetModules();
  let release!: (value: unknown) => void;
  const json = new Promise(resolve => { release = resolve; });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: () => json })));
  const { refreshThemes, selectTheme } = await import('../src/themes');
  selectTheme('press');
  const refresh = refreshThemes();
  localStorage.setItem(themeStorageKey, JSON.stringify({ id: 'nocturne', theme: theme('nocturne') }));
  release({ defaultThemeId: defaultTheme.id, themes: builtinThemes, errors: [] });
  await refresh;
  expect(document.documentElement.dataset.theme).toBe('nocturne');
  expect(JSON.parse(localStorage.getItem(themeStorageKey)!).id).toBe('nocturne');
});

it('keeps a local choice when storage rejects writes during refresh', async () => {
  const raw = JSON.stringify({ id: 'press', theme: theme('press') });
  vi.stubGlobal('localStorage', { getItem: () => raw, setItem: () => { throw new Error('Storage unavailable'); } });
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ defaultThemeId: defaultTheme.id, themes: builtinThemes, errors: [] }) })));
  const { refreshThemes, selectTheme } = await import('../src/themes');
  selectTheme('nocturne');
  await refreshThemes();
  expect(document.documentElement.dataset.theme).toBe('nocturne');
});
