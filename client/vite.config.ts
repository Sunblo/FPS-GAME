import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    chunkSizeWarningLimit: 1400,
  },
  server: {
    port: 5173,
    host: true,
    allowedHosts: ['.monkeycode-ai.live', 'localhost'],
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/ws': { target: 'http://127.0.0.1:8787', changeOrigin: true, ws: true },
    },
  },
});
