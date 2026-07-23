import { afterAll, afterEach, beforeEach, describe, expect, it, vi, beforeAll } from 'vitest'
import crypto from 'crypto'
import { mkdir, mkdtemp, readdir, rm, writeFile, utimes } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { prisma } from '@/lib/db'
import { createViewbook } from './service'
import { pruneViewbookActivity, pruneOrphanedViewbookAssetFiles, ORPHAN_ASSET_GRACE_MS } from './retention'
import { DEFAULT_THEME } from './theme'
import { ensureSeededTemplates } from './__fixtures__/instance-test-helpers'

// F2 (Task 3): createViewbook snapshots from the template library — seed it
// once per file (idempotent; an earlier file in this worker may have wiped it).
beforeAll(async () => {
  await ensureSeededTemplates()
})

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: 'vb-test-' } } })
})

describe('pruneViewbookActivity', () => {
  it('deletes activity older than 180 days and keeps the boundary/newer rows', async () => {
    const client = await prisma.client.create({ data: { name: `vb-test-${crypto.randomUUID()}` } })
    const vb = await createViewbook(client.id, 'upgrade', 'operator@example.com')
    const now = new Date('2026-07-16T12:00:00Z')
    await prisma.viewbookActivity.createMany({ data: [
      { viewbookId: vb.id, kind: 'test', actor: 'client', summary: 'old', createdAt: new Date('2025-01-01T00:00:00Z') },
      { viewbookId: vb.id, kind: 'test', actor: 'client', summary: 'new', createdAt: now },
    ] })
    expect(await pruneViewbookActivity(now)).toBe(1)
    expect((await prisma.viewbookActivity.findMany({ where: { viewbookId: vb.id } })).map((row) => row.summary)).toEqual(['new'])
  })
})

describe('pruneOrphanedViewbookAssetFiles', () => {
  let assetsDir: string
  const NOW = new Date('2026-07-17T12:00:00Z')
  const OLD_MTIME = new Date(NOW.getTime() - ORPHAN_ASSET_GRACE_MS - 60 * 60 * 1000) // grace + 1h in the past
  const NEW_MTIME = new Date(NOW.getTime() - 60 * 1000) // 1 minute old — inside the grace window

  beforeEach(async () => {
    assetsDir = await mkdtemp(path.join(tmpdir(), 'vb-orphan-sweep-'))
    process.env.VIEWBOOK_ASSETS_DIR = assetsDir
  })

  afterEach(async () => {
    delete process.env.VIEWBOOK_ASSETS_DIR
    await rm(assetsDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  async function makeViewbook() {
    const client = await prisma.client.create({ data: { name: `vb-test-${crypto.randomUUID()}` } })
    return createViewbook(client.id, 'upgrade', 'operator@example.com')
  }

  async function writeScopeFile(viewbookId: number, filename: string, mtime: Date): Promise<string> {
    const dir = path.join(assetsDir, String(viewbookId))
    await mkdir(dir, { recursive: true })
    const filePath = path.join(dir, filename)
    await writeFile(filePath, 'x')
    await utimes(filePath, mtime, mtime)
    return filePath
  }

  async function scopeFiles(viewbookId: number): Promise<string[]> {
    return (await readdir(path.join(assetsDir, String(viewbookId))).catch(() => [])).sort()
  }

  it('deletes a genuinely orphaned assessment-image file once past the grace period', async () => {
    const vb = await makeViewbook()
    await writeScopeFile(vb.id, 'orphan-old.webp', OLD_MTIME)

    const deleted = await pruneOrphanedViewbookAssetFiles(NOW)

    expect(deleted).toBe(1)
    expect(await scopeFiles(vb.id)).toEqual([])
  })

  it('preserves referenced theme, doc, and assessment-image files (full-union safety)', async () => {
    const vb = await makeViewbook()

    await prisma.viewbook.update({
      where: { id: vb.id },
      data: { themeJson: JSON.stringify({ ...DEFAULT_THEME, headingFont: 'abril-fatface', logo: 'theme-logo-ref.webp' }) },
    })
    await prisma.viewbookDoc.create({
      data: { viewbookId: vb.id, title: 'Doc', filename: 'owned-doc-ref.pdf', sortOrder: 1, createdBy: 'op@example.com' },
    })
    const content = await prisma.viewbookAssessmentContent.create({ data: { viewbookId: vb.id } })
    await prisma.viewbookAssessmentImage.create({
      data: { contentId: content.id, filename: 'assess-image-ref.webp', createdBy: 'op@example.com' },
    })

    await writeScopeFile(vb.id, 'theme-logo-ref.webp', OLD_MTIME)
    await writeScopeFile(vb.id, 'owned-doc-ref.pdf', OLD_MTIME)
    await writeScopeFile(vb.id, 'assess-image-ref.webp', OLD_MTIME)
    await writeScopeFile(vb.id, 'orphan-old.webp', OLD_MTIME) // the one file that SHOULD go

    const deleted = await pruneOrphanedViewbookAssetFiles(NOW)

    expect(deleted).toBe(1)
    expect(await scopeFiles(vb.id)).toEqual(['assess-image-ref.webp', 'owned-doc-ref.pdf', 'theme-logo-ref.webp'])
  })

  it('preserves feedback screenshot files referenced by ViewbookFeedbackImage rows', async () => {
    const vb = await makeViewbook()
    const milestone = await prisma.viewbookMilestone.findFirstOrThrow({ where: { viewbookId: vb.id } })
    const reviewLink = await prisma.viewbookReviewLink.create({
      data: { milestoneId: milestone.id, label: 'Homepage', url: 'https://example.com', kind: 'live', createdBy: 'op@example.com' },
    })
    const feedback = await prisma.viewbookFeedback.create({
      data: { reviewLinkId: reviewLink.id, body: 'See screenshot', authorKind: 'client' },
    })
    await prisma.viewbookFeedbackImage.create({
      data: { feedbackId: feedback.id, filename: 'feedback-shot-ref.webp', sortOrder: 0 },
    })

    await writeScopeFile(vb.id, 'feedback-shot-ref.webp', OLD_MTIME)
    await writeScopeFile(vb.id, 'orphan-old.webp', OLD_MTIME)

    const deleted = await pruneOrphanedViewbookAssetFiles(NOW)

    expect(deleted).toBe(1)
    expect(await scopeFiles(vb.id)).toEqual(['feedback-shot-ref.webp'])
  })

  it('preserves a brand-new orphan inside the grace period (write-vs-DB-create race guard)', async () => {
    const vb = await makeViewbook()
    await writeScopeFile(vb.id, 'orphan-new.webp', NEW_MTIME)

    const deleted = await pruneOrphanedViewbookAssetFiles(NOW)

    expect(deleted).toBe(0)
    expect(await scopeFiles(vb.id)).toEqual(['orphan-new.webp'])
  })

  it('aborts the scope with NOTHING deleted when the referenced-union lookup throws', async () => {
    const vb = await makeViewbook()
    await writeScopeFile(vb.id, 'orphan-old.webp', OLD_MTIME)

    const spy = vi
      .spyOn(prisma.viewbookAssessmentImage, 'findMany')
      .mockRejectedValueOnce(new Error('union lookup boom'))

    const deleted = await pruneOrphanedViewbookAssetFiles(NOW)
    spy.mockRestore()

    expect(deleted).toBe(0)
    expect(await scopeFiles(vb.id)).toEqual(['orphan-old.webp'])
  })

  it('never touches the global scope with per-viewbook union logic', async () => {
    const dir = path.join(assetsDir, 'global')
    await mkdir(dir, { recursive: true })
    const filePath = path.join(dir, 'team-photo-orphan.webp')
    await writeFile(filePath, 'x')
    await utimes(filePath, OLD_MTIME, OLD_MTIME)

    const deleted = await pruneOrphanedViewbookAssetFiles(NOW)

    expect(deleted).toBe(0)
    expect(await readdir(dir)).toEqual(['team-photo-orphan.webp'])
  })
})
