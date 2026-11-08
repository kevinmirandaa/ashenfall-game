import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { defineConfig, type Plugin } from 'vite';

const COMPRESSIBLE = /\.(?:js|css|html|json|svg)$/;
const MIN_BYTES = 1024;

/**
 * Deja junto a cada fichero de texto su versión .br y .gz. El servidor las sirve tal cual
 * (preCompressed): se comprime una vez al compilar, con el nivel máximo, y nunca en cada petición.
 */
function precompress(): Plugin {
  let outDir = '';
  return {
    name: 'ashenfall-precompress',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir.startsWith('/') ? config.build.outDir : join(config.root, config.build.outDir);
    },
    closeBundle() {
      const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
          const path = join(dir, name);
          if (statSync(path).isDirectory()) {
            walk(path);
            continue;
          }
          if (!COMPRESSIBLE.test(name)) continue;
          const source = readFileSync(path);
          if (source.length < MIN_BYTES) continue;
          const brotli = brotliCompressSync(source, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: source.length } });
          const gzip = gzipSync(source, { level: 9 });
          if (brotli.length < source.length) writeFileSync(`${path}.br`, brotli);
          if (gzip.length < source.length) writeFileSync(`${path}.gz`, gzip);
        }
      };
      walk(outDir);
    },
  };
}

export default defineConfig({
  resolve: {
    alias: { '@ashenfall/domain': fileURLToPath(new URL('../../packages/domain/src/index.ts', import.meta.url)) },
  },
  plugins: [precompress()],
  build: {
    // Navegadores de hace unos años (Safari 14 o iOS 14 en adelante, Firefox 78, Chrome 87): sin esto Vite emite campos de clase ES2022.
    target: ['es2020', 'safari14', 'firefox78', 'chrome87', 'edge88'],
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Phaser va en su propio fichero: cambia solo al actualizar la librería, así que tras un despliegue
        // del juego el navegador conserva en caché ese 1 MB y solo descarga el código propio.
        manualChunks: (id) => (id.includes('/node_modules/phaser/') ? 'phaser' : undefined),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/v1': 'http://127.0.0.1:8080',
      '/ws': { target: 'ws://127.0.0.1:8080', ws: true },
    },
  },
});
