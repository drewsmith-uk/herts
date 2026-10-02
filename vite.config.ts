import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { buildSync } from 'esbuild';
import { createHash } from 'node:crypto';
import { thirdPartyNotices } from './scripts/licenses.mjs';

// A classic script can apply the saved theme before the first app paint, while
// retaining the CSP's script-src 'self'. Hashed output joins the shell precache.
const bootstrap = buildSync({ entryPoints: ['src/themeBootstrap.ts'], bundle: true, write: false, minify: true, format: 'iife', platform: 'browser', target: 'es2022' }).outputFiles[0].text;
const bootstrapFile = `assets/theme-bootstrap-${createHash('sha256').update(bootstrap).digest('hex').slice(0, 12)}.js`;
export default defineConfig({
  esbuild: { legalComments: 'inline' },
  plugins: [react(), {
    name: 'herts-third-party-notices',
    renderChunk(code) { return { code: `/*! Third-party notices: /THIRD_PARTY_NOTICES.txt */\n${code}`, map: null }; },
    async generateBundle(_options, bundle) {
      const inputs = Object.values(bundle).flatMap(item => item.type === 'chunk' ? Object.keys(item.modules) : []);
      this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_NOTICES.txt', source: await thirdPartyNotices(inputs) });
    },
  }, {
    name: 'herts-theme-bootstrap',
    generateBundle() { this.emitFile({ type: 'asset', fileName: bootstrapFile, source: bootstrap }); },
    configureServer(server) { server.middlewares.use(`/${bootstrapFile}`, (_req, response) => { response.setHeader('Content-Type', 'text/javascript'); response.end(bootstrap); }); },
    transformIndexHtml() { return [{ tag: 'script', attrs: { src: `/${bootstrapFile}` }, injectTo: 'head' }]; },
  }],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8787', '/_plugins':'http://127.0.0.1:8787', '/_themes':'http://127.0.0.1:8787' } },
  build: { sourcemap: false, rollupOptions: { output: { manualChunks: { markdown: ['react-markdown', 'remark-gfm'], storage: ['dexie'] } } } },
});
