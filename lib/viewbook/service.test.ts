import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import crypto from 'crypto'
import sharp from 'sharp'
import { prisma } from '@/lib/db'
import {
  createViewbook,
  listViewbooks,
  rotateViewbookToken,
  revokeViewbook,
  setSectionState,
  updateSectionText,
  createMilestone,
  updateMilestone,
  deleteMilestone,
  syncCatalogQuestions,
  deleteViewbook,
  attachViewbookLogo,
  updateViewbookTheme,
  updateViewbookSettings,
  updateViewbookPresentation,
  collectClientViewbookAssetSnapshot,
  moveViewbookStage,
  assignViewbookCsm,
} from './service'
import { deleteViewbookAssets, readViewbookAsset } from './assets'
import { createViewbookDoc } from './docs'
import { DEFAULT_THEME } from './theme'
import { CATALOG } from './catalog'
import { VIEWBOOK_EMAIL_JOB_TYPE } from '@/lib/jobs/types'

// Real tiny PNG — saveViewbookAsset now decodes every upload via sharp, so the
// old "PNG magic + zero bytes" fake is correctly rejected as invalid_image.
let PNG: Buffer
beforeAll(async () => {
  PNG = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } } })
    .png()
    .toBuffer()
})
const OPERATOR = 'kevin@enrollmentresources.com'
// Global ViewbookDoc rows (viewbookId: null) aren't reachable via the
// client-cascade cleanup below — they're app-global rows the shared worker
// DB otherwise accumulates across runs. Titles here are prefixed so afterAll
// can scope its delete to exactly the rows this file created.
const GLOBAL_DOC_TITLE_PREFIX = 'vb-svc-test-global-doc-'

let assetsDir: string
beforeEach(async () => {
  assetsDir = await mkdtemp(path.join(tmpdir(), 'vb-svc-'))
  process.env.VIEWBOOK_ASSETS_DIR = assetsDir
})
afterEach(async () => {
  delete process.env.VIEWBOOK_ASSETS_DIR
  await rm(assetsDir, { recursive: true, force: true })
})
afterAll(async () => {
  await prisma.job.deleteMany({ where: { type: VIEWBOOK_EMAIL_JOB_TYPE } })
  await prisma.client.deleteMany({ where: { name: { startsWith: 'vb-test-' } } })
  await prisma.viewbookDoc.deleteMany({
    where: { viewbookId: null, title: { startsWith: GLOBAL_DOC_TITLE_PREFIX } },
  })
})

async function mkClient(archived = false) {
  return prisma.client.create({
    data: { name: `vb-test-${crypto.randomUUID()}`, archivedAt: archived ? new Date() : null },
  })
}

async function syncVersion(viewbookId: number): Promise<number> {
  return (await prisma.viewbook.findUniqueOrThrow({ where: { id: viewbookId } })).syncVersion
}

describe('createViewbook', () => {
  it('seeds sections/fields/milestones in one nested create', async () => {
    const c = await mkClient()
    const { id, token } = await createViewbook(c.id, 'new-build', OPERATOR)
    expect(token).toMatch(/^[0-9a-f-]{36}$/)
    const vb = await prisma.viewbook.findUniqueOrThrow({
      where: { id },
      include: { sections: true, fields: true, milestones: true },
    })
    expect(vb.fields).toHaveLength(CATALOG.length)
    expect(vb.fields.every((f) => f.createdBy === 'seed')).toBe(true)
    expect(vb.sections).toHaveLength(13)
    expect(vb.sections.find((s) => s.sectionKey === 'assessment')?.state).toBe('hidden')
    expect(vb.milestones).toHaveLength(7)
    expect(vb.milestones.filter((m) => m.status === 'current')).toHaveLength(1)
    expect(vb.milestones.find((m) => m.status === 'current')?.title).toBe('Kickoff')
  })

  it('upgrade kind keeps assessment active; duplicate create 409s from the service', async () => {
    const c = await mkClient()
    const { id } = await createViewbook(c.id, 'upgrade', OPERATOR)
    const sections = await prisma.viewbookSection.findMany({ where: { viewbookId: id } })
    expect(sections.find((s) => s.sectionKey === 'assessment')?.state).toBe('active')
    await expect(createViewbook(c.id, 'upgrade', OPERATOR)).rejects.toMatchObject({
      status: 409,
      code: 'viewbook_exists',
    })
  })

  it('rejects archived clients', async () => {
    const c = await mkClient(true)
    await expect(createViewbook(c.id, 'upgrade', OPERATOR)).rejects.toMatchObject({
      status: 409,
      code: 'client_archived',
    })
  })

  it('seeds all 13 section rows and creation stage post-contract (PR5 Task 7 flip)', async () => {
    const client = await mkClient()
    const { id } = await createViewbook(client.id, 'upgrade', 'op@er.com')
    const vb = await prisma.viewbook.findUniqueOrThrow({ where: { id }, include: { sections: true } })
    expect(vb.stage).toBe('post-contract')
    expect(vb.sections).toHaveLength(13)
    expect(vb.sections.map((s) => s.sectionKey)).toContain('pc-thanks')
  })

  it('listViewbooks exposes stage', async () => {
    const client = await mkClient()
    const { id } = await createViewbook(client.id, 'upgrade', 'op@er.com')
    const rows = await listViewbooks()
    expect(rows.find((r) => r.id === id)?.stage).toBe('post-contract')
  })
})

describe('token lifecycle', () => {
  it('rotate issues a new token AND clears revokedAt', async () => {
    const c = await mkClient()
    const { id, token } = await createViewbook(c.id, 'upgrade', OPERATOR)
    const before = await syncVersion(id)
    await revokeViewbook(id)
    let row = await prisma.viewbook.findUniqueOrThrow({ where: { id } })
    expect(row.revokedAt).not.toBeNull()
    const rotated = await rotateViewbookToken(id)
    expect(rotated.token).not.toBe(token)
    row = await prisma.viewbook.findUniqueOrThrow({ where: { id } })
    expect(row.revokedAt).toBeNull()
    // token rotate/revoke are delivery metadata, never rendered content — no bump
    expect(await syncVersion(id)).toBe(before)
  })
})

describe('updateViewbookSettings', () => {
  it('bumps on welcomeNote/kind but not on a notifyEmail-only patch', async () => {
    const c = await mkClient()
    const { id } = await createViewbook(c.id, 'upgrade', OPERATOR)
    const before = await syncVersion(id)
    await updateViewbookSettings(id, { welcomeNote: 'Hello there' })
    const afterWelcome = await syncVersion(id)
    expect(afterWelcome).toBe(before + 1)
    await updateViewbookSettings(id, { notifyEmail: 'ops@enrollmentresources.com' })
    // notifyEmail-only patch is delivery metadata — no bump
    expect(await syncVersion(id)).toBe(afterWelcome)
    await updateViewbookSettings(id, { kind: 'new-build' })
    expect(await syncVersion(id)).toBe(afterWelcome + 1)
  })
})

describe('updateViewbookPresentation', () => {
  it('writes both fields + bumps syncVersion once', async () => {
    const c = await mkClient()
    const { id } = await createViewbook(c.id, 'upgrade', OPERATOR)
    const before = await syncVersion(id)
    await updateViewbookPresentation(id, { collapseAffordance: 'pill', heroOverlayStrength: 20 })
    const row = await prisma.viewbook.findUniqueOrThrow({ where: { id } })
    expect(row.collapseAffordance).toBe('pill')
    expect(row.heroOverlayStrength).toBe(20)
    expect(row.syncVersion).toBe(before + 1)
  })

  it('writes a single-field patch and bumps once', async () => {
    const c = await mkClient()
    const { id } = await createViewbook(c.id, 'upgrade', OPERATOR)
    const before = await syncVersion(id)
    await updateViewbookPresentation(id, { heroOverlayStrength: 5 })
    const row = await prisma.viewbook.findUniqueOrThrow({ where: { id } })
    expect(row.collapseAffordance).toBe('bar') // unchanged default
    expect(row.heroOverlayStrength).toBe(5)
    expect(row.syncVersion).toBe(before + 1)
  })

  it('an empty patch is a no-op (no bump, no write)', async () => {
    const c = await mkClient()
    const { id } = await createViewbook(c.id, 'upgrade', OPERATOR)
    const before = await syncVersion(id)
    await updateViewbookPresentation(id, {})
    expect(await syncVersion(id)).toBe(before)
  })
})

describe('sections', () => {
  it('done stamps doneAt; re-activate clears it; unknown key 400', async () => {
    const c = await mkClient()
    const { id } = await createViewbook(c.id, 'upgrade', OPERATOR)
    const before = await syncVersion(id)
    await setSectionState(id, 'data-source', 'done', OPERATOR)
    let s = await prisma.viewbookSection.findUniqueOrThrow({
      where: { viewbookId_sectionKey: { viewbookId: id, sectionKey: 'data-source' } },
    })
    expect(s.doneAt).not.toBeNull()
    const activity = await prisma.viewbookActivity.findMany({ where: { viewbookId: id } })
    expect(activity).toEqual([expect.objectContaining({
      kind: 'section-done', actor: OPERATOR, summary: 'Completed data-source',
    })])
    const afterDone = await syncVersion(id)
    expect(afterDone).toBe(before + 1)
    await setSectionState(id, 'data-source', 'active', OPERATOR)
    s = await prisma.viewbookSection.findUniqueOrThrow({
      where: { viewbookId_sectionKey: { viewbookId: id, sectionKey: 'data-source' } },
    })
    expect(s.doneAt).toBeNull()
    expect(await syncVersion(id)).toBe(afterDone + 1)
    // unknown section key is rejected before any write — no bump
    const beforeInvalid = await syncVersion(id)
    await expect(setSectionState(id, 'nope', 'done', OPERATOR)).rejects.toMatchObject({ code: 'invalid_section' })
    expect(await syncVersion(id)).toBe(beforeInvalid)
  })

  it('rejects the retired "collapsed" state', async () => {
    const c = await mkClient()
    const { id } = await createViewbook(c.id, 'upgrade', OPERATOR)
    const before = await syncVersion(id)
    await expect(setSectionState(id, 'strategy', 'collapsed' as never, OPERATOR))
      .rejects.toMatchObject({ status: 400, code: 'invalid_section' })
    expect(await syncVersion(id)).toBe(before)
    const row = await prisma.viewbookSection.findUniqueOrThrow({
      where: { viewbookId_sectionKey: { viewbookId: id, sectionKey: 'strategy' } },
    })
    expect(row.state).not.toBe('collapsed')
  })
})

describe('updateSectionText', () => {
  it('bumps on a successful text save; unknown section key rejects without bumping', async () => {
    const c = await mkClient()
    const { id } = await createViewbook(c.id, 'upgrade', OPERATOR)
    const before = await syncVersion(id)
    await updateSectionText(id, 'data-source', { introNote: 'Some intro' })
    expect(await syncVersion(id)).toBe(before + 1)
    const beforeInvalid = await syncVersion(id)
    await expect(updateSectionText(id, 'nope', { introNote: 'x' })).rejects.toMatchObject({ code: 'invalid_section' })
    expect(await syncVersion(id)).toBe(beforeInvalid)
  })
})

describe('milestone promotion', () => {
  it('promoting demotes the previous current; exactly one current survives', async () => {
    const c = await mkClient()
    const { id } = await createViewbook(c.id, 'upgrade', OPERATOR)
    const design = await prisma.viewbookMilestone.findFirstOrThrow({
      where: { viewbookId: id, title: 'Design' },
    })
    const before = await syncVersion(id)
    await updateMilestone(id, design.id, { status: 'current' })
    const current = await prisma.viewbookMilestone.findMany({ where: { viewbookId: id, status: 'current' } })
    expect(current).toHaveLength(1)
    expect(current[0].id).toBe(design.id)
    expect(await syncVersion(id)).toBe(before + 1)
  })

  it('a plain (non-status) milestone update bumps once', async () => {
    const c = await mkClient()
    const { id } = await createViewbook(c.id, 'upgrade', OPERATOR)
    const kickoff = await prisma.viewbookMilestone.findFirstOrThrow({ where: { viewbookId: id, title: 'Kickoff' } })
    const before = await syncVersion(id)
    await updateMilestone(id, kickoff.id, { blurb: 'Updated blurb' })
    expect(await syncVersion(id)).toBe(before + 1)
  })

  it('cross-viewbook promotion rejects AND rolls back the demote (and the bump)', async () => {
    const c1 = await mkClient()
    const c2 = await mkClient()
    const a = await createViewbook(c1.id, 'upgrade', OPERATOR)
    const b = await createViewbook(c2.id, 'upgrade', OPERATOR)
    const foreign = await prisma.viewbookMilestone.findFirstOrThrow({ where: { viewbookId: b.id } })
    const before = await syncVersion(a.id)
    await expect(updateMilestone(a.id, foreign.id, { status: 'current' })).rejects.toBeTruthy()
    const current = await prisma.viewbookMilestone.findMany({
      where: { viewbookId: a.id, status: 'current' },
    })
    expect(current).toHaveLength(1)
    expect(current[0].title).toBe('Kickoff') // demote rolled back
    expect(await syncVersion(a.id)).toBe(before) // and the bump rolled back with it
  })

  it('cross-viewbook plain update rejects without bumping', async () => {
    const c1 = await mkClient()
    const c2 = await mkClient()
    const a = await createViewbook(c1.id, 'upgrade', OPERATOR)
    const b = await createViewbook(c2.id, 'upgrade', OPERATOR)
    const foreign = await prisma.viewbookMilestone.findFirstOrThrow({ where: { viewbookId: b.id } })
    const before = await syncVersion(a.id)
    await expect(updateMilestone(a.id, foreign.id, { blurb: 'nope' })).rejects.toBeTruthy()
    expect(await syncVersion(a.id)).toBe(before)
  })

  it('createMilestone as current demotes the seed current and bumps once', async () => {
    const c = await mkClient()
    const { id } = await createViewbook(c.id, 'upgrade', OPERATOR)
    const before = await syncVersion(id)
    const m = await createMilestone(id, { title: 'Extra', sortOrder: 8 }, { current: true })
    const current = await prisma.viewbookMilestone.findMany({ where: { viewbookId: id, status: 'current' } })
    expect(current).toHaveLength(1)
    expect(current[0].id).toBe(m.id)
    expect(await syncVersion(id)).toBe(before + 1)
  })

  it('plain createMilestone bumps once', async () => {
    const c = await mkClient()
    const { id } = await createViewbook(c.id, 'upgrade', OPERATOR)
    const before = await syncVersion(id)
    await createMilestone(id, { title: 'Plain extra', sortOrder: 9 })
    expect(await syncVersion(id)).toBe(before + 1)
  })

  it('deleteMilestone bumps once; a missing/cross-viewbook target 404s without bumping', async () => {
    const c1 = await mkClient()
    const c2 = await mkClient()
    const a = await createViewbook(c1.id, 'upgrade', OPERATOR)
    const b = await createViewbook(c2.id, 'upgrade', OPERATOR)
    const foreign = await prisma.viewbookMilestone.findFirstOrThrow({ where: { viewbookId: b.id } })
    const before = await syncVersion(a.id)
    await expect(deleteMilestone(a.id, foreign.id)).rejects.toMatchObject({ status: 404 })
    expect(await syncVersion(a.id)).toBe(before)
    const own = await prisma.viewbookMilestone.findFirstOrThrow({ where: { viewbookId: a.id } })
    await deleteMilestone(a.id, own.id)
    expect(await syncVersion(a.id)).toBe(before + 1)
  })

  it('updateMilestone persists a description', async () => {
    const c = await mkClient()
    const { id } = await createViewbook(c.id, 'upgrade', OPERATOR)
    const kickoff = await prisma.viewbookMilestone.findFirstOrThrow({ where: { viewbookId: id, title: 'Kickoff' } })
    await updateMilestone(id, kickoff.id, { description: 'Longer milestone detail text.' })
    const row = await prisma.viewbookMilestone.findUniqueOrThrow({ where: { id: kickoff.id } })
    expect(row.description).toBe('Longer milestone detail text.')
  })

  it('an over-cap description is rejected with 400 invalid_description; no write, no bump', async () => {
    const c = await mkClient()
    const { id } = await createViewbook(c.id, 'upgrade', OPERATOR)
    const kickoff = await prisma.viewbookMilestone.findFirstOrThrow({ where: { viewbookId: id, title: 'Kickoff' } })
    const before = await syncVersion(id)
    const tooLong = 'x'.repeat(2001)
    await expect(updateMilestone(id, kickoff.id, { description: tooLong })).rejects.toMatchObject({
      status: 400,
      code: 'invalid_description',
    })
    expect(await syncVersion(id)).toBe(before) // rejected before the transaction — no bump
    const row = await prisma.viewbookMilestone.findUniqueOrThrow({ where: { id: kickoff.id } })
    expect(row.description).toBeNull() // and no write
  })

  it('createMilestone accepts a description', async () => {
    const c = await mkClient()
    const { id } = await createViewbook(c.id, 'upgrade', OPERATOR)
    const m = await createMilestone(id, { title: 'With detail', sortOrder: 10, description: 'Detail text' })
    const row = await prisma.viewbookMilestone.findUniqueOrThrow({ where: { id: m.id } })
    expect(row.description).toBe('Detail text')
  })
})

describe('syncCatalogQuestions', () => {
  it('restores a deleted seeded field exactly once, even concurrently', async () => {
    const c = await mkClient()
    const { id } = await createViewbook(c.id, 'upgrade', OPERATOR)
    await prisma.viewbookField.deleteMany({ where: { viewbookId: id, defKey: 'school-name' } })
    const [r1, r2] = await Promise.all([syncCatalogQuestions(id), syncCatalogQuestions(id)])
    expect(r1.added + r2.added).toBe(1)
    const rows = await prisma.viewbookField.findMany({ where: { viewbookId: id, defKey: 'school-name' } })
    expect(rows).toHaveLength(1)
  })

  it('a sync with nothing missing bumps nothing; a sync with one missing defKey bumps once', async () => {
    const c = await mkClient()
    const { id } = await createViewbook(c.id, 'upgrade', OPERATOR)
    const before = await syncVersion(id)
    const noop = await syncCatalogQuestions(id)
    expect(noop.added).toBe(0)
    expect(await syncVersion(id)).toBe(before)

    await prisma.viewbookField.deleteMany({ where: { viewbookId: id, defKey: 'school-name' } })
    const afterDelete = await syncVersion(id)
    const filled = await syncCatalogQuestions(id)
    expect(filled.added).toBe(1)
    expect(await syncVersion(id)).toBe(afterDelete + 1)

    // re-run adds nothing further
    const afterFill = await syncVersion(id)
    const rerun = await syncCatalogQuestions(id)
    expect(rerun.added).toBe(0)
    expect(await syncVersion(id)).toBe(afterFill)
  })
})

describe('assets + delete lifecycle', () => {
  it('attachViewbookLogo stamps the theme and replaces the old file', async () => {
    const c = await mkClient()
    const { id } = await createViewbook(c.id, 'upgrade', OPERATOR)
    const before = await syncVersion(id)
    const t1 = await attachViewbookLogo(id, PNG)
    expect(t1.logo).toMatch(/\.webp$/)
    const afterFirst = await syncVersion(id)
    expect(afterFirst).toBe(before + 1)
    const t2 = await attachViewbookLogo(id, PNG)
    expect(t2.logo).not.toBe(t1.logo)
    expect(await syncVersion(id)).toBe(afterFirst + 1)
    expect(await readViewbookAsset(String(id), t1.logo as string)).toBeNull() // old file gone
    expect(await readViewbookAsset(String(id), t2.logo as string)).not.toBeNull()
  })

  it('a concurrent theme attach race: exactly one wins, syncVersion bumps exactly once', async () => {
    const c = await mkClient()
    const { id } = await createViewbook(c.id, 'upgrade', OPERATOR)
    const before = await syncVersion(id)
    const results = await Promise.allSettled([attachViewbookLogo(id, PNG), attachViewbookLogo(id, PNG)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected')
    expect(rejected).toMatchObject({ reason: { status: 409, code: 'theme_conflict' } })
    // the loser's fenced bump rolls back with its stamp — exactly one bump lands
    expect(await syncVersion(id)).toBe(before + 1)
  })

  it('attach on a missing viewbook leaves no orphan file', async () => {
    await expect(attachViewbookLogo(999_999_999, PNG)).rejects.toBeTruthy()
    const { readdir } = await import('fs/promises')
    const entries = await readdir(assetsDir, { recursive: true }).catch(() => [])
    expect((entries as string[]).filter((e) => String(e).endsWith('.webp'))).toHaveLength(0)
  })

  it('deleteViewbook removes owned image/PDF files while global PDFs survive', async () => {
    const c = await mkClient()
    const { id } = await createViewbook(c.id, 'upgrade', OPERATOR)
    const theme = await attachViewbookLogo(id, PNG)
    const ownDoc = await createViewbookDoc({
      viewbookId: id,
      title: 'Owned',
      buf: Buffer.from('%PDF-1.7\nowned'),
      createdBy: OPERATOR,
    })
    const globalDoc = await createViewbookDoc({
      viewbookId: null,
      title: `${GLOBAL_DOC_TITLE_PREFIX}${crypto.randomUUID()}`,
      buf: Buffer.from('%PDF-1.7\nglobal'),
      createdBy: OPERATOR,
    })
    const snapshot = await collectClientViewbookAssetSnapshot(c.id)
    expect(snapshot?.filenames).toContain(theme.logo)
    expect(snapshot?.filenames).toContain(ownDoc.filename)
    expect(snapshot?.filenames).not.toContain(globalDoc.filename)
    await deleteViewbook(id)
    expect(await prisma.viewbook.findUnique({ where: { id } })).toBeNull()
    expect(await prisma.viewbookField.count({ where: { viewbookId: id } })).toBe(0)
    expect(await readViewbookAsset(String(id), theme.logo as string)).toBeNull()
    expect(await readViewbookAsset(String(id), ownDoc.filename)).toBeNull()
    expect(await readViewbookAsset('global', globalDoc.filename)).not.toBeNull()
  })

  it('client-cascade snapshot includes owned PDFs for post-delete cleanup', async () => {
    const c = await mkClient()
    const { id } = await createViewbook(c.id, 'upgrade', OPERATOR)
    const ownDoc = await createViewbookDoc({
      viewbookId: id,
      title: 'Cascade owned',
      buf: Buffer.from('%PDF-1.7\ncascade'),
      createdBy: OPERATOR,
    })
    const globalDoc = await createViewbookDoc({
      viewbookId: null,
      title: `${GLOBAL_DOC_TITLE_PREFIX}${crypto.randomUUID()}`,
      buf: Buffer.from('%PDF-1.7\nglobal survivor'),
      createdBy: OPERATOR,
    })
    await prisma.client.update({ where: { id: c.id }, data: { archivedAt: new Date() } })
    const snapshot = await collectClientViewbookAssetSnapshot(c.id)
    await prisma.client.delete({ where: { id: c.id } })
    if (snapshot) await deleteViewbookAssets(String(snapshot.viewbookId), snapshot.filenames)
    expect(await readViewbookAsset(String(id), ownDoc.filename)).toBeNull()
    expect(await readViewbookAsset('global', globalDoc.filename)).not.toBeNull()
  })

  it('updateViewbookTheme validates strictly and bumps on a valid save', async () => {
    const c = await mkClient()
    const { id } = await createViewbook(c.id, 'upgrade', OPERATOR)
    const before = await syncVersion(id)
    await expect(updateViewbookTheme(id, { bogus: true })).rejects.toMatchObject({ code: 'invalid_theme' })
    expect(await syncVersion(id)).toBe(before) // invalid payload never reaches the DB — no bump
    const saved = await updateViewbookTheme(id, { ...DEFAULT_THEME, primary: '#ABCDEF' })
    expect(saved.primary).toBe('#ABCDEF')
    expect(await syncVersion(id)).toBe(before + 1)
  })

  it('a stale theme save cannot resurrect a replaced asset filename', async () => {
    const c = await mkClient()
    const { id } = await createViewbook(c.id, 'upgrade', OPERATOR)
    const attached = await attachViewbookLogo(id, PNG)
    // Stale tab: full theme payload still carrying logo: null (pre-attach)
    const saved = await updateViewbookTheme(id, { ...DEFAULT_THEME, secondary: '#123456' })
    expect(saved.secondary).toBe('#123456')
    expect(saved.logo).toBe(attached.logo) // asset reference preserved from storage
  })
})

describe('moveViewbookStage', () => {
  it('moves forward and logs (with eventKey)', async () => {
    const client = await mkClient()
    const { id } = await createViewbook(client.id, 'upgrade', 'op@er.com')
    // pcCompletedAt stamped: this test is about forward-move mechanics, not
    // the Task 6 ack-to-stage fence (covered separately below).
    await prisma.viewbook.update({ where: { id }, data: { stage: 'post-contract', pcCompletedAt: new Date() } })
    const before = await syncVersion(id)
    const res = await moveViewbookStage(id, 'forward', 'post-contract', 'op@er.com')
    expect(res.stage).toBe('kickoff')
    const log = await prisma.viewbookStageLog.findFirstOrThrow({ where: { viewbookId: id } })
    expect(log).toMatchObject({ stage: 'kickoff', direction: 'forward', actor: 'op@er.com' })
    expect(log.eventKey).toMatch(/[0-9a-f-]{36}/)
    const act = await prisma.viewbookActivity.findFirstOrThrow({ where: { viewbookId: id, kind: 'stage-change' } })
    expect(act.actor).toBe('op@er.com')
    expect(await syncVersion(id)).toBe(before + 1)
  })
  it('409s at the boundary (building has no next)', async () => {
    const client = await mkClient()
    const { id } = await createViewbook(client.id, 'upgrade', 'op@er.com')
    await prisma.viewbook.update({ where: { id }, data: { stage: 'building' } }) // creation default is post-contract (PR5 Task 7)
    await expect(moveViewbookStage(id, 'forward', 'building', 'op@er.com')).rejects.toMatchObject({ status: 409 })
  })
  it('409s on stale expectedStage without touching the row or bumping', async () => {
    const client = await mkClient()
    const { id } = await createViewbook(client.id, 'upgrade', 'op@er.com')
    await prisma.viewbook.update({ where: { id }, data: { stage: 'building' } }) // creation default is post-contract (PR5 Task 7)
    const before = await syncVersion(id)
    await expect(moveViewbookStage(id, 'back', 'kickoff', 'op@er.com')).rejects.toMatchObject({ status: 409 })
    const vb = await prisma.viewbook.findUniqueOrThrow({ where: { id } })
    expect(vb.stage).toBe('building')
    expect(await syncVersion(id)).toBe(before)
  })
  it('moves back', async () => {
    const client = await mkClient()
    const { id } = await createViewbook(client.id, 'upgrade', 'op@er.com')
    await prisma.viewbook.update({ where: { id }, data: { stage: 'building' } }) // creation default is post-contract (PR5 Task 7)
    const res = await moveViewbookStage(id, 'back', 'building', 'op@er.com')
    expect(res.stage).toBe('website-specifics')
    expect(await prisma.viewbookEmailDelivery.count({ where: { viewbookId: id } })).toBe(0)
  })
  it('same-expectedStage double-fire: exactly one wins, one step, one log, one bump', async () => {
    const client = await mkClient()
    const { id } = await createViewbook(client.id, 'upgrade', 'op@er.com')
    await prisma.viewbook.update({ where: { id }, data: { stage: 'kickoff' } })
    const before = await syncVersion(id)
    const results = await Promise.allSettled([
      moveViewbookStage(id, 'forward', 'kickoff', 'a@er.com'),
      moveViewbookStage(id, 'forward', 'kickoff', 'b@er.com'),
    ])
    const wins = results.filter((r) => r.status === 'fulfilled')
    expect(wins).toHaveLength(1) // the loser 409s on the expectedStage fence
    const vb = await prisma.viewbook.findUniqueOrThrow({ where: { id } })
    expect(vb.stage).toBe('website-specifics') // exactly ONE step
    const logs = await prisma.viewbookStageLog.count({ where: { viewbookId: id } })
    expect(logs).toBe(1) // the losing move writes NO log
    // the loser's bump rolls back with its update+log — exactly one bump lands
    expect(await syncVersion(id)).toBe(before + 1)
  })

  it('a forward move creates one delivery per allowed recipient, enqueues each, and still bumps only once', async () => {
    const client = await mkClient()
    const { id } = await createViewbook(client.id, 'upgrade', OPERATOR)
    await prisma.viewbook.update({
      where: { id },
      // pcCompletedAt stamped: this test is about recipient/delivery routing,
      // not the Task 6 ack-to-stage fence (covered separately below).
      data: {
        stage: 'post-contract',
        pcCompletedAt: new Date(),
        clientNotifyJson: JSON.stringify(['member@example.com', 'primary@example.com']),
      },
    })
    await prisma.viewbookTeamMember.create({
      data: { viewbookId: id, memberKey: crypto.randomUUID(), name: 'Member', email: 'member@example.com', addedBy: OPERATOR },
    })
    await prisma.viewbookField.update({
      where: { viewbookId_defKey: { viewbookId: id, defKey: 'school-contact-email' } },
      data: { value: 'PRIMARY@EXAMPLE.COM' },
    })
    const before = await syncVersion(id)

    await moveViewbookStage(id, 'forward', 'post-contract', OPERATOR)

    const log = await prisma.viewbookStageLog.findFirstOrThrow({ where: { viewbookId: id } })
    const deliveries = await prisma.viewbookEmailDelivery.findMany({ where: { viewbookId: id }, orderBy: { recipient: 'asc' } })
    expect(deliveries).toEqual([
      expect.objectContaining({ kind: 'stage-change', recipient: 'member@example.com', dedupKey: `vb-stage:${log.eventKey}:member@example.com`, sentAt: null, suppressedAt: null, stageLogId: null }),
      expect.objectContaining({ kind: 'stage-change', recipient: 'primary@example.com', dedupKey: `vb-stage:${log.eventKey}:primary@example.com`, sentAt: null, suppressedAt: null, stageLogId: null }),
    ])
    let jobs = await prisma.job.findMany({ where: { id: '__none__' } })
    await vi.waitFor(async () => {
      jobs = await prisma.job.findMany({
        where: { type: VIEWBOOK_EMAIL_JOB_TYPE, dedupKey: { in: deliveries.map((d) => `viewbook-email:${d.id}`) } },
      })
      expect(jobs).toHaveLength(2)
    })
    expect(jobs).toHaveLength(2)
    expect(jobs.every((job) => job.groupKey === null)).toBe(true)
    expect(await syncVersion(id)).toBe(before + 1)
  })

  it('drops unmatched addresses and canonicalizes case-insensitive duplicates to one delivery', async () => {
    const client = await mkClient()
    const { id } = await createViewbook(client.id, 'upgrade', OPERATOR)
    await prisma.viewbook.update({
      where: { id },
      data: {
        stage: 'kickoff',
        clientNotifyJson: JSON.stringify(['MEMBER@example.com', 'member@EXAMPLE.COM', 'stranger@example.com']),
      },
    })
    await prisma.viewbookTeamMember.create({
      data: { viewbookId: id, memberKey: crypto.randomUUID(), name: 'Member', email: 'member@example.com', addedBy: OPERATOR },
    })

    await moveViewbookStage(id, 'forward', 'kickoff', OPERATOR)

    const deliveries = await prisma.viewbookEmailDelivery.findMany({ where: { viewbookId: id } })
    expect(deliveries).toHaveLength(1)
    expect(deliveries[0].recipient).toBe('member@example.com')
  })

  it('empty or corrupt recipient JSON creates no deliveries', async () => {
    const emptyClient = await mkClient()
    const empty = await createViewbook(emptyClient.id, 'upgrade', OPERATOR)
    await prisma.viewbook.update({ where: { id: empty.id }, data: { stage: 'kickoff', clientNotifyJson: '[]' } })
    await moveViewbookStage(empty.id, 'forward', 'kickoff', OPERATOR)
    expect(await prisma.viewbookEmailDelivery.count({ where: { viewbookId: empty.id } })).toBe(0)

    const corruptClient = await mkClient()
    const corrupt = await createViewbook(corruptClient.id, 'upgrade', OPERATOR)
    await prisma.viewbook.update({ where: { id: corrupt.id }, data: { stage: 'kickoff', clientNotifyJson: '{bad' } })
    await moveViewbookStage(corrupt.id, 'forward', 'kickoff', OPERATOR)
    expect(await prisma.viewbookEmailDelivery.count({ where: { viewbookId: corrupt.id } })).toBe(0)
  })

  it('a stale stage-fence replay creates zero delivery rows', async () => {
    const client = await mkClient()
    const { id } = await createViewbook(client.id, 'upgrade', OPERATOR)
    await prisma.viewbook.update({
      where: { id },
      data: { stage: 'building', clientNotifyJson: JSON.stringify(['member@example.com']) },
    })
    await prisma.viewbookTeamMember.create({
      data: { viewbookId: id, memberKey: crypto.randomUUID(), name: 'Member', email: 'member@example.com', addedBy: OPERATOR },
    })
    await expect(moveViewbookStage(id, 'forward', 'kickoff', OPERATOR)).rejects.toMatchObject({ code: 'stage_conflict' })
    expect(await prisma.viewbookEmailDelivery.count({ where: { viewbookId: id } })).toBe(0)
  })
})

// Task 6: force + the ack-to-stage forward fence.
describe('moveViewbookStage force + ack-to-stage forward fence', () => {
  it('409s ack_incomplete when advancing out of post-contract with pcCompletedAt null and no force; no stage change, no bump, no deliveries', async () => {
    const client = await mkClient()
    const { id } = await createViewbook(client.id, 'upgrade', OPERATOR)
    await prisma.viewbook.update({ where: { id }, data: { stage: 'post-contract' } })
    const before = await syncVersion(id)

    await expect(moveViewbookStage(id, 'forward', 'post-contract', OPERATOR)).rejects.toMatchObject({
      status: 409,
      code: 'ack_incomplete',
    })

    const vb = await prisma.viewbook.findUniqueOrThrow({ where: { id } })
    expect(vb.stage).toBe('post-contract')
    expect(vb.pcCompletedAt).toBeNull()
    expect(await syncVersion(id)).toBe(before)
    expect(await prisma.viewbookEmailDelivery.count({ where: { viewbookId: id } })).toBe(0)
  })

  it('force advances out of post-contract: stamps pcCompletedAt, creates + enqueues one pc-complete delivery, still fires normal stage-change deliveries, one bump total', async () => {
    const client = await mkClient()
    const { id } = await createViewbook(client.id, 'upgrade', OPERATOR)
    await prisma.viewbook.update({
      where: { id },
      data: { stage: 'post-contract', clientNotifyJson: JSON.stringify(['member@example.com']) },
    })
    await prisma.viewbookTeamMember.create({
      data: { viewbookId: id, memberKey: crypto.randomUUID(), name: 'Member', email: 'member@example.com', addedBy: OPERATOR },
    })
    const before = await syncVersion(id)

    const res = await moveViewbookStage(id, 'forward', 'post-contract', OPERATOR, true)
    expect(res.stage).toBe('kickoff')

    const vb = await prisma.viewbook.findUniqueOrThrow({ where: { id } })
    expect(vb.stage).toBe('kickoff')
    expect(vb.pcCompletedAt).not.toBeNull()
    expect(await syncVersion(id)).toBe(before + 1) // force stamp + stage flip = ONE bump

    const pcComplete = await prisma.viewbookEmailDelivery.findMany({ where: { viewbookId: id, kind: 'pc-complete' } })
    expect(pcComplete).toHaveLength(1)
    expect(pcComplete[0]).toMatchObject({ dedupKey: `vb-pc-complete:${id}`, sentAt: null, suppressedAt: null })

    const stageChange = await prisma.viewbookEmailDelivery.findMany({ where: { viewbookId: id, kind: 'stage-change' } })
    expect(stageChange).toHaveLength(1)
    expect(stageChange[0].recipient).toBe('member@example.com')

    await vi.waitFor(async () => {
      const jobs = await prisma.job.findMany({
        where: { type: VIEWBOOK_EMAIL_JOB_TYPE, dedupKey: `viewbook-email:${pcComplete[0].id}` },
      })
      expect(jobs).toHaveLength(1)
    })
  })

  it('force is safe against a pre-existing pc-complete delivery row: pcCompletedAt still gets stamped, no duplicate row, no throw (ON CONFLICT DO NOTHING)', async () => {
    const client = await mkClient()
    const { id } = await createViewbook(client.id, 'upgrade', OPERATOR)
    await prisma.viewbook.update({ where: { id }, data: { stage: 'post-contract' } })
    // Simulate a stranded delivery row from a race with the ack path (Task
    // 2) — pcCompletedAt is STILL null, but the dedupKey row already exists.
    await prisma.viewbookEmailDelivery.create({
      data: { viewbookId: id, kind: 'pc-complete', recipient: 'someone@example.com', dedupKey: `vb-pc-complete:${id}` },
    })

    const res = await moveViewbookStage(id, 'forward', 'post-contract', OPERATOR, true)
    expect(res.stage).toBe('kickoff')

    const vb = await prisma.viewbook.findUniqueOrThrow({ where: { id } })
    expect(vb.pcCompletedAt).not.toBeNull()
    expect(await prisma.viewbookEmailDelivery.count({ where: { viewbookId: id, kind: 'pc-complete' } })).toBe(1)
  })

  it('pcCompletedAt already set (e.g. natural ack completion): forward move advances normally without force, no additional pc-complete delivery', async () => {
    const client = await mkClient()
    const { id } = await createViewbook(client.id, 'upgrade', OPERATOR)
    await prisma.viewbook.update({ where: { id }, data: { stage: 'post-contract', pcCompletedAt: new Date() } })
    await prisma.viewbookEmailDelivery.create({
      data: { viewbookId: id, kind: 'pc-complete', recipient: 'someone@example.com', dedupKey: `vb-pc-complete:${id}` },
    })

    const res = await moveViewbookStage(id, 'forward', 'post-contract', OPERATOR)
    expect(res.stage).toBe('kickoff')
    expect(await prisma.viewbookEmailDelivery.count({ where: { viewbookId: id, kind: 'pc-complete' } })).toBe(1)
  })

  it('the fence never blocks a back-move, even with pcCompletedAt null', async () => {
    const client = await mkClient()
    const { id } = await createViewbook(client.id, 'upgrade', OPERATOR)
    await prisma.viewbook.update({ where: { id }, data: { stage: 'kickoff' } })
    const res = await moveViewbookStage(id, 'back', 'kickoff', OPERATOR)
    expect(res.stage).toBe('post-contract')
    expect(await prisma.viewbookEmailDelivery.count({ where: { viewbookId: id, kind: 'pc-complete' } })).toBe(0)
  })

  it('the fence never blocks a forward move whose expectedStage is not post-contract, even with pcCompletedAt null', async () => {
    const client = await mkClient()
    const { id } = await createViewbook(client.id, 'upgrade', OPERATOR)
    await prisma.viewbook.update({ where: { id }, data: { stage: 'kickoff' } })
    const res = await moveViewbookStage(id, 'forward', 'kickoff', OPERATOR)
    expect(res.stage).toBe('website-specifics')
    expect((await prisma.viewbook.findUniqueOrThrow({ where: { id } })).pcCompletedAt).toBeNull()
  })

  it('force on a non-post-contract forward is a harmless no-op: advances, but stamps nothing and creates no pc-complete delivery', async () => {
    const client = await mkClient()
    const { id } = await createViewbook(client.id, 'upgrade', OPERATOR)
    await prisma.viewbook.update({ where: { id }, data: { stage: 'kickoff' } })
    const res = await moveViewbookStage(id, 'forward', 'kickoff', OPERATOR, true)
    expect(res.stage).toBe('website-specifics')
    const vb = await prisma.viewbook.findUniqueOrThrow({ where: { id } })
    expect(vb.pcCompletedAt).toBeNull()
    expect(await prisma.viewbookEmailDelivery.count({ where: { viewbookId: id, kind: 'pc-complete' } })).toBe(0)
  })
})

describe('assignViewbookCsm', () => {
  async function seedRoster() {
    await prisma.viewbookGlobalContent.upsert({
      where: { key: 'team' },
      update: {
        bodyJson: JSON.stringify([
          { name: 'Casey CSM', role: 'CSM', photo: null, blurb: '', isCsm: true, email: 'casey@example.com' },
          { name: 'Taylor Teammate', role: 'Designer', photo: null, blurb: '', email: 'taylor@example.com' },
        ]),
        updatedBy: OPERATOR,
      },
      create: {
        key: 'team',
        bodyJson: JSON.stringify([
          { name: 'Casey CSM', role: 'CSM', photo: null, blurb: '', isCsm: true, email: 'casey@example.com' },
          { name: 'Taylor Teammate', role: 'Designer', photo: null, blurb: '', email: 'taylor@example.com' },
        ]),
        updatedBy: OPERATOR,
      },
    })
  }

  it('assigns a flagged roster member with one relative bump and one activity row', async () => {
    await seedRoster()
    const client = await mkClient()
    const { id } = await createViewbook(client.id, 'upgrade', OPERATOR)
    const before = await syncVersion(id)

    await assignViewbookCsm(id, 'Casey CSM', OPERATOR)

    expect((await prisma.viewbook.findUniqueOrThrow({ where: { id } })).csmName).toBe('Casey CSM')
    expect(await syncVersion(id)).toBe(before + 1)
    expect(await prisma.viewbookActivity.findMany({ where: { viewbookId: id, kind: 'csm-assigned' } })).toEqual([
      expect.objectContaining({ actor: OPERATOR, summary: 'Assigned CSM: Casey CSM' }),
    ])
  })

  it('rejects absent and non-flagged names without a bump or activity', async () => {
    await seedRoster()
    for (const name of ['Taylor Teammate', 'Missing Person']) {
      const client = await mkClient()
      const { id } = await createViewbook(client.id, 'upgrade', OPERATOR)
      const before = await syncVersion(id)
      await expect(assignViewbookCsm(id, name, OPERATOR)).rejects.toMatchObject({ status: 400, code: 'invalid_csm' })
      expect(await syncVersion(id)).toBe(before)
      expect(await prisma.viewbookActivity.count({ where: { viewbookId: id } })).toBe(0)
    }
  })

  it('clears an assignment with one bump', async () => {
    await seedRoster()
    const client = await mkClient()
    const { id } = await createViewbook(client.id, 'upgrade', OPERATOR)
    await prisma.viewbook.update({ where: { id }, data: { csmName: 'Casey CSM' } })
    const before = await syncVersion(id)
    await assignViewbookCsm(id, null, OPERATOR)
    expect((await prisma.viewbook.findUniqueOrThrow({ where: { id } })).csmName).toBeNull()
    expect(await syncVersion(id)).toBe(before + 1)
  })

  it('archived clients reject with no bump or activity', async () => {
    await seedRoster()
    const client = await mkClient(true)
    const viewbook = await prisma.viewbook.create({ data: { clientId: client.id, kind: 'upgrade', token: crypto.randomUUID() } })
    const before = await syncVersion(viewbook.id)
    await expect(assignViewbookCsm(viewbook.id, 'Casey CSM', OPERATOR)).rejects.toMatchObject({ status: 409, code: 'client_archived' })
    expect(await syncVersion(viewbook.id)).toBe(before)
    expect(await prisma.viewbookActivity.count({ where: { viewbookId: viewbook.id } })).toBe(0)
  })

  it('unknown ids 404 without bumping an unrelated viewbook', async () => {
    await seedRoster()
    const client = await mkClient()
    const unrelated = await createViewbook(client.id, 'upgrade', OPERATOR)
    const before = await syncVersion(unrelated.id)
    await expect(assignViewbookCsm(999_999_999, 'Casey CSM', OPERATOR)).rejects.toMatchObject({ status: 404, code: 'not_found' })
    expect(await syncVersion(unrelated.id)).toBe(before)
  })

  it('same-value replay is a no-op with no bump or activity', async () => {
    await seedRoster()
    const client = await mkClient()
    const { id } = await createViewbook(client.id, 'upgrade', OPERATOR)
    await prisma.viewbook.update({ where: { id }, data: { csmName: 'Casey CSM' } })
    const before = await syncVersion(id)
    await assignViewbookCsm(id, 'Casey CSM', OPERATOR)
    expect(await syncVersion(id)).toBe(before)
    expect(await prisma.viewbookActivity.count({ where: { viewbookId: id } })).toBe(0)
  })

  it('a lost pre-state race makes bump, activity, and csm update all miss', async () => {
    await seedRoster()
    const client = await mkClient()
    const { id } = await createViewbook(client.id, 'upgrade', OPERATOR)
    const before = await syncVersion(id)
    await assignViewbookCsm(id, 'Casey CSM', OPERATOR, {
      beforeWrite: async () => {
        await prisma.client.update({ where: { id: client.id }, data: { archivedAt: new Date() } })
      },
    })
    const row = await prisma.viewbook.findUniqueOrThrow({ where: { id } })
    expect(row.csmName).toBeNull()
    expect(row.syncVersion).toBe(before)
    expect(await prisma.viewbookActivity.count({ where: { viewbookId: id } })).toBe(0)
  })
})
