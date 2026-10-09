import fieldwork from '../themes/builtin/fieldwork.json' with { type: 'json' };
import edition from '../themes/builtin/edition.json' with { type: 'json' };
import signal from '../themes/builtin/signal.json' with { type: 'json' };
import nocturne from '../themes/builtin/nocturne.json' with { type: 'json' };
import studio from '../themes/builtin/studio.json' with { type: 'json' };
import press from '../themes/builtin/press.json' with { type: 'json' };

// Lightweight values and validation for the blocking startup script. No schema
// library, React or app state is loaded before first paint.
export interface Theme {
  schemaVersion: 1; id: string; name: string; description: string; mode: 'light' | 'dark';
  colors: typeof fieldwork.colors; typography: typeof fieldwork.typography; radii: typeof fieldwork.radii;
  elevation: 'flat' | 'soft' | 'raised';
  treatment?: { borderWidth?: number; actionShadow?: number; labels?: 'body' | 'mono'; navigation?: 'indicator' | 'filled' };
  fonts: { family: string; weight: string; style: 'normal' | 'italic'; href: string }[];
}
export const defaultThemeId = 'press';
export const themeStorageKey = 'herts:appearance:v1';
export const themeFontCache = 'herts-theme-fonts-v1';
export const builtinThemes: Theme[] = [fieldwork, edition, signal, nocturne, studio, press].map(input => ({
  schemaVersion: 1, id: input.id, name: input.name, description: input.description,
  mode: ('mode' in input ? input.mode : fieldwork.mode) as Theme['mode'],
  colors: { ...fieldwork.colors, ...input.colors },
  typography: { ...fieldwork.typography, ...('typography' in input ? input.typography : {}) },
  radii: { ...fieldwork.radii, ...input.radii }, elevation: input.elevation as Theme['elevation'], fonts: [],
  ...('treatment' in input ? { treatment: input.treatment as Theme['treatment'] } : {}),
}));
export const defaultTheme = builtinThemes.find(theme => theme.id === defaultThemeId)!;
export const maxThemeCount = builtinThemes.length + 64;
export const themeApiVersion = '3';
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max: number, pattern?: RegExp): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && (!pattern || pattern.test(value));
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export function isTheme(value: unknown): value is Theme {
  if (!record(value) || !exactKeys(value, [...Object.keys(defaultTheme).filter(key => key !== 'treatment'), ...(Object.hasOwn(value, 'treatment') ? ['treatment'] : [])])) return false;
  if (value.schemaVersion !== 1 || !text(value.id, 64, /^[a-z][a-z0-9-]*$/) || !text(value.name, 60) ||
      typeof value.description !== 'string' || value.description.length > 200 || (value.mode !== 'light' && value.mode !== 'dark') ||
      (value.elevation !== 'flat' && value.elevation !== 'soft' && value.elevation !== 'raised')) return false;
  if (!record(value.colors) || !exactKeys(value.colors, Object.keys(defaultTheme.colors))) return false;
  for (const [key, color] of Object.entries(value.colors)) {
    if (!text(color, 9, ['backdrop', 'shadow'].includes(key) ? /^#[\da-f]{6}([\da-f]{2})?$/i : /^#[\da-f]{6}$/i)) return false;
  }
  const type = value.typography;
  if (!record(type) || !exactKeys(type, Object.keys(defaultTheme.typography))) return false;
  for (const key of ['bodyFont', 'headingFont', 'monoFont']) if (!text(type[key], 200, /^[\w\s,'"-]+$/)) return false;
  if (typeof type.headingWeight !== 'number' || !Number.isInteger(type.headingWeight) || type.headingWeight < 400 || type.headingWeight > 900) return false;
  if (Object.hasOwn(value, 'treatment')) {
    const treatment = value.treatment;
    if (!record(treatment) || Object.keys(treatment).some(key => !['borderWidth', 'actionShadow', 'labels', 'navigation'].includes(key))) return false;
    for (const [key, min, max] of [['borderWidth', 1, 2], ['actionShadow', 0, 4]] as const) {
      if (key in treatment && (typeof treatment[key] !== 'number' || !Number.isFinite(treatment[key]) || treatment[key] < min || treatment[key] > max)) return false;
    }
    if ('labels' in treatment && treatment.labels !== 'body' && treatment.labels !== 'mono') return false;
    if ('navigation' in treatment && treatment.navigation !== 'indicator' && treatment.navigation !== 'filled') return false;
  }
  if (!record(value.radii) || !exactKeys(value.radii, Object.keys(defaultTheme.radii)) ||
      Object.values(value.radii).some(radius => typeof radius !== 'number' || !Number.isFinite(radius) || radius < 0 || radius > 20)) return false;
  return Array.isArray(value.fonts) && value.fonts.length <= 8 && value.fonts.every(font => record(font) &&
    exactKeys(font, ['family', 'weight', 'style', 'href']) && text(font.family, 80, /^[\w -]+$/) &&
    text(font.weight, 7, /^[1-9]00(?: [1-9]00)?$/) && (font.style === 'normal' || font.style === 'italic') &&
    text(font.href, 80, /^\/_themes\/[a-f0-9]{64}\.woff2$/));
}
const kebab = (value: string) => value.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
export function themeProperties(theme: Theme): Record<string, string> {
  const treatment = theme.treatment, offset = treatment?.actionShadow ?? 0, filled = treatment?.navigation === 'filled';
  const tabOutline = 'inset 0 0 0 var(--border-width) var(--color-selected-text)';
  return {
    ...Object.fromEntries(Object.entries(theme.colors).map(([key, value]) => [`--color-${kebab(key)}`, value])),
    '--font-body': theme.typography.bodyFont, '--font-heading': theme.typography.headingFont,
    '--font-mono': theme.typography.monoFont, '--weight-heading': String(theme.typography.headingWeight),
    '--font-label': treatment?.labels === 'mono' ? theme.typography.monoFont : theme.typography.bodyFont,
    '--border-width': `${treatment?.borderWidth ?? 1}px`,
    '--shadow-action': offset ? `${offset}px ${offset}px 0 var(--color-shadow)` : 'none',
    '--shadow-nav-active': filled ? 'inset 0 0 0 var(--border-width) var(--color-sidebar-selected-text)' : 'inset 3px 0 var(--color-sidebar-selected-text)',
    '--shadow-tab-active': filled ? tabOutline : 'inset 0 -2px var(--color-selected-text)',
    '--mobile-active-background': filled ? 'var(--color-selected)' : 'transparent',
    ...Object.fromEntries(Object.entries(theme.radii).map(([key, value]) => [`--radius-${key}`, `${value}px`])),
    '--shadow-surface': theme.elevation === 'flat' ? 'none' : theme.elevation === 'soft' ? '0 2px 8px var(--color-shadow)' : '0 4px 14px var(--color-shadow)',
    '--shadow-floating': offset ? `${offset + 1}px ${offset + 1}px 0 var(--color-shadow)` : '0 12px 36px var(--color-shadow)',
  };
}
