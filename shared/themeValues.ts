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
  fonts: [];
}
export const defaultThemeId = 'press';
export const themeStorageKey = 'herts:appearance:v1';
export const builtinThemes: Theme[] = [fieldwork, edition, signal, nocturne, studio, press].map(input => ({
  schemaVersion: 1, id: input.id, name: input.name, description: input.description,
  mode: ('mode' in input ? input.mode : fieldwork.mode) as Theme['mode'],
  colors: { ...fieldwork.colors, ...input.colors },
  typography: { ...fieldwork.typography, ...('typography' in input ? input.typography : {}) },
  radii: { ...fieldwork.radii, ...input.radii }, elevation: input.elevation as Theme['elevation'], fonts: [],
  ...('treatment' in input ? { treatment: input.treatment as Theme['treatment'] } : {}),
}));
export const defaultTheme = builtinThemes.find(theme => theme.id === defaultThemeId)!;
export const themeApiVersion = '3';
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
