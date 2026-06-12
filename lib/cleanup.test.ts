import { mkdtemp, mkdir, rm, stat, utimes, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Static imports bind to the REAL modules before the doMock dance in the
// mock-based suite below — used by the DB-backed C4 suite at the bottom.
import { prisma as realPrisma } from '@/lib/db';
import { cleanExpiredSiteAuditShareTokens } from '@/lib/cleanup';

const ORIG_ENV = { ...process.env };

async function exists(filePath: string): Promise<boolean> {
  return stat(filePath).then(() => true, () => false);
}

async function makeOld(dir: string): Promise<void> {
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
  await utimes(dir, old, old);
}

describe('cleanup sweeps', () => {
  let tempDir: string;
  let uploadRoot: string;
  let screenshotRoot: string;

  const sessionFindUniqueMock = vi.fn();
  const sessionFindManyMock = vi.fn();
  const sessionDeleteMock = vi.fn();
  const shareLinkDeleteManyMock = vi.fn();
  const adaAuditFindUniqueMock = vi.fn();
  const adaAuditUpdateManyMock = vi.fn();

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'er-cleanup-'));
    uploadRoot = path.join(tempDir, 'uploads');
    screenshotRoot = path.join(tempDir, 'screenshots');
    await mkdir(uploadRoot, { recursive: true });
    await mkdir(screenshotRoot, { recursive: true });

    vi.resetModules();
    process.env = {
      ...ORIG_ENV,
      UPLOADS_DIR: uploadRoot,
      SCREENSHOTS_DIR: screenshotRoot,
    };

    sessionFindUniqueMock.mockReset();
    sessionFindManyMock.mockReset().mockResolvedValue([]);
    sessionDeleteMock.mockReset().mockResolvedValue({});
    shareLinkDeleteManyMock.mockReset().mockResolvedValue({ count: 0 });
    adaAuditFindUniqueMock.mockReset();
    adaAuditUpdateManyMock.mockReset().mockResolvedValue({ count: 0 });

    vi.doMock('@/lib/db', () => ({
      prisma: {
        session: {
          findUnique: (...args: unknown[]) => sessionFindUniqueMock(...args),
          findMany: (...args: unknown[]) => sessionFindManyMock(...args),
          delete: (...args: unknown[]) => sessionDeleteMock(...args),
        },
        shareLink: {
          deleteMany: (...args: unknown[]) => shareLinkDeleteManyMock(...args),
        },
        adaAudit: {
          findUnique: (...args: unknown[]) => adaAuditFindUniqueMock(...args),
          updateMany: (...args: unknown[]) => adaAuditUpdateManyMock(...args),
        },
      },
    }));
  });

  afterEach(async () => {
    process.env = { ...ORIG_ENV };
    vi.doUnmock('@/lib/db');
    vi.resetModules();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('removes old upload directories with no matching session row', async () => {
    const oldOrphan = '550e8400-e29b-41d4-a716-446655440000';
    const backed = '550e8400-e29b-41d4-a716-446655440001';
    const youngOrphan = '550e8400-e29b-41d4-a716-446655440002';
    const invalid = 'not-a-session-id';

    for (const id of [oldOrphan, backed, youngOrphan, invalid]) {
      await mkdir(path.join(uploadRoot, id), { recursive: true });
      await writeFile(path.join(uploadRoot, id, 'file.csv'), 'x');
    }
    await makeOld(path.join(uploadRoot, oldOrphan));
    await makeOld(path.join(uploadRoot, backed));
    await makeOld(path.join(uploadRoot, invalid));

    sessionFindUniqueMock.mockImplementation(({ where }: { where: { id: string } }) =>
      where.id === backed ? Promise.resolve({ id: backed }) : Promise.resolve(null),
    );

    const { cleanOrphanUploadDirectories } = await import('@/lib/cleanup');
    await cleanOrphanUploadDirectories();

    await expect(exists(path.join(uploadRoot, oldOrphan))).resolves.toBe(false);
    await expect(exists(path.join(uploadRoot, backed))).resolves.toBe(true);
    await expect(exists(path.join(uploadRoot, youngOrphan))).resolves.toBe(true);
    await expect(exists(path.join(uploadRoot, invalid))).resolves.toBe(true);
  });

  it('removes expired and orphan screenshot directories while keeping active audit screenshots', async () => {
    for (const id of ['old-audit', 'fresh-audit', 'orphan-audit']) {
      await mkdir(path.join(screenshotRoot, id), { recursive: true });
      await writeFile(path.join(screenshotRoot, id, 'violation.png'), 'x');
    }

    adaAuditFindUniqueMock.mockImplementation(({ where }: { where: { id: string } }) => {
      if (where.id === 'old-audit') {
        return Promise.resolve({ createdAt: new Date('2000-01-01T00:00:00Z') });
      }
      if (where.id === 'fresh-audit') {
        return Promise.resolve({ createdAt: new Date() });
      }
      return Promise.resolve(null);
    });

    const { cleanExpiredScreenshots } = await import('@/lib/cleanup');
    await cleanExpiredScreenshots();

    await expect(exists(path.join(screenshotRoot, 'old-audit'))).resolves.toBe(false);
    await expect(exists(path.join(screenshotRoot, 'orphan-audit'))).resolves.toBe(false);
    await expect(exists(path.join(screenshotRoot, 'fresh-audit'))).resolves.toBe(true);
  });

  it('clears expired ADA share tokens', async () => {
    const { cleanExpiredAdaShareTokens } = await import('@/lib/cleanup');
    await cleanExpiredAdaShareTokens();

    expect(adaAuditUpdateManyMock).toHaveBeenCalledWith({
      where: { shareExpiresAt: { lt: expect.any(Date) } },
      data: { shareToken: null, shareExpiresAt: null },
    });
  });

  it('removes old complete-session upload directories once no pillar analysis is active', async () => {
    const cleanable = '550e8400-e29b-41d4-a716-446655440010';
    const active = '550e8400-e29b-41d4-a716-446655440011';

    for (const id of [cleanable, active]) {
      await mkdir(path.join(uploadRoot, id), { recursive: true });
      await writeFile(path.join(uploadRoot, id, 'file.csv'), 'x');
    }

    sessionFindManyMock.mockImplementation(({ where }: { where: { pillarAnalyses?: unknown } }) => {
      if (where.pillarAnalyses) return Promise.resolve([{ id: cleanable }]);
      return Promise.resolve([]);
    });

    const { cleanConsumedCompleteSessionUploads } = await import('@/lib/cleanup');
    await cleanConsumedCompleteSessionUploads();

    await expect(exists(path.join(uploadRoot, cleanable))).resolves.toBe(false);
    await expect(exists(path.join(uploadRoot, active))).resolves.toBe(true);
    expect(sessionFindManyMock).toHaveBeenCalledWith({
      where: {
        status: 'complete',
        updatedAt: { lt: expect.any(Date) },
        pillarAnalyses: { none: { status: { in: ['pending', 'running'] } } },
      },
      select: { id: true },
    });
  });
});

// ─── C4: SiteAudit share-token cleanup (DB-backed) ───────────────────────────
// Seeds real SiteAudit rows against local-dev.db (domain prefix c4shr-cln-*)
// and runs the real cleanup function — verifies expired tokens are nulled
// while live tokens survive.
describe('cleanExpiredSiteAuditShareTokens (DB-backed)', () => {
  const PREFIX = 'c4shr-cln-';

  async function clearState() {
    await realPrisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } });
  }

  beforeEach(clearState);
  afterEach(clearState);

  it('nulls expired share tokens but keeps live ones', async () => {
    const expired = await realPrisma.siteAudit.create({
      data: {
        domain: `${PREFIX}expired.example`,
        status: 'complete',
        shareToken: crypto.randomUUID(),
        shareExpiresAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });
    const liveToken = crypto.randomUUID();
    const live = await realPrisma.siteAudit.create({
      data: {
        domain: `${PREFIX}live.example`,
        status: 'complete',
        shareToken: liveToken,
        shareExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    await cleanExpiredSiteAuditShareTokens();

    const expiredRow = await realPrisma.siteAudit.findUnique({
      where: { id: expired.id },
      select: { shareToken: true, shareExpiresAt: true },
    });
    expect(expiredRow).toEqual({ shareToken: null, shareExpiresAt: null });

    const liveRow = await realPrisma.siteAudit.findUnique({
      where: { id: live.id },
      select: { shareToken: true },
    });
    expect(liveRow?.shareToken).toBe(liveToken);
  });
});
