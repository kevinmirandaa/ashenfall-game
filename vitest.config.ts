import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts'],
    coverage: { provider: 'v8', include: ['packages/domain/src/**/*.ts'], exclude: ['**/*.test.ts', '**/index.ts'] },
  },
});
