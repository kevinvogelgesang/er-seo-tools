import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import {
  createViewbook,
  rotateViewbookToken,
  revokeViewbook,
  setSectionState,
  createMilestone,
  updateMilestone,
  syncCatalogQuestions,
  deleteViewbook,
  attachViewbookLogo,
  updateViewbookTheme,
  collectClientViewbookAssetSnapshot,
} from './service'
import { readViewbookAsset } from './assets'
import { DEFAULT_THEME } from './theme'
import { CATALOG } from './catalog'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)])
const OPERATOR = 'kevin@enrollmentresources.com'

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
  await prisma.client.deleteMany({ where: { name: { startsWith: 'vb-test-' } } })
})

async function mkClient(archived = false) {
  return prisma.client.create({
    data: { name: `vb-test-${crypto.randomUUID()}`, archivedAt: archived ? new Date() : null },
  })
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
    expect(vb.sections).toHaveLength(7)
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
})

describe('token lifecycle', () => {
  it('rotate issues a new token AND clears revokedAt', async () => {
    const c = await mkClient()
    const { id, token } = await createViewbook(c.id, 'upgrade', OPERATOR)
    await revokeViewbook(id)
    let row = await prisma.viewbook.findUniqueOrThrow({ where: { id } })
    expect(row.revokedAt).not.toBeNull()
    const rotated = await rotateViewbookToken(id)
    expect(rotated.token).not.toBe(token)
    row = await prisma.viewbook.findUniqueOrThrow({ where: { id } })
    expect(row.revokedAt).toBeNull()
  })
})

describe('sections', () => {
  it('done stamps doneAt; re-activate clears it; unknown key 400', async () => {
    const c = await mkClient()
    const { id } = await createViewbook(c.id, 'upgrade', OPERATOR)
    await setSectionState(id, 'data-source', 'done', OPERATOR)
    let s = await prisma.viewbookSection.findUniqueOrThrow({
      where: { viewbookId_sectionKey: { viewbookId: id, sectionKey: 'data-source' } },
    })
    expect(s.doneAt).not.toBeNull()
    const activity = await prisma.viewbookActivity.findMany({ where: { viewbookId: id } })
    expect(activity).toEqual([expect.objectContaining({
      kind: 'section-done', actor: OPERATOR, summary: 'Completed data-source',
    })])
    await setSectionState(id, 'data-source', 'active', OPERATOR)
    s = await prisma.viewbookSection.findUniqueOrThrow({
      where: { viewbookId_sectionKey: { viewbookId: id, sectionKey: 'data-source' } },
    })
    expect(s.doneAt).toBeNull()
    await expect(setSectionState(id, 'nope', 'done', OPERATOR)).rejects.toMatchObject({ code: 'invalid_section' })
  })
})

describe('milestone promotion', () => {
  it('promoting demotes the previous current; exactly one current survives', async () => {
    const c = await mkClient()
    const { id } = await createViewbook(c.id, 'upgrade', OPERATOR)
    const design = await prisma.viewbookMilestone.findFirstOrThrow({
      where: { viewbookId: id, title: 'Design' },
    })
    await updateMilestone(id, design.id, { status: 'current' })
    const current = await prisma.viewbookMilestone.findMany({ where: { viewbookId: id, status: 'current' } })
    expect(current).toHaveLength(1)
    expect(current[0].id).toBe(design.id)
  })

  it('cross-viewbook promotion rejects AND rolls back the demote', async () => {
    const c1 = await mkClient()
    const c2 = await mkClient()
    const a = await createViewbook(c1.id, 'upgrade', OPERATOR)
    const b = await createViewbook(c2.id, 'upgrade', OPERATOR)
    const foreign = await prisma.viewbookMilestone.findFirstOrThrow({ where: { viewbookId: b.id } })
    await expect(updateMilestone(a.id, foreign.id, { status: 'current' })).rejects.toBeTruthy()
    const current = await prisma.viewbookMilestone.findMany({
      where: { viewbookId: a.id, status: 'current' },
    })
    expect(current).toHaveLength(1)
    expect(current[0].title).toBe('Kickoff') // demote rolled back
  })

  it('createMilestone as current demotes the seed current', async () => {
    const c = await mkClient()
    const { id } = await createViewbook(c.id, 'upgrade', OPERATOR)
    const m = await createMilestone(id, { title: 'Extra', sortOrder: 8 }, { current: true })
    const current = await prisma.viewbookMilestone.findMany({ where: { viewbookId: id, status: 'current' } })
    expect(current).toHaveLength(1)
    expect(current[0].id).toBe(m.id)
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
})

describe('assets + delete lifecycle', () => {
  it('attachViewbookLogo stamps the theme and replaces the old file', async () => {
    const c = await mkClient()
    const { id } = await createViewbook(c.id, 'upgrade', OPERATOR)
    const t1 = await attachViewbookLogo(id, PNG)
    expect(t1.logo).toMatch(/\.png$/)
    const t2 = await attachViewbookLogo(id, PNG)
    expect(t2.logo).not.toBe(t1.logo)
    expect(await readViewbookAsset(String(id), t1.logo as string)).toBeNull() // old file gone
    expect(await readViewbookAsset(String(id), t2.logo as string)).not.toBeNull()
  })

  it('attach on a missing viewbook leaves no orphan file', async () => {
    await expect(attachViewbookLogo(999_999_999, PNG)).rejects.toBeTruthy()
    const { readdir } = await import('fs/promises')
    const entries = await readdir(assetsDir, { recursive: true }).catch(() => [])
    expect((entries as string[]).filter((e) => String(e).endsWith('.png'))).toHaveLength(0)
  })

  it('deleteViewbook removes the subtree and its files; snapshot collects filenames', async () => {
    const c = await mkClient()
    const { id } = await createViewbook(c.id, 'upgrade', OPERATOR)
    const theme = await attachViewbookLogo(id, PNG)
    const snapshot = await collectClientViewbookAssetSnapshot(c.id)
    expect(snapshot?.filenames).toContain(theme.logo)
    await deleteViewbook(id)
    expect(await prisma.viewbook.findUnique({ where: { id } })).toBeNull()
    expect(await prisma.viewbookField.count({ where: { viewbookId: id } })).toBe(0)
    expect(await readViewbookAsset(String(id), theme.logo as string)).toBeNull()
  })

  it('updateViewbookTheme validates strictly', async () => {
    const c = await mkClient()
    const { id } = await createViewbook(c.id, 'upgrade', OPERATOR)
    await expect(updateViewbookTheme(id, { bogus: true })).rejects.toMatchObject({ code: 'invalid_theme' })
    const saved = await updateViewbookTheme(id, { ...DEFAULT_THEME, primary: '#ABCDEF' })
    expect(saved.primary).toBe('#ABCDEF')
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
