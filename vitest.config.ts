import { defineConfig } from 'vitest/config';
export default defineConfig({ resolve: { alias: { '@herts/plugin-api/types': new URL('./sdk/types.ts', import.meta.url).pathname } }, test: { include: ['tests/**/*.test.ts'] } });
