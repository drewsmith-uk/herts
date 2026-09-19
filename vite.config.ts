import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8787', '/_plugins':'http://127.0.0.1:8787' } },
  build: { sourcemap: false, rollupOptions: { output: { manualChunks: { markdown: ['react-markdown', 'remark-gfm'], storage: ['dexie'] } } } },
});
