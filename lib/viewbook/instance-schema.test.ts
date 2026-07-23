// F2 instance-schema integrity tests (Task 3, spec §4). Proves the composite
// tenant-integrity FKs (Codex fix #1/#3) make cross-viewbook rows
// unrepresentable, and that ONE nested prisma.viewbook.create populates the
// shared composite scalars (viewbookId) on every level — the copy-on-create
// path in service.ts depends on that runtime behavior (the generated 5.22
// input TYPES demand a redundant `viewbook` relation on nested composite
// creates; runtime accepts and populates, hence the casts here and in
// service.ts).
import crypto from 'crypto'
import { describe, it, expect, afterAll } from 'vitest'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { mkSectionInput, mkSubsectionInput, mkFieldInput } from './__fixtures__/instance-test-helpers'

const CLIENT_PREFIX = 'vb-inst-schema-'

async function mkViewbookWithSection(sectionKey = 'welcome') {
  const client = await prisma.client.create({ data: { name: `${CLIENT_PREFIX}${crypto.randomUUID()}` } })
  const vb = await prisma.viewbook.create({
    data: {
      clientId: client.id,
      kind: 'upgrade',
      token: crypto.randomUUID(),
      sections: { create: [mkSectionInput(sectionKey)] },
    },
    include: { sections: true },
  })
  return { client, vb, section: vb.sections[0] }
}

function isP2003(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003'
}

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: CLIENT_PREFIX } } })
})

describe('F2 instance schema — composite tenant integrity', () => {
  it('rejects a SUBSECTION pointing at another viewbook\'s section (composite FK)', async () => {
    const a = await mkViewbookWithSection()
    const b = await mkViewbookWithSection()
    // Cross-pair: viewbook B + section A — the (sectionId, viewbookId)
    // composite FK has no matching (id, viewbookId) target.
    await expect(
      prisma.viewbookSubsection.create({
        data: {
          viewbookId: b.vb.id,
          sectionId: a.section.id,
          subsectionKey: 'main',
          title: 'Cross-tenant',
          sortOrder: 10,
        },
      }),
    ).rejects.toSatisfy(isP2003)
  })

  it('rejects a FIELD pointing at another viewbook\'s subsection (composite FK)', async () => {
    const a = await mkViewbookWithSection()
    const b = await mkViewbookWithSection()
    const subA = await prisma.viewbookSubsection.create({
      data: {
        viewbookId: a.vb.id,
        sectionId: a.section.id,
        subsectionKey: 'main',
        title: 'Main',
        sortOrder: 10,
      },
    })
    await expect(
      prisma.viewbookField.create({
        data: mkFieldInput('cross-tenant-field', {
          viewbookId: b.vb.id,
          subsectionId: subA.id,
        }) as never,
      }),
    ).rejects.toSatisfy(isP2003)
  })

  it('creates one complete nested instance tree through Viewbook → sections → subsections → fields', async () => {
    const client = await prisma.client.create({ data: { name: `${CLIENT_PREFIX}${crypto.randomUUID()}` } })
    const uniq = crypto.randomUUID().slice(0, 8)
    const vb = await prisma.viewbook.create({
      data: {
        clientId: client.id,
        kind: 'new-build',
        token: crypto.randomUUID(),
        sections: {
          create: [
            mkSectionInput('welcome', {
              subsections: {
                create: [
                  mkSubsectionInput('main', {
                    fields: {
                      create: [
                        mkFieldInput(`nested-a-${uniq}`, { category: 'main', sortOrder: 1 }),
                        mkFieldInput(`nested-b-${uniq}`, { category: 'main', sortOrder: 2 }),
                      ],
                    },
                  }),
                  mkSubsectionInput('extra'),
                ],
              },
            } as never),
            mkSectionInput('strategy', {
              subsections: { create: [mkSubsectionInput('main')] },
            } as never),
          ],
        },
      },
      include: { sections: { include: { subsections: { include: { fields: true } } } } },
    })

    expect(vb.sections).toHaveLength(2)
    const allSubs = vb.sections.flatMap((s) => s.subsections)
    const allFields = allSubs.flatMap((s) => s.fields)
    expect(allSubs).toHaveLength(3)
    expect(allFields).toHaveLength(2)
    // Prisma populated the shared composite scalar on EVERY row.
    for (const s of vb.sections) expect(s.viewbookId).toBe(vb.id)
    for (const sub of allSubs) {
      expect(sub.viewbookId).toBe(vb.id)
      expect(vb.sections.map((s) => s.id)).toContain(sub.sectionId)
    }
    for (const f of allFields) {
      expect(f.viewbookId).toBe(vb.id)
      expect(allSubs.map((s) => s.id)).toContain(f.subsectionId)
    }
  })
})
