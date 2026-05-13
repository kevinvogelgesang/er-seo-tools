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
  await prisma.$executeRawUnsafe('PRAGMA journal_mode = WAL');
  await prisma.$executeRawUnsafe('PRAGMA synchronous = NORMAL');
  await prisma.$executeRawUnsafe('PRAGMA cache_size = -20000');
  await prisma.$executeRawUnsafe('PRAGMA busy_timeout = 5000');
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
  await prisma.$executeRawUnsafe('PRAGMA temp_store = MEMORY');
  globalForPrisma.prismaInitDone = true;
}
