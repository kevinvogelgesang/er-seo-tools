import { configDefaults, defineConfig } from 'vitest/config';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Keep Vitest's cache in the project root, NOT the default node_modules/.vite.
  // In a git worktree, node_modules is a symlink to the main checkout and lands
  // outside a codex workspace-write sandbox's writable root — writing the cache
  // there throws EPERM. A project-root dir is always inside the writable root.
  cacheDir: resolve(new URL('.', import.meta.url).pathname, '.vitest-cache'),
  test: {
    environment: 'node',
    globals: false,
    pool: 'forks',
    poolOptions: { forks: { minForks: 1, maxForks: 4 } },
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup-worker.ts'],
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: [
      ...configDefaults.exclude,
      '.next/**',
      '.claude/worktrees/**',
      'local-uploads/**',
      'prisma/local-dev.db*',
      '.test-dbs/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['lib/**/*.ts'],
      exclude: ['lib/db.ts', 'lib/**/*.test.ts', 'lib/ada-audit/runner.ts'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(new URL('.', import.meta.url).pathname, '.'),
      'server-only': resolve(new URL('.', import.meta.url).pathname, 'test/stubs/server-only.ts'),
    },
  },
});
