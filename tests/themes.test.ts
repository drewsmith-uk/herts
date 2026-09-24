import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { builtinConfigs, builtinThemes, defaultTheme, resolveThemeConfigs, themeConfigSchema, themeSchema, themeProperties, themeStorageKey } from '../shared/themes';
import { themeCatalogue } from '../server/themes';
import { createApp } from '../server/app';
import { readAppearance, applyTheme } from '../src/themeAppearance';
import { isTheme, themeApiVersion } from '../shared/themeValues';

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); vi.unstubAllGlobals(); });
async function folder() {
  const dir = await mkdtemp(join(tmpdir(), 'herts-themes-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const config = (value: Record<string, unknown>) => themeConfigSchema.parse({ schemaVersion: 1, id: 'woodland', name: 'Woodland', ...value });
function contrast(a: string, b: string) {
  const luminance = (hex: string) => hex.slice(1).match(/../g)!.map(value => parseInt(value, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const values = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (values[1] + .05) / (values[0] + .05);
}

describe('theme configuration and inheritance', () => {
  it('ships six complete themes with Fieldwork as the default', () => {
    expect(builtinThemes.map(t => t.id)).toEqual(['fieldwork', 'edition', 'signal', 'nocturne', 'studio', 'press']);
    expect(defaultTheme.colors.background).toBe('#F4F3ED');
    expect(builtinThemes.find(t => t.id === 'nocturne')?.mode).toBe('dark');
    expect(themeProperties(defaultTheme)['--radius-panel']).toBe('8px');
    expect(resolveThemeConfigs(builtinConfigs).themes).toEqual(builtinThemes);
    expect(builtinThemes.every(isTheme)).toBe(true);
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
  it('resolves multi-level inheritance independently of file order without sharing mutable tokens', () => {
    const child = config({ id: 'child', extends: 'parent', colors: { background: '#EEF1E9' } });
    const parent = config({ id: 'parent', extends: 'edition', typography: { headingWeight: 600 } });
    const result = resolveThemeConfigs([...builtinConfigs, child, parent]);
    expect(result.errors).toEqual([]);
    const theme = result.themes.find(t => t.id === 'child')!;
    expect(theme.colors.background).toBe('#EEF1E9');
    expect(theme.colors.primaryAction).toBe('#252623');
    expect(theme.typography.headingWeight).toBe(600);
    theme.colors.text = '#000000';
    expect(result.themes.find(t => t.id === 'parent')!.colors.text).toBe('#252623');
  });
  it('omits cycles, missing parents and duplicates while retaining unrelated themes', () => {
    const result = resolveThemeConfigs([...builtinConfigs,
      config({ id: 'a', extends: 'b' }), config({ id: 'b', extends: 'a' }),
      config({ id: 'missing', extends: 'absent' }), config({ id: 'duplicate' }), config({ id: 'duplicate' }),
      config({ id: 'child', extends: 'duplicate' }), config({ id: 'healthy' }),
    ]);
    expect(result.themes.map(t => t.id)).toEqual([...builtinThemes.map(t => t.id), 'healthy']);
    expect(result.errors).toHaveLength(5);
  });
  it('rejects unsupported fields, CSS injection, remote fonts and path traversal', () => {
    for (const input of [
      { colors: { background: 'url(https://example.com)' } }, { colors: { surprise: '#FFFFFF' } },
      { typography: { headingFont: 'serif; display:none' } }, { radii: { panel: 1000 } },
      { treatment: { borderWidth: 12 } }, { treatment: { actionShadow: -1 } },
      { treatment: { labels: 'url(https://example.com)' } }, { treatment: { css: 'display:none' } },
      { fonts: [{ family: 'Font', file: '../outside.woff2' }] },
      { fonts: [{ family: 'Font', file: 'https://example.com/font.woff2' }] },
      { schemaVersion: 2 }, { css: 'body{display:none}' },
    ]) expect(() => config(input)).toThrow();
  });
  it('keeps the small startup validator aligned with the resolved server schema', () => {
    for (const value of [
      ...builtinThemes, { ...defaultTheme, mode: ['light'] }, { ...defaultTheme, elevation: ['flat'] },
      { ...defaultTheme, colors: { ...defaultTheme.colors, text: 'red' } },
      { ...defaultTheme, typography: { ...defaultTheme.typography, bodyFont: 'url(https://example.com)' } },
      { ...defaultTheme, radii: { ...defaultTheme.radii, control: -1 } },
      { ...defaultTheme, treatment: {} }, { ...defaultTheme, treatment: { actionShadow: 0, labels: 'mono' } },
      { ...defaultTheme, treatment: { borderWidth: 3 } }, { ...defaultTheme, treatment: { borderWidth: '2' } },
      { ...defaultTheme, treatment: { actionShadow: -1 } }, { ...defaultTheme, treatment: { actionShadow: Infinity } },
      { ...defaultTheme, treatment: { navigation: ['filled'] } }, { ...defaultTheme, treatment: { unknown: true } },
      { ...defaultTheme, typography: { ...defaultTheme.typography, headingWeight: 901 } },
      { ...defaultTheme, extra: 'unknown' },
      { ...defaultTheme, fonts: [{ family: 'Font', href: `/_themes/${'a'.repeat(64)}.woff2`, weight: '400', style: ['normal'] }] },
    ]) expect(isTheme(value)).toBe(themeSchema.safeParse(value).success);
  });
  it('inherits Press treatments by key and allows custom themes to reset them', () => {
    const parent = config({ id: 'press-parent', extends: 'press', treatment: { borderWidth: 1.5 } });
    const child = config({ id: 'press-child', extends: 'press-parent', treatment: { actionShadow: 0, labels: 'body', navigation: 'indicator' } });
    const result = resolveThemeConfigs([...builtinConfigs, child, parent]);
    expect(result.errors).toEqual([]);
    const theme = { ...result.themes.find(theme => theme.id === child.id)!, fonts: [] };
    expect(theme.treatment).toEqual({ borderWidth: 1.5, actionShadow: 0, labels: 'body', navigation: 'indicator' });
    expect(theme.typography.headingWeight).toBe(900);
    expect(themeProperties(theme)).toMatchObject({ '--border-width': '1.5px', '--shadow-action': 'none', '--mobile-active-background': 'transparent', '--font-label': theme.typography.bodyFont });
  });
});

describe('runtime theme catalogue', () => {
  it('discovers additions and edits, isolates invalid files, and retains the built-ins after removal', async () => {
    const dir = await folder();
    expect((await themeCatalogue(dir)).themes).toHaveLength(builtinThemes.length);
    await writeFile(join(dir, 'custom.json'), JSON.stringify(config({ colors: { primaryAction: '#34513B' } })));
    await writeFile(join(dir, 'broken.json'), '{');
    await writeFile(join(dir, 'reserved.json'), JSON.stringify(config({ id: 'fieldwork' })));
    let result = await themeCatalogue(dir);
    expect(result.themes.at(-1)).toMatchObject({ id: 'woodland', colors: { primaryAction: '#34513B' } });
    expect(result.errors).toHaveLength(2);
    await writeFile(join(dir, 'custom.json'), JSON.stringify(config({ name: 'Updated woodland' })));
    result = await themeCatalogue(dir);
    expect(result.themes.at(-1)?.name).toBe('Updated woodland');
    await rm(join(dir, 'custom.json'));
    expect((await themeCatalogue(dir)).themes).toHaveLength(builtinThemes.length);
  });
  it('contains theme/font file reads, and changes font URLs when their content changes', async () => {
    const dir = await folder(), outside = await folder();
    await writeFile(join(outside, 'outside.json'), JSON.stringify(config({ id: 'escaped' })));
    await symlink(join(outside, 'outside.json'), join(dir, 'escaped.json'));
    await writeFile(join(dir, 'font.woff2'), 'wOF2fixture version one');
    await writeFile(join(dir, 'custom.json'), JSON.stringify(config({ fonts: [{ family: 'Local Font', file: 'font.woff2' }] })));
    const first = await themeCatalogue(dir);
    expect(first.errors).toHaveLength(1);
    const href = first.themes.at(-1)!.fonts[0].href;
    expect(href).toMatch(/^\/_themes\/[a-f0-9]{64}\.woff2$/);
    await writeFile(join(dir, 'font.woff2'), 'wOF2fixture version two');
    expect((await themeCatalogue(dir)).themes.at(-1)!.fonts[0].href).not.toBe(href);
    await rm(join(dir, 'font.woff2'));
    await writeFile(join(outside, 'font.woff2'), 'wOF2outside');
    await symlink(join(outside, 'font.woff2'), join(dir, 'font.woff2'));
    const invalid = await themeCatalogue(dir);
    expect(invalid.themes).toHaveLength(builtinThemes.length);
    expect(invalid.errors).toHaveLength(2);
  });
  it('uses the existing private authentication for catalogues and font assets', async () => {
    const dataDir = await folder(), themesDir = await folder();
    await writeFile(join(themesDir, 'font.woff2'), 'wOF2fixture');
    await writeFile(join(themesDir, 'custom.json'), JSON.stringify(config({ fonts: [{ family: 'Local Font', file: 'font.woff2' }] })));
    const { app } = await createApp({ dataDir, themesDir, origin: 'https://herts.example.com', identity: 'owner', hermesBase: '', hermesToken: '' });
    cleanup.unshift(() => app.close());
    const headers = { host: 'herts.example.com', 'tailscale-user-login': 'owner', 'x-herts-theme-api': themeApiVersion };
    expect((await app.inject('/api/v1/themes')).statusCode).toBe(403);
    const response = await app.inject({ url: '/api/v1/themes', headers });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const catalogue = response.json();
    expect(catalogue.fonts).toBeUndefined();
    expect(catalogue.themes.find((theme: { id: string }) => theme.id === 'press')).toMatchObject({ treatment: { actionShadow: 3 }, typography: { headingWeight: 900 } });
    const href = catalogue.themes.at(-1).fonts[0].href;
    expect((await app.inject(href)).statusCode).toBe(403);
    const font = await app.inject({ url: href, headers });
    expect(font.statusCode).toBe(200);
    expect(font.headers['content-type']).toContain('font/woff2');
    expect(font.body).toBe('wOF2fixture');
    expect((await app.inject({ url: '/_themes/secret.woff2', headers })).statusCode).toBe(404);
  });
  it('keeps the catalogue compatible with open pages on the previous theme engine', async () => {
    const dataDir = await folder(), themesDir = await folder();
    await writeFile(join(themesDir, 'custom.json'), JSON.stringify(config({ extends: 'press' })));
    const { app } = await createApp({ dataDir, themesDir, origin: 'http://127.0.0.1', identity: 'fixture', dev: true, hermesBase: '', hermesToken: '' });
    cleanup.unshift(() => app.close());
    const old = (await app.inject('/api/v1/themes')).json();
    expect(old.themes.map((theme: { id: string }) => theme.id)).toEqual(['fieldwork', 'edition', 'signal', 'nocturne', 'studio', 'woodland']);
    for (const theme of old.themes) {
      expect(Object.keys(theme).sort()).toEqual(Object.keys(defaultTheme).sort());
      expect(theme.typography.headingWeight).toBeLessThanOrEqual(750);
      expect(isTheme(theme)).toBe(true);
    }
    const current = (await app.inject({ url: '/api/v1/themes', headers: { 'x-herts-theme-api': themeApiVersion } })).json();
    expect(current.themes).toHaveLength(7);
    expect(current.themes.at(-1).treatment.navigation).toBe('filled');
  });
});

describe('appearance startup cache', () => {
  function browser() {
    const dom = new JSDOM('<!doctype html><html><head><meta name="theme-color" content="old"></head><body></body></html>', { url: 'https://herts.example.com' });
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('localStorage', dom.window.localStorage);
    cleanup.push(() => dom.window.close());
    return dom.window;
  }
  it('restores a custom theme before React and clears custom fonts when switching', () => {
    const win = browser();
    const theme = { ...defaultTheme, id: 'custom', name: 'Custom', fonts: [{ family: 'Local Font', style: 'normal', weight: '400', href: `/_themes/${'a'.repeat(64)}.woff2` }] };
    win.localStorage.setItem(themeStorageKey, JSON.stringify({ id: theme.id, theme, catalogue: [theme] }));
    const saved = readAppearance();
    expect(saved.theme.id).toBe('custom');
    applyTheme(saved.theme);
    expect(win.document.documentElement.dataset.theme).toBe('custom');
    expect(win.document.getElementById('herts-theme-fonts')?.textContent).toContain('Local Font');
    expect(win.document.querySelector('meta')?.content).toBe(defaultTheme.colors.background);
    applyTheme(defaultTheme);
    expect(win.document.getElementById('herts-theme-fonts')?.textContent).toBe('');
  });
  it('falls back to Fieldwork for malformed, tampered, or inaccessible storage', () => {
    const win = browser();
    for (const value of ['{', JSON.stringify({ id: 'other', theme: defaultTheme }), JSON.stringify({ id: 'fieldwork', theme: { ...defaultTheme, fonts: [{ family: 'Bad', href: 'https://example.com/font' }] } })]) {
      win.localStorage.setItem(themeStorageKey, value);
      expect(readAppearance().theme.id).toBe('fieldwork');
    }
    vi.stubGlobal('localStorage', { getItem() { throw new Error('Blocked'); } });
    expect(readAppearance().theme.id).toBe('fieldwork');
  });
  it('preserves older saved themes and resets every Press treatment when switching back', () => {
    const win = browser();
    const previous = { ...defaultTheme, id: 'existing-custom', name: 'Existing custom' };
    win.localStorage.setItem(themeStorageKey, JSON.stringify({ id: previous.id, theme: previous, catalogue: [previous] }));
    expect(readAppearance().theme.id).toBe(previous.id);
    const press = builtinThemes.find(theme => theme.id === 'press')!;
    applyTheme(press);
    const style = win.document.documentElement.style;
    expect(style.getPropertyValue('--border-width')).toBe('2px');
    expect(style.getPropertyValue('--shadow-action')).toBe('3px 3px 0 var(--color-shadow)');
    applyTheme(previous);
    expect(style.getPropertyValue('--border-width')).toBe('1px');
    expect(style.getPropertyValue('--shadow-action')).toBe('none');
    expect(style.getPropertyValue('--mobile-active-background')).toBe('transparent');
    expect(style.getPropertyValue('--font-label')).toBe(previous.typography.bodyFont);
  });
});
