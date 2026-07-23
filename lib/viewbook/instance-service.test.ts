// F2 (Task 4): instance content mutations + single-bump aggregate fence.
// Spec §4/§9: every content/copy/title mutation of a section OR its
// subsections (and every structural field op) bumps the SECTION's aggregate
// `version` EXACTLY once in the same array txn; answer-value writes never
// bump it. Every instance mutation ALSO bumps the viewbook's syncVersion.
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { createViewbook } from './service'
import { ensureSeededTemplates } from './__fixtures__/instance-test-helpers'
import { patchSectionInstance, patchSubsectionInstance, bumpSectionAggregateGuarded } from './instance-service'

const OPERATOR = 'kevin@enrollmentresources.com'

beforeAll(async () => {
  await ensureSeededTemplates()
})

afterEach(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: 'vb-t4-' } } })
})

async function mkViewbook() {
  const client = await prisma.client.create({ data: { name: `vb-t4-${crypto.randomUUID()}` } })
  return createViewbook(client.id, 'upgrade', OPERATOR)
}

async function getSection(viewbookId: number, sectionKey: string) {
  return prisma.viewbookSection.findUniqueOrThrow({ where: { viewbookId_sectionKey: { viewbookId, sectionKey } } })
}

async function getSubsection(viewbookId: number, sectionKey: string, subsectionKey: string) {
  const section = await getSection(viewbookId, sectionKey)
  return prisma.viewbookSubsection.findUniqueOrThrow({
    where: { sectionId_subsectionKey: { sectionId: section.id, subsectionKey } },
  })
}

async function syncVersion(viewbookId: number): Promise<number> {
  return (await prisma.viewbook.findUniqueOrThrow({ where: { id: viewbookId } })).syncVersion
}

describe('patchSectionInstance', () => {
  it('copy patch updates copyJson, bumps section.version by EXACTLY 1, and bumps syncVersion', async () => {
    const { id } = await mkViewbook()
    const before = await getSection(id, 'brand')
    const beforeSync = await syncVersion(id)

    await patchSectionInstance(
      id,
      'brand',
      { version: before.version, copy: { purpose: 'New purpose', whatThis: 'New what', whatWeNeed: null } },
      OPERATOR,
    )

    const after = await getSection(id, 'brand')
    expect(after.version).toBe(before.version + 1)
    expect(JSON.parse(after.copyJson).copy.purpose).toBe('New purpose')
    expect(await syncVersion(id)).toBe(beforeSync + 1)
  })

  it('title patch updates title, bumps version once, and bumps syncVersion (instance edits always bump sync)', async () => {
    const { id } = await mkViewbook()
    const before = await getSection(id, 'brand')
    const beforeSync = await syncVersion(id)

    await patchSectionInstance(id, 'brand', { version: before.version, title: 'New Brand Title' }, OPERATOR)

    const after = await getSection(id, 'brand')
    expect(after.title).toBe('New Brand Title')
    expect(after.version).toBe(before.version + 1)
    expect(await syncVersion(id)).toBe(beforeSync + 1)
  })

  it('stale version → 409 version_conflict, rollback pin (nothing changed)', async () => {
    const { id } = await mkViewbook()
    const before = await getSection(id, 'brand')
    const beforeSync = await syncVersion(id)

    await expect(
      patchSectionInstance(id, 'brand', { version: before.version - 1 || 999, title: 'Should not land' }, OPERATOR),
    ).rejects.toMatchObject({ status: 409, code: 'version_conflict' })

    const after = await getSection(id, 'brand')
    expect(after.version).toBe(before.version)
    expect(after.title).toBe(before.title)
    expect(await syncVersion(id)).toBe(beforeSync)
  })

  it('unknown sectionKey → 404 not_found', async () => {
    const { id } = await mkViewbook()
    await expect(
      patchSectionInstance(id, 'nonexistent-section', { version: 1, title: 'x' }, OPERATOR),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' })
  })

  it('invalid copy shape → 400 invalid_content, no bump', async () => {
    const { id } = await mkViewbook()
    const before = await getSection(id, 'brand')
    const beforeSync = await syncVersion(id)

    await expect(
      patchSectionInstance(id, 'brand', { version: before.version, copy: { purpose: '' } }, OPERATOR),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_content' })

    expect((await getSection(id, 'brand')).version).toBe(before.version)
    expect(await syncVersion(id)).toBe(beforeSync)
  })

  it('neither title nor copy present → 400 invalid_content', async () => {
    const { id } = await mkViewbook()
    await expect(patchSectionInstance(id, 'brand', { version: 1 }, OPERATOR)).rejects.toMatchObject({
      status: 400,
      code: 'invalid_content',
    })
  })
})

describe('patchSubsectionInstance', () => {
  it('content patch on the welcome/main subsection bumps subsection.version AND the owning section.version EXACTLY once each, in one txn', async () => {
    const { id } = await mkViewbook()
    const beforeSection = await getSection(id, 'welcome')
    const beforeSub = await getSubsection(id, 'welcome', 'main')
    const beforeSync = await syncVersion(id)

    await patchSubsectionInstance(
      id,
      beforeSub.id,
      {
        version: beforeSub.version,
        content: {
          team: [],
          process: { blocks: [{ heading: 'H', body: 'B' }] },
          why: { blocks: [{ heading: 'H2', body: 'B2' }] },
        },
      },
      OPERATOR,
    )

    const afterSection = await getSection(id, 'welcome')
    const afterSub = await getSubsection(id, 'welcome', 'main')
    expect(afterSub.version).toBe(beforeSub.version + 1)
    expect(afterSection.version).toBe(beforeSection.version + 1)
    expect(JSON.parse(afterSub.contentJson!).process.blocks[0].heading).toBe('H')
    expect(await syncVersion(id)).toBe(beforeSync + 1)
  })

  it('copy patch updates copyJson and bumps both versions exactly once', async () => {
    const { id } = await mkViewbook()
    const beforeSection = await getSection(id, 'brand')
    const beforeSub = await getSubsection(id, 'brand', 'main')

    await patchSubsectionInstance(
      id,
      beforeSub.id,
      { version: beforeSub.version, copy: { intro: 'Intro text', whatWeNeed: null } },
      OPERATOR,
    )

    const afterSub = await getSubsection(id, 'brand', 'main')
    const afterSection = await getSection(id, 'brand')
    expect(JSON.parse(afterSub.copyJson!).copy.intro).toBe('Intro text')
    expect(afterSub.version).toBe(beforeSub.version + 1)
    expect(afterSection.version).toBe(beforeSection.version + 1)
  })

  // Fix round 1 (Codex review, Finding 2): persist the VALIDATED/normalized
  // envelope, not the raw request body.
  it('copy patch persists the NORMALIZED envelope: a whitespace-only field blanks to null (not the raw whitespace string)', async () => {
    const { id } = await mkViewbook()
    const beforeSub = await getSubsection(id, 'brand', 'main')

    await patchSubsectionInstance(
      id,
      beforeSub.id,
      { version: beforeSub.version, copy: { intro: '   ', whatWeNeed: 'Real text' } },
      OPERATOR,
    )

    const afterSub = await getSubsection(id, 'brand', 'main')
    const copy = JSON.parse(afterSub.copyJson!).copy
    expect(copy.intro).toBeNull()
    expect(copy.whatWeNeed).toBe('Real text')
  })

  it('content patch on the welcome/main subsection persists the CANONICAL email (trimmed + lowercased), not the raw mixed-case/whitespace input', async () => {
    const { id } = await mkViewbook()
    const beforeSub = await getSubsection(id, 'welcome', 'main')

    await patchSubsectionInstance(
      id,
      beforeSub.id,
      {
        version: beforeSub.version,
        content: {
          team: [{ name: 'Jo', role: 'CSM', photo: null, blurb: '', email: '  Jo.Smith@Example.COM  ' }],
          process: { blocks: [] },
          why: { blocks: [] },
        },
      },
      OPERATOR,
    )

    const afterSub = await getSubsection(id, 'welcome', 'main')
    const team = JSON.parse(afterSub.contentJson!).team
    expect(team[0].email).toBe('jo.smith@example.com')
  })

  it('title patch bumps both versions exactly once', async () => {
    const { id } = await mkViewbook()
    const beforeSection = await getSection(id, 'brand')
    const beforeSub = await getSubsection(id, 'brand', 'main')

    await patchSubsectionInstance(id, beforeSub.id, { version: beforeSub.version, title: 'New sub title' }, OPERATOR)

    const afterSub = await getSubsection(id, 'brand', 'main')
    const afterSection = await getSection(id, 'brand')
    expect(afterSub.title).toBe('New sub title')
    expect(afterSub.version).toBe(beforeSub.version + 1)
    expect(afterSection.version).toBe(beforeSection.version + 1)
  })

  it('stale subsection version → 409 version_conflict; neither subsection nor section changes', async () => {
    const { id } = await mkViewbook()
    const beforeSection = await getSection(id, 'brand')
    const beforeSub = await getSubsection(id, 'brand', 'main')
    const beforeSync = await syncVersion(id)

    await expect(
      patchSubsectionInstance(id, beforeSub.id, { version: beforeSub.version + 1, title: 'Nope' }, OPERATOR),
    ).rejects.toMatchObject({ status: 409, code: 'version_conflict' })

    expect((await getSubsection(id, 'brand', 'main')).version).toBe(beforeSub.version)
    expect((await getSection(id, 'brand')).version).toBe(beforeSection.version)
    expect(await syncVersion(id)).toBe(beforeSync)
  })

  it('invalid content shape (wrong rendererType keys) → 400 invalid_content, no bump', async () => {
    const { id } = await mkViewbook()
    const beforeSection = await getSection(id, 'welcome')
    const beforeSub = await getSubsection(id, 'welcome', 'main')

    await expect(
      patchSubsectionInstance(id, beforeSub.id, { version: beforeSub.version, content: { bogus: true } }, OPERATOR),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_content' })

    expect((await getSubsection(id, 'welcome', 'main')).version).toBe(beforeSub.version)
    expect((await getSection(id, 'welcome')).version).toBe(beforeSection.version)
  })

  it('content on a data-source category subsection (rendererType has no content shape) is always rejected', async () => {
    const { id } = await mkViewbook()
    const beforeSub = await getSubsection(id, 'data-source', 'school')

    await expect(
      patchSubsectionInstance(id, beforeSub.id, { version: beforeSub.version, content: { blocks: [] } }, OPERATOR),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_content' })
  })

  it('cross-viewbook subId → 404 not_found (composite viewbookId scoping)', async () => {
    const a = await mkViewbook()
    const b = await mkViewbook()
    const bSub = await getSubsection(b.id, 'brand', 'main')

    await expect(
      patchSubsectionInstance(a.id, bSub.id, { version: bSub.version, title: 'Hijack' }, OPERATOR),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' })
  })

  it('unknown subId → 404 not_found', async () => {
    const { id } = await mkViewbook()
    await expect(
      patchSubsectionInstance(id, 999999999, { version: 1, title: 'x' }, OPERATOR),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' })
  })

  it('neither title, copy, nor content present → 400 invalid_content', async () => {
    const { id } = await mkViewbook()
    const sub = await getSubsection(id, 'brand', 'main')
    await expect(patchSubsectionInstance(id, sub.id, { version: sub.version }, OPERATOR)).rejects.toMatchObject({
      status: 400,
      code: 'invalid_content',
    })
  })
})

describe('bumpSectionAggregateGuarded', () => {
  it('throws (never a silent zero-row no-op) when the sectionId/viewbookId pair does not match', async () => {
    const a = await mkViewbook()
    const b = await mkViewbook()
    const aSection = await getSection(a.id, 'brand')

    await expect(prisma.$transaction([bumpSectionAggregateGuarded(aSection.id, b.id)])).rejects.toThrow()
  })

  it('bumps by exactly 1 when scoped correctly', async () => {
    const { id } = await mkViewbook()
    const before = await getSection(id, 'brand')
    await prisma.$transaction([bumpSectionAggregateGuarded(before.id, id)])
    const after = await getSection(id, 'brand')
    expect(after.version).toBe(before.version + 1)
  })
})
