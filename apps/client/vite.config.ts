import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: { '@ashenfall/domain': fileURLToPath(new URL('../../packages/domain/src/index.ts', import.meta.url)) },
  },
  build: { chunkSizeWarningLimit: 1500 },
  server: {
    port: 5173,
    proxy: {
      '/v1': 'http://127.0.0.1:8080',
      '/ws': { target: 'ws://127.0.0.1:8080', ws: true },
    },
  },
});
