import { configDefaults, defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    // Tests share the dev SQLite DB. The AuditBatch partial unique index
    // (`audit_batches_one_open`) means parallel test files writing open
    // batches collide on the singleton invariant. Serialize file execution
    // so cross-file DB state stays predictable. ~1-2s slower; reliable.
    fileParallelism: false,
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: [
      ...configDefaults.exclude,
      '.next/**',
      '.claude/worktrees/**',
      'local-uploads/**',
      'prisma/local-dev.db*',
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
      '@': resolve(__dirname, '.'),
    },
  },
});
