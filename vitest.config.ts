import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@ashenfall/domain': fileURLToPath(new URL('./packages/domain/src/index.ts', import.meta.url)) },
  },
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/domain/src/**/*.ts', 'apps/server/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts', '**/test-support/**'],
    },
  },
});
