import type { FastifyInstance } from 'fastify';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';
import { builtinConfigs, defaultThemeId, resolveThemeConfigs, themeConfigSchema, type Theme, type ThemeConfig } from '../shared/themes.js';
import { themeApiVersion } from '../shared/themeValues.js';

async function readContained(root: string, file: string, limit: number) {
  const [base, target] = await Promise.all([realpath(root), realpath(resolve(root, file))]);
  const path = relative(base, target);
  if (path.startsWith('..') || isAbsolute(path)) throw new Error('File must stay inside the themes folder');
  const info = await stat(target);
  if (!info.isFile() || info.size > limit) throw new Error('File is not regular or exceeds the size limit');
  const bytes = await readFile(target);
  if (bytes.length > limit) throw new Error('File exceeds the size limit');
  return bytes;
}

/** Read on request so installing or editing a custom theme never requires an app build/restart. */
export async function themeCatalogue(directory: string) {
  const configs: ThemeConfig[] = [...builtinConfigs], files = new Map<string, string>();
  const errors: { file: string; message: string }[] = [], fonts = new Map<string, Buffer>();
  let names: string[];
  try { names = (await readdir(directory)).filter(name => name.endsWith('.json')).sort(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') errors.push({ file: 'Themes folder', message: 'The themes folder could not be read.' });
    names = [];
  }
  if (names.length > 64) errors.push({ file: 'Themes folder', message: 'Only the first 64 JSON files are loaded.' });
  for (const file of names.slice(0, 64)) {
    try {
      const parsed = themeConfigSchema.safeParse(JSON.parse((await readContained(directory, file, 64 * 1024)).toString('utf8')));
      if (!parsed.success) throw new Error(parsed.error.issues.map(issue => `${issue.path.join('.') || 'theme'}: ${issue.message}`).join('; '));
      if (builtinConfigs.some(theme => theme.id === parsed.data.id)) throw new Error('Built-in theme IDs are reserved; use a new ID and extends.');
      files.set(parsed.data.id, file);
      configs.push(parsed.data);
    } catch (error) {
      errors.push({ file, message: error instanceof SyntaxError ? 'Invalid JSON.' : error instanceof Error && !('code' in error) ? error.message : 'Theme file could not be read.' });
    }
  }
  const resolved = resolveThemeConfigs(configs), themes: Theme[] = [];
  errors.push(...resolved.errors.map(error => ({ file: files.get(error.id) || error.id, message: error.message })));
  let fontBytes = 0;
  for (const theme of resolved.themes) {
    try {
      const loaded: Theme['fonts'] = [];
      for (const font of theme.fonts) {
        const bytes = await readContained(directory, font.file, 2 * 1024 * 1024);
        if (bytes.subarray(0, 4).toString() !== 'wOF2') throw new Error('Fonts must be WOFF2 files.');
        const hash = createHash('sha256').update(bytes).digest('hex');
        if (!fonts.has(hash)) {
          fontBytes += bytes.length;
          if (fontBytes > 16 * 1024 * 1024) throw new Error('Theme fonts exceed the combined 16 MB limit.');
          fonts.set(hash, bytes);
        }
        loaded.push({ family: font.family, weight: font.weight, style: font.style, href: `/_themes/${hash}.woff2` });
      }
      themes.push({ ...theme, fonts: loaded });
    } catch {
      errors.push({ file: files.get(theme.id) || theme.id, message: 'A theme font is missing, invalid, outside the themes folder, or exceeds the size limit.' });
    }
  }
  return { defaultThemeId, themes, errors, fonts };
}

export function registerThemes(app: FastifyInstance, directory: string) {
  app.get('/api/v1/themes', async request => {
    const { fonts: _fonts, ...catalogue } = await themeCatalogue(directory);
    // Open tabs on the previous release have a strict theme validator. Keep
    // their catalogue usable while the new app version waits to be applied.
    if (request.headers['x-herts-theme-api'] === '2') return { ...catalogue, defaultThemeId: 'fieldwork' };
    if (request.headers['x-herts-theme-api'] !== themeApiVersion) return { ...catalogue, defaultThemeId: 'fieldwork', themes: catalogue.themes.filter(theme => theme.id !== 'press').slice(0, 69).map(({ treatment: _treatment, ...theme }) => ({
      ...theme, typography: { ...theme.typography, headingWeight: Math.min(theme.typography.headingWeight, 750) },
    })) };
    return catalogue;
  });
  app.get('/_themes/:file', async (request, reply) => {
    const { file } = request.params as { file: string };
    if (!/^[a-f0-9]{64}\.woff2$/.test(file)) return reply.code(404).send({ error: 'Theme font not found.' });
    const bytes = (await themeCatalogue(directory)).fonts.get(file.slice(0, -6));
    if (!bytes) return reply.code(404).send({ error: 'Theme font not found.' });
    return reply.type('font/woff2').header('Cache-Control', 'private, max-age=31536000, immutable').send(bytes);
  });
}
