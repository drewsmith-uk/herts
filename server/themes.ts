import type { FastifyInstance } from 'fastify';
import { builtinThemes, defaultThemeId } from '../shared/themeValues.js';

export function registerThemes(app: FastifyInstance) {
  app.get('/api/v1/themes', async () => ({ defaultThemeId, themes: builtinThemes, errors: [] }));
  app.get('/_themes/:file', async (_request, reply) => reply.code(404).send({ error: 'Custom theme fonts are no longer supported.' }));
}
