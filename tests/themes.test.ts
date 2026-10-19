import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { builtinThemes, defaultTheme, themeProperties, themeStorageKey, themeApiVersion } from '../shared/themeValues';
import { createApp } from '../server/app';
import { readAppearance, applyTheme } from '../src/themeAppearance';

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); vi.unstubAllGlobals(); });
async function folder() {
  const dir = await mkdtemp(join(tmpdir(), 'herts-themes-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
function contrast(a: string, b: string) {
  const luminance = (hex: string) => hex.slice(1).match(/../g)!.map(value => parseInt(value, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const values = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (values[1] + .05) / (values[0] + .05);
}

describe('built-in themes', () => {
  it('ships only Press while retaining the theme API', () => {
    expect(builtinThemes.map(t => t.id)).toEqual(['press']);
    expect(defaultTheme.id).toBe('press');
    expect(defaultTheme.colors.background).toBe('#F4F2EC');
    expect(themeProperties(defaultTheme)['--radius-panel']).toBe('0px');
  });
  it('keeps text and meaningful controls readable across the built-in palettes', () => {
    const pairs: [keyof typeof defaultTheme.colors, keyof typeof defaultTheme.colors][] = [
      ['text', 'background'], ['text', 'surface'], ['text', 'userMessage'], ['textSecondary', 'background'],
      ['textSecondary', 'surface'], ['primaryActionText', 'primaryAction'], ['primaryActionText', 'primaryActionHover'],
      ['sidebarText', 'sidebar'], ['sidebarMuted', 'sidebar'], ['sidebarSelectedText', 'sidebarSelected'],
      ['selectedText', 'selected'], ['warning', 'warningSurface'], ['danger', 'dangerSurface'], ['success', 'successSurface'],
    ];
    for (const theme of builtinThemes) {
      for (const [a, b] of pairs) expect(contrast(theme.colors[a], theme.colors[b]), `${theme.id}: ${a} on ${b}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.colors.controlBorder, theme.colors.surface), `${theme.id}: control boundary`).toBeGreaterThanOrEqual(3);
      expect(contrast(theme.colors.focus, theme.colors.background), `${theme.id}: focus`).toBeGreaterThanOrEqual(3);
    }
  });
});

it('serves the current Press catalogue without legacy variants under existing authentication', async () => {
  const { app } = await createApp({ dataDir: await folder(), origin: 'https://herts.example.com', identity: 'owner', hermesBase: '', hermesToken: '' });
  cleanup.unshift(() => app.close());
  const headers = { host: 'herts.example.com', 'tailscale-user-login': 'owner', 'x-herts-theme-api': themeApiVersion };
  expect((await app.inject('/api/v1/themes')).statusCode).toBe(403);
  const current = await app.inject({ url: '/api/v1/themes', headers });
  expect(current.statusCode).toBe(200);
  expect(current.json()).toEqual({ defaultThemeId: 'press', themes: builtinThemes, errors: [] });
  expect(current.headers['cache-control']).toBe('no-store');
  for (const version of [undefined, '1', '2', 'unknown']) {
    const requestHeaders = { host: 'herts.example.com', 'tailscale-user-login': 'owner',
      ...(version ? { 'x-herts-theme-api': version } : {}) };
    const response = await app.inject({ url: '/api/v1/themes', headers: requestHeaders });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(current.json());
    expect(response.headers['cache-control']).toBe('no-store');
  }
  expect((await app.inject({ url: '/_themes/' + 'a'.repeat(64) + '.woff2', headers })).statusCode).toBe(404);
});

it('ignores stored custom tokens and fonts while preserving built-in selections', () => {
  const dom = new JSDOM('<html><head><style id="herts-theme-fonts">old font</style></head><body></body></html>', { url: 'https://herts.example.com' });
  cleanup.push(() => dom.window.close());
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('localStorage', dom.window.localStorage);
  localStorage.setItem(themeStorageKey, JSON.stringify({ id: 'custom', theme: { ...defaultTheme, id: 'custom' } }));
  expect(readAppearance().theme).toEqual(defaultTheme);
  expect(readAppearance().catalogue).toEqual(builtinThemes);
  expect(readAppearance().notice).toContain('no longer available');
  for (const theme of builtinThemes) {
    localStorage.setItem(themeStorageKey, JSON.stringify({ id: theme.id, theme: { colors: { text: 'url(https://example.com)' } } }));
    expect(readAppearance().theme).toEqual(theme);
    applyTheme(readAppearance().theme);
    expect(document.documentElement.style.getPropertyValue('--color-text')).toBe(theme.colors.text);
    expect(document.getElementById('herts-theme-fonts')).toBeNull();
  }
  for (const value of ['{', 'null', '{}']) {
    localStorage.setItem(themeStorageKey, value);
    expect(readAppearance().theme).toEqual(defaultTheme);
  }
  vi.stubGlobal('localStorage', { getItem() { throw new Error('Blocked'); } });
  expect(readAppearance().theme).toEqual(defaultTheme);
});
