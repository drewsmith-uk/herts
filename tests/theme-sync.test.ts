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

it('keeps Press after old cross-tab choices without requesting a server catalogue', async () => {
  vi.resetModules();
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const { initialiseThemes, selectTheme } = await import('../src/themes');
  initialiseThemes(); selectTheme('press');
  localStorage.setItem(themeStorageKey, JSON.stringify({ id: 'nocturne', theme: theme('nocturne') }));
  window.dispatchEvent(new dom.window.StorageEvent('storage', { key: themeStorageKey }));
  expect(document.documentElement.dataset.theme).toBe('press');
  expect(JSON.parse(localStorage.getItem(themeStorageKey)!).id).toBe('nocturne');
  expect(fetch).not.toHaveBeenCalled();
  selectTheme('custom');
  expect(document.documentElement.dataset.theme).toBe('press');
});

it('keeps the current choice when storage rejects writes', async () => {
  vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ id: 'press' }), setItem: () => { throw new Error('Storage unavailable'); } });
  vi.resetModules();
  const { initialiseThemes, selectTheme } = await import('../src/themes');
  initialiseThemes(); selectTheme('nocturne');
  expect(document.documentElement.dataset.theme).toBe('press');
});
