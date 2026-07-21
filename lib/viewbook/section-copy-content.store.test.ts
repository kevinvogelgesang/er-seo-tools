import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { createViewbook } from './service'
import crypto from 'crypto'
import {
  putSectionCopyGlobal, deleteSectionCopyGlobal, getSectionCopyGlobalMap,
  putSectionCopyOverride, deleteSectionCopyOverride, getSectionCopyOverrideMap,
  sectionCopyKey,
} from './section-copy-content'
import { HttpError } from '@/lib/api/errors'

const OPERATOR = 'kevin@enrollmentresources.com'

async function mkClient() {
  return prisma.client.create({ data: { name: `vb-test-${crypto.randomUUID()}` } })
}

let vbA: number
let vbB: number

beforeEach(async () => {
  await prisma.viewbookGlobalContent.deleteMany({})
  await prisma.viewbookContentOverride.deleteMany({})
  vbA = (await createViewbook((await mkClient()).id, 'upgrade', OPERATOR)).id
  vbB = (await createViewbook((await mkClient()).id, 'upgrade', OPERATOR)).id
})

afterAll(async () => {
  await prisma.viewbookGlobalContent.deleteMany({})
  await prisma.viewbookContentOverride.deleteMany({})
  await prisma.client.deleteMany({ where: { name: { startsWith: 'vb-test-' } } })
})

describe('section-copy store', () => {
  it('global put/get round-trips and is readable via the exact-key map', async () => {
    await putSectionCopyGlobal('brand', { purpose: 'p', whatThis: 't', whatWeNeed: 'n' }, 'op')
    const map = await getSectionCopyGlobalMap()
    expect(map.brand).toEqual({ purpose: 'p', whatThis: 't', whatWeNeed: 'n' })
  })

  it('global write bumps syncVersion on ALL viewbooks', async () => {
    const before = await prisma.viewbook.findMany({ select: { id: true, syncVersion: true } })
    await putSectionCopyGlobal('brand', { purpose: 'p', whatThis: 't', whatWeNeed: null }, 'op')
    for (const row of before) {
      const after = await prisma.viewbook.findUnique({ where: { id: row.id }, select: { syncVersion: true } })
      expect(after!.syncVersion).toBeGreaterThan(row.syncVersion)
    }
  })

  it('override write bumps ONLY its own viewbook', async () => {
    const [a0, b0] = await Promise.all([
      prisma.viewbook.findUnique({ where: { id: vbA }, select: { syncVersion: true } }),
      prisma.viewbook.findUnique({ where: { id: vbB }, select: { syncVersion: true } }),
    ])
    await putSectionCopyOverride(vbA, 'brand', { purpose: 'p', whatThis: 't', whatWeNeed: null }, 'op')
    const [a1, b1] = await Promise.all([
      prisma.viewbook.findUnique({ where: { id: vbA }, select: { syncVersion: true } }),
      prisma.viewbook.findUnique({ where: { id: vbB }, select: { syncVersion: true } }),
    ])
    expect(a1!.syncVersion).toBeGreaterThan(a0!.syncVersion)
    expect(b1!.syncVersion).toBe(b0!.syncVersion)
  })

  it('override map is per-viewbook and exact-key', async () => {
    await putSectionCopyOverride(vbA, 'brand', { purpose: 'o', whatThis: 'ot', whatWeNeed: null }, 'op')
    expect((await getSectionCopyOverrideMap(vbA)).brand).toEqual({ purpose: 'o', whatThis: 'ot', whatWeNeed: null })
    expect((await getSectionCopyOverrideMap(vbB)).brand).toBeUndefined()
  })

  it('a corrupt stored row reads as ABSENT (not thrown)', async () => {
    await prisma.viewbookGlobalContent.create({ data: { key: sectionCopyKey('welcome'), bodyJson: '{bad json', updatedBy: 'op' } })
    const map = await getSectionCopyGlobalMap()
    expect(map.welcome).toBeUndefined()
  })

  it('deleting a missing row returns 404 and does NOT bump', async () => {
    const before = await prisma.viewbook.findUnique({ where: { id: vbA }, select: { syncVersion: true } })
    await expect(deleteSectionCopyOverride(vbA, 'materials')).rejects.toBeInstanceOf(HttpError)
    const after = await prisma.viewbook.findUnique({ where: { id: vbA }, select: { syncVersion: true } })
    expect(after!.syncVersion).toBe(before!.syncVersion)
  })

  it('deleteSectionCopyGlobal reverts to default (removes the row)', async () => {
    await putSectionCopyGlobal('strategy', { purpose: 'p', whatThis: 't', whatWeNeed: null }, 'op')
    await deleteSectionCopyGlobal('strategy')
    expect((await getSectionCopyGlobalMap()).strategy).toBeUndefined()
  })
})
