import { prisma } from '@/lib/db';
import { promises as fs } from 'fs';
import path from 'path';
import { getUploadDir } from '@/lib/upload-helpers';
import { SCREENSHOTS_DIR } from '@/lib/ada-audit/screenshot-helpers';

/** Parsed sessions and their data are kept for 180 days. */
const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000;

/** Uploads that were never analyzed (status pending/error) are deleted after 24 hours. */
const ORPHAN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Run all cleanup tasks. Called at startup and once per day from instrumentation.ts.
 * Each task is independent — a failure in one does not abort the others.
 */
export async function runCleanup(): Promise<void> {
  await Promise.allSettled([
    cleanOrphanUploads(),
    cleanExpiredSessions(),
    cleanExpiredShareLinks(),
    cleanExpiredScreenshots(),
  ]);
}

/**
 * Delete upload directories for sessions that were never analyzed.
 * Targets: status=pending or status=error, created more than 24 hours ago.
 */
async function cleanOrphanUploads(): Promise<void> {
  const cutoff = new Date(Date.now() - ORPHAN_TTL_MS);
  const sessions = await prisma.session.findMany({
    where: { status: { in: ['pending', 'error'] }, createdAt: { lt: cutoff } },
    select: { id: true },
  });

  for (const { id } of sessions) {
    await fs.rm(getUploadDir(id), { recursive: true, force: true }).catch(() => {});
    await prisma.session.delete({ where: { id } }).catch(() => {});
  }
}

/**
 * Delete sessions (and their upload dirs) older than 180 days.
 * ShareLinks are cascade-deleted by Prisma.
 * Upload dirs should already be gone (deleted after parse) but we clean defensively.
 */
async function cleanExpiredSessions(): Promise<void> {
  const cutoff = new Date(Date.now() - SESSION_TTL_MS);
  const sessions = await prisma.session.findMany({
    where: { createdAt: { lt: cutoff } },
    select: { id: true },
  });

  for (const { id } of sessions) {
    await fs.rm(getUploadDir(id), { recursive: true, force: true }).catch(() => {});
    await prisma.session.delete({ where: { id } }).catch(() => {});
  }
}

/**
 * Delete ShareLink rows whose expiresAt has passed.
 */
async function cleanExpiredShareLinks(): Promise<void> {
  await prisma.shareLink.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}

/**
 * Delete screenshot directories for AdaAudit records older than 180 days,
 * and any orphaned screenshot directories with no matching audit row.
 */
async function cleanExpiredScreenshots(): Promise<void> {
  const cutoff = new Date(Date.now() - SESSION_TTL_MS);
  const entries = await fs.readdir(SCREENSHOTS_DIR).catch(() => [] as string[]);

  for (const entry of entries) {
    const audit = await prisma.adaAudit
      .findUnique({ where: { id: entry }, select: { createdAt: true } })
      .catch(() => null);

    if (!audit || audit.createdAt < cutoff) {
      await fs.rm(path.join(SCREENSHOTS_DIR, entry), { recursive: true, force: true }).catch(() => {});
    }
  }
}
