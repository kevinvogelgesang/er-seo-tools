import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// SQLite PRAGMA optimizations — run once on first import.
// WAL mode enables concurrent reads during writes (critical for audit polling).
// These are safe to call multiple times; SQLite no-ops if already set.
void prisma.$executeRawUnsafe('PRAGMA journal_mode = WAL').catch(() => {});
void prisma.$executeRawUnsafe('PRAGMA synchronous = NORMAL').catch(() => {});
void prisma.$executeRawUnsafe('PRAGMA cache_size = -20000').catch(() => {});
void prisma.$executeRawUnsafe('PRAGMA busy_timeout = 5000').catch(() => {});
void prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON').catch(() => {});
void prisma.$executeRawUnsafe('PRAGMA temp_store = MEMORY').catch(() => {});
