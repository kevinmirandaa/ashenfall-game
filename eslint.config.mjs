import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'] },
  ...tseslint.configs.strict,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // El dominio debe seguir siendo puro: sin red, base de datos, framework ni reloj o azar globales.
    files: ['packages/domain/src/**/*.ts'],
    ignores: ['packages/domain/src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['node:*', 'fs', 'net', 'http', 'crypto', 'pg', 'ioredis', 'ws'], message: 'El dominio no puede depender de infraestructura.' }] },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'El azar llega por RandomSource.' },
        { object: 'Date', property: 'now', message: 'El reloj llega en cada comando.' },
      ],
      'no-restricted-globals': ['error', 'process', 'fetch', 'setTimeout', 'setInterval'],
    },
  },
);
