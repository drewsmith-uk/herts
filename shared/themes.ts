import { z } from 'zod';
import fieldwork from '../themes/builtin/fieldwork.json' with { type: 'json' };
import edition from '../themes/builtin/edition.json' with { type: 'json' };
import signal from '../themes/builtin/signal.json' with { type: 'json' };
import nocturne from '../themes/builtin/nocturne.json' with { type: 'json' };
import studio from '../themes/builtin/studio.json' with { type: 'json' };
import press from '../themes/builtin/press.json' with { type: 'json' };

const color = z.string().regex(/^#[\da-f]{6}$/i, 'Use a six-digit hex colour');
const translucent = z.string().regex(/^#[\da-f]{6}([\da-f]{2})?$/i, 'Use a six- or eight-digit hex colour');
export const colorSchema = z.object({
  background: color, surface: color, surfaceMuted: color, surfaceHover: color,
  text: color, textSecondary: color, border: color, controlBorder: color, link: color,
  primaryAction: color, primaryActionHover: color, primaryActionText: color,
  selected: color, selectedText: color, focus: color,
  sidebar: color, sidebarText: color, sidebarMuted: color, sidebarSelected: color,
  sidebarSelectedText: color, sidebarBorder: color, userMessage: color, code: color,
  success: color, successSurface: color, warning: color, warningSurface: color,
  warningBorder: color, danger: color, dangerSurface: color, dangerBorder: color,
  backdrop: translucent, shadow: translucent,
}).strict();
const fontStack = z.string().min(1).max(200).regex(/^[\w\s,'"-]+$/, 'Use a font family stack, without CSS declarations or URLs');
const typographySchema = z.object({
  bodyFont: fontStack, headingFont: fontStack, monoFont: fontStack,
  headingWeight: z.number().int().min(400).max(900),
}).strict();
const treatmentSchema = z.object({
  borderWidth: z.number().min(1).max(2).optional(),
  actionShadow: z.number().min(0).max(4).optional(),
  labels: z.enum(['body', 'mono']).optional(),
  navigation: z.enum(['indicator', 'filled']).optional(),
}).strict();
const radius = z.number().min(0).max(20);
const radiiSchema = z.object({ control: radius, panel: radius, small: radius }).strict();
const fontProperties = {
  family: z.string().min(1).max(80).regex(/^[\w -]+$/),
  weight: z.string().regex(/^[1-9]00(?: [1-9]00)?$/).default('400'),
  style: z.enum(['normal', 'italic']).default('normal'),
};
const fontConfigSchema = z.object({ ...fontProperties,
  file: z.string().max(240).regex(/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.woff2$/),
}).strict();
const resolvedFontSchema = z.object({ ...fontProperties,
  href: z.string().regex(/^\/_themes\/[a-f0-9]{64}\.woff2$/),
}).strict();
const metadata = {
  schemaVersion: z.literal(1), id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  name: z.string().trim().min(1).max(60), description: z.string().max(200).default(''),
};
export const themeConfigSchema = z.object({
  ...metadata, extends: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).optional(),
  mode: z.enum(['light', 'dark']).optional(), colors: colorSchema.partial().optional(),
  typography: typographySchema.partial().optional(), radii: radiiSchema.partial().optional(),
  elevation: z.enum(['flat', 'soft', 'raised']).optional(), fonts: z.array(fontConfigSchema).max(8).optional(),
  treatment: treatmentSchema.optional(),
}).strict();
const fullProperties = { ...metadata, mode: z.enum(['light', 'dark']), colors: colorSchema,
  typography: typographySchema, radii: radiiSchema, elevation: z.enum(['flat', 'soft', 'raised']), treatment: treatmentSchema.optional() };
const resolvedConfigSchema = z.object({ ...fullProperties, fonts: z.array(fontConfigSchema).max(8) }).strict();
export const themeSchema = z.object({ ...fullProperties, fonts: z.array(resolvedFontSchema).max(8) }).strict();
export type ThemeConfig = z.infer<typeof themeConfigSchema>;
export type ResolvedThemeConfig = z.infer<typeof resolvedConfigSchema>;
export { builtinThemes, defaultTheme, defaultThemeId, themeStorageKey, themeFontCache, themeProperties } from './themeValues';
export type { Theme } from './themeValues';
export const builtinConfigs = [fieldwork, edition, signal, nocturne, studio, press].map(value => themeConfigSchema.parse(value));

/** Resolve the graph as a whole: order-independent inheritance, no partial/broken themes. */
export function resolveThemeConfigs(configs: ThemeConfig[]) {
  const byId = new Map<string, ThemeConfig>(), duplicates = new Set<string>();
  const themes = new Map<string, ResolvedThemeConfig>(), errors: { id: string; message: string }[] = [];
  for (const config of configs) {
    if (byId.has(config.id)) duplicates.add(config.id);
    byId.set(config.id, config);
  }
  function resolve(id: string, visiting = new Set<string>()): ResolvedThemeConfig {
    if (duplicates.has(id)) throw new Error(`Duplicate theme ID: ${id}`);
    if (visiting.has(id)) throw new Error(`Theme inheritance cycle: ${id}`);
    const saved = themes.get(id);
    if (saved) return saved;
    const config = byId.get(id);
    if (!config) throw new Error(`Parent theme not found: ${id}`);
    const path = new Set(visiting).add(id);
    const parentId = config.extends || (id === fieldwork.id ? undefined : fieldwork.id);
    const parent = parentId ? resolve(parentId, path) : undefined;
    const result = resolvedConfigSchema.parse({
      schemaVersion: 1, id, name: config.name, description: config.description,
      mode: config.mode ?? parent?.mode,
      colors: { ...parent?.colors, ...config.colors },
      typography: { ...parent?.typography, ...config.typography },
      radii: { ...parent?.radii, ...config.radii },
      elevation: config.elevation ?? parent?.elevation,
      fonts: config.fonts ?? parent?.fonts ?? [],
      ...(parent?.treatment || config.treatment ? { treatment: { ...parent?.treatment, ...config.treatment } } : {}),
    });
    themes.set(id, result);
    return result;
  }
  for (const id of byId.keys()) {
    try { resolve(id); } catch (error) { errors.push({ id, message: error instanceof Error ? error.message : 'Invalid theme' }); }
  }
  return { themes: [...byId.keys()].flatMap(id => themes.get(id) || []), errors };
}
