import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { prisma } from '@/lib/db'
import {
  GLOBAL_CONTENT_KEYS,
  validateGlobalContent,
  putGlobalContent,
  getGlobalContent,
  getAllGlobalContent,
  attachTeamPhoto,
  putContentOverride,
  deleteContentOverride,
} from './global-content'
import { readViewbookAsset } from './assets'
import { createViewbook } from './service'
import crypto from 'crypto'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)])
const OPERATOR = 'kevin@enrollmentresources.com'

const roster = [{ name: 'Kevin', role: 'Web Lead', photo: null, blurb: 'Builds the sites.' }]
const blocks = { blocks: [{ heading: 'Our process', body: 'We build fast.' }] }

let assetsDir: string
beforeEach(async () => {
  assetsDir = await mkdtemp(path.join(tmpdir(), 'vb-gc-'))
  process.env.VIEWBOOK_ASSETS_DIR = assetsDir
  await prisma.viewbookGlobalContent.deleteMany({})
})
afterEach(async () => {
  delete process.env.VIEWBOOK_ASSETS_DIR
  await rm(assetsDir, { recursive: true, force: true })
})
afterAll(async () => {
  await prisma.viewbookGlobalContent.deleteMany({})
  await prisma.client.deleteMany({ where: { name: { startsWith: 'vb-test-' } } })
})

describe('validateGlobalContent', () => {
  it('accepts a valid roster and blocks; rejects wrong shapes per key', () => {
    expect(validateGlobalContent('team', roster)).toEqual(roster)
    expect(validateGlobalContent('process', blocks)).toEqual(blocks)
    expect(validateGlobalContent('team', blocks)).toBeNull()
    expect(validateGlobalContent('process', roster)).toBeNull()
    expect(validateGlobalContent('team', [{ name: '', role: 'x', photo: null, blurb: '' }])).toBeNull()
  })

  it('requires unique team member names (photo attachment selector)', () => {
    const dup = [...roster, { name: 'Kevin', role: 'Other', photo: null, blurb: '' }]
    expect(validateGlobalContent('team', dup)).toBeNull()
  })

  it('enforces caps', () => {
    const fatRoster = Array.from({ length: 21 }, (_, i) => ({ name: `P${i}`, role: 'x', photo: null, blurb: '' }))
    expect(validateGlobalContent('team', fatRoster)).toBeNull()
    expect(validateGlobalContent('why', { blocks: [{ heading: 'h', body: 'a'.repeat(4097) }] })).toBeNull()
  })
})

describe('put/get', () => {
  it('roundtrips; unknown key 400s; corrupt row reads null', async () => {
    await putGlobalContent('team', roster, OPERATOR)
    expect(await getGlobalContent('team')).toEqual(roster)
    await expect(putGlobalContent('nope', roster, OPERATOR)).rejects.toMatchObject({ code: 'invalid_content' })
    await prisma.viewbookGlobalContent.update({ where: { key: 'team' }, data: { bodyJson: '{corrupt' } })
    expect(await getGlobalContent('team')).toBeNull()
    const all = await getAllGlobalContent()
    expect(Object.keys(all).sort()).toEqual([...GLOBAL_CONTENT_KEYS].sort())
  })
})

describe('attachTeamPhoto', () => {
  it('stamps the member photo atomically and deletes the replaced file', async () => {
    await putGlobalContent('team', roster, OPERATOR)
    const first = await attachTeamPhoto('Kevin', PNG, OPERATOR)
    const second = await attachTeamPhoto('Kevin', PNG, OPERATOR)
    expect(second).not.toBe(first)
    expect(await readViewbookAsset('global', first)).toBeNull()
    expect(await readViewbookAsset('global', second)).not.toBeNull()
    const stored = await getGlobalContent('team')
    expect((stored as Array<{ photo: string | null }>)[0].photo).toBe(second)
  })

  it('missing member deletes the new file and 404s', async () => {
    await putGlobalContent('team', roster, OPERATOR)
    await expect(attachTeamPhoto('Nobody', PNG, OPERATOR)).rejects.toMatchObject({ code: 'member_not_found' })
    const { readdir } = await import('fs/promises')
    const entries = (await readdir(path.join(assetsDir, 'global')).catch(() => [])) as string[]
    expect(entries.filter((e) => e.endsWith('.png'))).toHaveLength(0)
  })

  it('concurrent roster conflict deletes the new file and 409s', async () => {
    await putGlobalContent('team', roster, OPERATOR)
    // Simulate a concurrent edit landing between load and stamp by injecting
    // a conflicting write through the deps seam.
    await expect(
      attachTeamPhoto('Kevin', PNG, OPERATOR, {
        beforeStamp: async () => {
          await putGlobalContent('team', [{ ...roster[0], blurb: 'edited meanwhile' }], OPERATOR)
        },
      }),
    ).rejects.toMatchObject({ code: 'roster_conflict' })
    const { readdir } = await import('fs/promises')
    const entries = (await readdir(path.join(assetsDir, 'global')).catch(() => [])) as string[]
    expect(entries.filter((e) => e.endsWith('.png'))).toHaveLength(0)
  })
})

describe('roster single-owner photos', () => {
  it('a stale roster save cannot resurrect a replaced photo; removed members lose their files', async () => {
    await putGlobalContent('team', roster, OPERATOR)
    const photo = await attachTeamPhoto('Kevin', PNG, OPERATOR)
    // Stale tab: roster payload still carrying photo: null — must be ignored.
    await putGlobalContent('team', [{ ...roster[0], blurb: 'updated' }], OPERATOR)
    const stored = await getGlobalContent('team')
    expect((stored as Array<{ photo: string | null }>)[0].photo).toBe(photo)

    // Removing the member best-effort-deletes their photo file.
    await putGlobalContent('team', [{ name: 'New Person', role: 'x', photo: null, blurb: '' }], OPERATOR)
    expect(await readViewbookAsset('global', photo)).toBeNull()
  })
})

async function mkClient() {
  return prisma.client.create({ data: { name: `vb-test-${crypto.randomUUID()}` } })
}

async function syncVersion(viewbookId: number): Promise<number> {
  return (await prisma.viewbook.findUniqueOrThrow({ where: { id: viewbookId } })).syncVersion
}

describe('syncVersion bumps (v2 PR2 task 4)', () => {
  it('putGlobalContent (non-team) bumps every viewbook, unscoped', async () => {
    const a = await createViewbook((await mkClient()).id, 'upgrade', OPERATOR)
    const b = await createViewbook((await mkClient()).id, 'upgrade', OPERATOR)
    const beforeA = await syncVersion(a.id)
    const beforeB = await syncVersion(b.id)
    await putGlobalContent('process', blocks, OPERATOR)
    expect(await syncVersion(a.id)).toBe(beforeA + 1)
    expect(await syncVersion(b.id)).toBe(beforeB + 1)
  })

  it('putTeamRoster stale-bodyJson conflict bumps nothing beyond the winner', async () => {
    const a = await createViewbook((await mkClient()).id, 'upgrade', OPERATOR)
    await putGlobalContent('team', roster, OPERATOR)
    const before = await syncVersion(a.id)
    const results = await Promise.allSettled([
      putGlobalContent('team', [{ ...roster[0], blurb: 'racer A' }], OPERATOR),
      putGlobalContent('team', [{ ...roster[0], blurb: 'racer B' }], OPERATOR),
    ])
    const wins = results.filter((r) => r.status === 'fulfilled')
    const losses = results.filter((r) => r.status === 'rejected')
    expect(wins).toHaveLength(1)
    expect(losses).toHaveLength(1)
    expect((losses[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'roster_conflict' })
    // The loser's fenced bump rolls back with its updateMany — exactly ONE bump lands.
    expect(await syncVersion(a.id)).toBe(before + 1)
  })

  it('attachTeamPhoto success bumps all viewbooks; forced stamp-conflict deletes the new file and bumps nothing', async () => {
    const a = await createViewbook((await mkClient()).id, 'upgrade', OPERATOR)
    const b = await createViewbook((await mkClient()).id, 'upgrade', OPERATOR)
    await putGlobalContent('team', roster, OPERATOR)

    const beforeA = await syncVersion(a.id)
    const beforeB = await syncVersion(b.id)
    await attachTeamPhoto('Kevin', PNG, OPERATOR)
    expect(await syncVersion(a.id)).toBe(beforeA + 1)
    expect(await syncVersion(b.id)).toBe(beforeB + 1)

    const beforeConflictA = await syncVersion(a.id)
    await expect(
      attachTeamPhoto('Kevin', PNG, OPERATOR, {
        beforeStamp: async () => {
          await putGlobalContent('team', [{ ...roster[0], blurb: 'edited meanwhile' }], OPERATOR)
        },
      }),
    ).rejects.toMatchObject({ code: 'roster_conflict' })
    // The stale-tab attach's own bump rolls back with its updateMany; only the
    // concurrent putGlobalContent's bump (inside beforeStamp) landed.
    expect(await syncVersion(a.id)).toBe(beforeConflictA + 1)
  })

  it('putContentOverride bumps ONLY its own viewbook', async () => {
    const own = await createViewbook((await mkClient()).id, 'upgrade', OPERATOR)
    const other = await createViewbook((await mkClient()).id, 'upgrade', OPERATOR)
    const beforeOwn = await syncVersion(own.id)
    const beforeOther = await syncVersion(other.id)
    await putContentOverride(own.id, 'seo-base', 'Your plan: local landing pages.', OPERATOR)
    expect(await syncVersion(own.id)).toBe(beforeOwn + 1)
    expect(await syncVersion(other.id)).toBe(beforeOther)
  })

  it('deleteContentOverride on a missing row 404s and bumps nothing', async () => {
    const vb = await createViewbook((await mkClient()).id, 'upgrade', OPERATOR)
    const before = await syncVersion(vb.id)
    await expect(deleteContentOverride(vb.id, 'seo-base')).rejects.toMatchObject({ code: 'not_found' })
    expect(await syncVersion(vb.id)).toBe(before)

    await putContentOverride(vb.id, 'seo-base', 'Your plan v2.', OPERATOR)
    const beforeDelete = await syncVersion(vb.id)
    await deleteContentOverride(vb.id, 'seo-base')
    expect(await syncVersion(vb.id)).toBe(beforeDelete + 1)
  })
})

describe('content overrides', () => {
  it('upserts bounded per-viewbook overrides; rejects unknown keys and oversize', async () => {
    const c = await prisma.client.create({ data: { name: `vb-test-${crypto.randomUUID()}` } })
    const { id } = await createViewbook(c.id, 'upgrade', OPERATOR)
    await putContentOverride(id, 'seo-base', 'Your plan: local landing pages.', OPERATOR)
    await putContentOverride(id, 'seo-base', 'Your plan v2.', OPERATOR)
    const rows = await prisma.viewbookContentOverride.findMany({ where: { viewbookId: id } })
    expect(rows).toHaveLength(1)
    expect(rows[0].body).toBe('Your plan v2.')
    await expect(putContentOverride(id, 'nope', 'x', OPERATOR)).rejects.toMatchObject({ code: 'invalid_content' })
    await expect(putContentOverride(id, 'seo-base', 'a'.repeat(4097), OPERATOR)).rejects.toMatchObject({ code: 'invalid_content' })
  })
})
