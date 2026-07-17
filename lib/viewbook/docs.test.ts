import crypto from 'crypto'
import path from 'path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { prisma } from '@/lib/db'
import { readViewbookAsset } from './assets'
import { createViewbook } from './service'
import { createViewbookDoc, deleteViewbookDoc, listViewbookDocs } from './docs'

const PDF = Buffer.from('%PDF-1.7\ntest document')
const PREFIX = 'vb-docs-'
let assetsDir: string

beforeEach(async () => {
  assetsDir = await mkdtemp(path.join(tmpdir(), PREFIX))
  process.env.VIEWBOOK_ASSETS_DIR = assetsDir
  await prisma.viewbookDoc.deleteMany({ where: { createdBy: `${PREFIX}test` } })
})

afterEach(async () => {
  delete process.env.VIEWBOOK_ASSETS_DIR
  await rm(assetsDir, { recursive: true, force: true })
})

afterAll(async () => {
  await prisma.viewbookDoc.deleteMany({ where: { createdBy: `${PREFIX}test` } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

async function ownViewbook() {
  const client = await prisma.client.create({ data: { name: `${PREFIX}${crypto.randomUUID()}` } })
  return createViewbook(client.id, 'upgrade', `${PREFIX}test`)
}

async function syncVersion(viewbookId: number): Promise<number> {
  return (await prisma.viewbook.findUniqueOrThrow({ where: { id: viewbookId } })).syncVersion
}

function create(input: Partial<Parameters<typeof createViewbookDoc>[0]> = {}) {
  return createViewbookDoc({
    viewbookId: null,
    title: 'Strategy guide',
    blurb: 'Read this first.',
    buf: PDF,
    createdBy: `${PREFIX}test`,
    ...input,
  })
}

describe('viewbook document service', () => {
  it('rejects title, blurb, byte, and PDF-magic cap violations', async () => {
    await expect(create({ title: 'a'.repeat(161) })).rejects.toMatchObject({ status: 400 })
    await expect(create({ title: 'é'.repeat(81) })).rejects.toMatchObject({ status: 400 })
    await expect(create({ blurb: 'a'.repeat(513) })).rejects.toMatchObject({ status: 400 })
    await expect(create({ buf: Buffer.alloc(20 * 1024 * 1024 + 1) })).rejects.toMatchObject({ status: 400 })
    await expect(create({ buf: Buffer.from('not a PDF') })).rejects.toMatchObject({ status: 400 })
  })

  it('lists global and own rows separately in sortOrder/id order', async () => {
    const { id } = await ownViewbook()
    const globalOne = await create({ title: 'Global one' })
    const globalTwo = await create({ title: 'Global two' })
    const ownOne = await create({ viewbookId: id, title: 'Own one' })
    const ownTwo = await create({ viewbookId: id, title: 'Own two' })

    const docs = await listViewbookDocs(id)
    expect(docs.global.map((d) => d.id)).toEqual([globalOne.id, globalTwo.id])
    expect(docs.own.map((d) => d.id)).toEqual([ownOne.id, ownTwo.id])
    expect(docs.global[0]).toEqual({
      id: globalOne.id,
      title: 'Global one',
      blurb: 'Read this first.',
      filename: globalOne.filename,
      sortOrder: 1,
    })
    expect(docs.own.map((d) => d.sortOrder)).toEqual([1, 2])
  })

  it('scope-fences deletes and removes the captured file only after a winning delete', async () => {
    const { id } = await ownViewbook()
    const own = await create({ viewbookId: id })
    await expect(deleteViewbookDoc(own.id, null)).rejects.toMatchObject({ status: 404 })
    expect(await readViewbookAsset(String(id), own.filename)).not.toBeNull()

    await deleteViewbookDoc(own.id, id)
    expect(await readViewbookAsset(String(id), own.filename)).toBeNull()
    await expect(deleteViewbookDoc(own.id, id)).rejects.toMatchObject({ status: 404 })
  })

  it('cleans up the written file when row creation fails', async () => {
    await expect(create({ viewbookId: 999_999_999 })).rejects.toBeTruthy()
    const entries = await readdir(assetsDir, { recursive: true }).catch(() => [])
    expect((entries as string[]).filter((entry) => String(entry).endsWith('.pdf'))).toHaveLength(0)
  })

  describe('syncVersion bumps', () => {
    it('a global doc create bumps two independent viewbooks +1 each', async () => {
      const a = await ownViewbook()
      const b = await ownViewbook()
      const [beforeA, beforeB] = await Promise.all([syncVersion(a.id), syncVersion(b.id)])
      await create()
      const [afterA, afterB] = await Promise.all([syncVersion(a.id), syncVersion(b.id)])
      expect(afterA).toBe(beforeA + 1)
      expect(afterB).toBe(beforeB + 1)
    })

    it('an owned doc create bumps only its own viewbook', async () => {
      const owner = await ownViewbook()
      const other = await ownViewbook()
      const [beforeOwner, beforeOther] = await Promise.all([syncVersion(owner.id), syncVersion(other.id)])
      await create({ viewbookId: owner.id })
      const [afterOwner, afterOther] = await Promise.all([syncVersion(owner.id), syncVersion(other.id)])
      expect(afterOwner).toBe(beforeOwner + 1)
      expect(afterOther).toBe(beforeOther)
    })

    it('a successful owned delete bumps its own viewbook +1', async () => {
      const { id } = await ownViewbook()
      const own = await create({ viewbookId: id })
      const before = await syncVersion(id)
      await deleteViewbookDoc(own.id, id)
      expect(await syncVersion(id)).toBe(before + 1)
    })

    it('a cross-scope delete attempt 404s and bumps nothing', async () => {
      const owner = await ownViewbook()
      const other = await ownViewbook()
      const own = await create({ viewbookId: owner.id })
      const [beforeOwner, beforeOther] = await Promise.all([syncVersion(owner.id), syncVersion(other.id)])
      await expect(deleteViewbookDoc(own.id, other.id)).rejects.toMatchObject({ status: 404 })
      const [afterOwner, afterOther] = await Promise.all([syncVersion(owner.id), syncVersion(other.id)])
      expect(afterOwner).toBe(beforeOwner)
      expect(afterOther).toBe(beforeOther)
    })

    it('a global delete bumps every viewbook +1', async () => {
      const a = await ownViewbook()
      const b = await ownViewbook()
      const global = await create()
      const [beforeA, beforeB] = await Promise.all([syncVersion(a.id), syncVersion(b.id)])
      await deleteViewbookDoc(global.id, null)
      const [afterA, afterB] = await Promise.all([syncVersion(a.id), syncVersion(b.id)])
      expect(afterA).toBe(beforeA + 1)
      expect(afterB).toBe(beforeB + 1)
    })
  })
})
