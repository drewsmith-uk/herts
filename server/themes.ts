import type { FastifyInstance } from 'fastify';
import { builtinThemes, defaultThemeId, themeApiVersion } from '../shared/themeValues.js';

export function registerThemes(app: FastifyInstance) {
  app.get('/api/v1/themes', async request => {
    const catalogue = { defaultThemeId, themes: builtinThemes, errors: [] };
    // Open tabs on the previous release have a strict theme validator. Keep
    // their catalogue usable while the new app version waits to be applied.
    if (request.headers['x-herts-theme-api'] === '2') return catalogue;
    if (request.headers['x-herts-theme-api'] !== themeApiVersion) return { ...catalogue, themes: catalogue.themes.map(({ treatment: _treatment, ...theme }) => ({
      ...theme, typography: { ...theme.typography, headingWeight: Math.min(theme.typography.headingWeight, 750) },
    })) };
    return catalogue;
  });
  app.get('/_themes/:file', async (_request, reply) => reply.code(404).send({ error: 'Custom theme fonts are no longer supported.' }));
}
