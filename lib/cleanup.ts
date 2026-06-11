import { prisma } from '@/lib/db';
import { promises as fs } from 'fs';
import path from 'path';
import { getUploadDir, isValidSessionId, UPLOADS_DIR } from '@/lib/upload-helpers';
import { SCREENSHOTS_DIR } from '@/lib/ada-audit/screenshot-helpers';
import { cleanOldTerminalJobs } from '@/lib/jobs/retention';

/** Parsed sessions and their data are kept for 180 days. */
const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000;

/** Uploads that were never analyzed (status pending/error) are deleted after 24 hours. */
const ORPHAN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Run all cleanup tasks. Called inline at startup (instrumentation.ts) and
 * daily via the 'cleanup' scheduled job (lib/jobs/handlers/cleanup.ts).
 * Each task is independent — a failure in one does not abort the others.
 */
export async function runCleanup(): Promise<void> {
  const results = await Promise.allSettled([
    cleanOrphanUploads(),
    cleanOrphanUploadDirectories(),
    cleanConsumedCompleteSessionUploads(),
    cleanExpiredSessions(),
    cleanExpiredShareLinks(),
    cleanExpiredAdaShareTokens(),
    cleanExpiredScreenshots(),
    cleanOldTerminalJobs(),
  ]);
  logSettledFailures('[cleanup] Cleanup task failed', results);
}

function logSettledFailures(context: string, results: readonly PromiseSettledResult<unknown>[]): void {
  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn(`${context}:`, result.reason);
    }
  }
}

async function removeDirectory(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

async function deleteSessionAndUploads(id: string): Promise<void> {
  const results = await Promise.allSettled([
    removeDirectory(getUploadDir(id)),
    prisma.session.delete({ where: { id } }),
  ]);
  logSettledFailures(`[cleanup] Failed while deleting session ${id}`, results);
}

/**
 * Delete upload directories for sessions that were never analyzed.
 * Targets: status=pending or status=error, created more than 24 hours ago.
 */
export async function cleanOrphanUploads(): Promise<void> {
  const cutoff = new Date(Date.now() - ORPHAN_TTL_MS);
  const sessions = await prisma.session.findMany({
    where: { status: { in: ['pending', 'error'] }, createdAt: { lt: cutoff } },
    select: { id: true },
  });

  const results = await Promise.allSettled(sessions.map(({ id }) => deleteSessionAndUploads(id)));
  logSettledFailures('[cleanup] Failed to clean orphan upload session', results);
}

/**
 * Delete upload directories that no longer have a Session row.
 * Only removes session-shaped directories older than the orphan TTL so an
 * in-flight upload that has not created its DB row yet gets a grace period.
 */
export async function cleanOrphanUploadDirectories(): Promise<void> {
  const cutoffMs = Date.now() - ORPHAN_TTL_MS;
  const entries = await fs.readdir(UPLOADS_DIR, { withFileTypes: true }).catch(() => []);

  const results = await Promise.allSettled(entries.map(async (entry) => {
    if (!entry.isDirectory() || !isValidSessionId(entry.name)) return;

    const dir = path.join(UPLOADS_DIR, entry.name);
    const stat = await fs.lstat(dir).catch(() => null);
    if (!stat || stat.mtimeMs >= cutoffMs) return;

    const session = await prisma.session.findUnique({
      where: { id: entry.name },
      select: { id: true },
    });
    if (!session) {
      await removeDirectory(dir);
    }
  }));
  logSettledFailures('[cleanup] Failed to clean orphan upload directory', results);
}

/**
 * Delete upload directories for complete sessions once no pillar analysis is
 * pending/running. A 24h grace period preserves files for delayed triggers.
 */
export async function cleanConsumedCompleteSessionUploads(): Promise<void> {
  const cutoff = new Date(Date.now() - ORPHAN_TTL_MS);
  const sessions = await prisma.session.findMany({
    where: {
      status: 'complete',
      updatedAt: { lt: cutoff },
      pillarAnalyses: { none: { status: { in: ['pending', 'running'] } } },
    },
    select: { id: true },
  });

  const results = await Promise.allSettled(
    sessions.map(({ id }) => removeDirectory(getUploadDir(id)))
  );
  logSettledFailures('[cleanup] Failed to clean consumed complete-session upload directory', results);
}

/**
 * Delete sessions (and their upload dirs) older than 180 days.
 * ShareLinks are cascade-deleted by Prisma.
 * Upload dirs should already be gone (deleted after parse) but we clean defensively.
 */
export async function cleanExpiredSessions(): Promise<void> {
  const cutoff = new Date(Date.now() - SESSION_TTL_MS);
  const sessions = await prisma.session.findMany({
    where: { createdAt: { lt: cutoff } },
    select: { id: true },
  });

  const results = await Promise.allSettled(sessions.map(({ id }) => deleteSessionAndUploads(id)));
  logSettledFailures('[cleanup] Failed to clean expired session', results);
}

/**
 * Delete ShareLink rows whose expiresAt has passed.
 */
export async function cleanExpiredShareLinks(): Promise<void> {
  await prisma.shareLink.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}

/**
 * Clear expired ADA share tokens so stale links cannot be resolved by token.
 */
export async function cleanExpiredAdaShareTokens(): Promise<void> {
  await prisma.adaAudit.updateMany({
    where: { shareExpiresAt: { lt: new Date() } },
    data: { shareToken: null, shareExpiresAt: null },
  });
}

/**
 * Delete screenshot directories for AdaAudit records older than 180 days,
 * and any orphaned screenshot directories with no matching audit row.
 */
export async function cleanExpiredScreenshots(): Promise<void> {
  const cutoff = new Date(Date.now() - SESSION_TTL_MS);
  const entries = await fs.readdir(SCREENSHOTS_DIR, { withFileTypes: true }).catch(() => []);

  const results = await Promise.allSettled(entries.map(async (entry) => {
    if (!entry.isDirectory()) return;

    const audit = await prisma.adaAudit.findUnique({
      where: { id: entry.name },
      select: { createdAt: true },
    });
    if (!audit || audit.createdAt < cutoff) {
      await removeDirectory(path.join(SCREENSHOTS_DIR, entry.name));
    }
  }));
  logSettledFailures('[cleanup] Failed to clean screenshot directory', results);
}

