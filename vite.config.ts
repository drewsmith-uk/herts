import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { buildSync } from 'esbuild';
import { createHash } from 'node:crypto';

// A classic script can apply the saved theme before the first app paint, while
// retaining the CSP's script-src 'self'. Hashed output joins the shell precache.
const bootstrap = buildSync({ entryPoints: ['src/themeBootstrap.ts'], bundle: true, write: false, minify: true, format: 'iife', platform: 'browser', target: 'es2022' }).outputFiles[0].text;
const bootstrapFile = `assets/theme-bootstrap-${createHash('sha256').update(bootstrap).digest('hex').slice(0, 12)}.js`;
export default defineConfig({
  plugins: [react(), {
    name: 'herts-theme-bootstrap',
    generateBundle() { this.emitFile({ type: 'asset', fileName: bootstrapFile, source: bootstrap }); },
    configureServer(server) { server.middlewares.use(`/${bootstrapFile}`, (_req, response) => { response.setHeader('Content-Type', 'text/javascript'); response.end(bootstrap); }); },
    transformIndexHtml() { return [{ tag: 'script', attrs: { src: `/${bootstrapFile}` }, injectTo: 'head' }]; },
  }],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8787', '/_plugins':'http://127.0.0.1:8787', '/_themes':'http://127.0.0.1:8787' } },
  build: { sourcemap: false, rollupOptions: { output: { manualChunks: { markdown: ['react-markdown', 'remark-gfm'], storage: ['dexie'] } } } },
});
