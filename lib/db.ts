import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient;
  prismaInitDone: boolean;
};

export const prisma = globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/**
 * Apply SQLite PRAGMA optimizations. WAL mode + busy_timeout are required for
 * the concurrent audit workers to avoid SQLITE_BUSY under load.
 *
 * Idempotent — safe to call multiple times. Awaited from instrumentation.ts
 * before the queue processor starts so the first audit write doesn't race
 * with PRAGMA setup.
 */
export async function initPragmas(): Promise<void> {
  if (globalForPrisma.prismaInitDone) return;
  // Use $queryRawUnsafe rather than $executeRawUnsafe — several PRAGMAs return
  // a row when applied to a fresh DB (e.g. `PRAGMA journal_mode = WAL` returns
  // the new mode as `wal`). Prisma's $executeRaw* rejects any returned rows
  // with "Execute returned results, which is not allowed in SQLite".
  // $queryRawUnsafe handles both cases (rows or none).
  await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL');
  await prisma.$queryRawUnsafe('PRAGMA synchronous = NORMAL');
  await prisma.$queryRawUnsafe('PRAGMA cache_size = -20000');
  await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 5000');
  await prisma.$queryRawUnsafe('PRAGMA foreign_keys = ON');
  await prisma.$queryRawUnsafe('PRAGMA temp_store = MEMORY');
  globalForPrisma.prismaInitDone = true;
}
