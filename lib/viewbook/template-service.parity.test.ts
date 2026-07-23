// F1b Task 10: bridge-parity acceptance suite (spec §6's deferred acceptance
// item). These are ACCEPTANCE tests over Tasks 3-7's dual-write bridge
// (template-service.ts + template-content.ts + section-copy-validator.ts +
// section-copy-content.ts + global-content.ts + template-seed.ts): they
// assert that a template write and a legacy write of the SAME data always
// agree, byte-for-byte, on both sides — a failure here is a Task 3-7 bug, not
// a reason to weaken this test. Follows template-service.test.ts's DB-backed
// conventions (fresh-seed beforeEach, cleanTemplates including the reconcile
// marker key, the sharp PNG fixture idiom for the photo test).
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import sharp from 'sharp'
import { prisma } from '@/lib/db'
import { seedViewbookTemplates } from './template-seed'
import { GLOBAL_CONTENT_KEYS, type GlobalContentKey, type TeamMember, type ContentBlocks } from './global-content-keys'
import { getGlobalContent } from './global-content'
import { SECTION_KEYS, type SectionKey } from './theme'
import { sectionCopyKey, resolveSectionCopy } from './section-copy-content'
import { validateSectionCopy, type SectionCopyContent } from './section-copy-validator'
import {
  parseTemplateCopy,
  parseSubsectionContent,
  toLegacySectionCopy,
  toLegacyGlobalBody,
} from './template-content'
import {
  getTemplateTree,
  patchSectionTemplate,
  patchSubsection,
  attachTemplateTeamPhoto,
  putGlobalContentBridged,
  putSectionCopyGlobalBridged,
  deleteSectionCopyGlobalBridged,
  reconcileSeededTemplates,
  RECONCILE_MARKER_KEY,
  BRIDGED_CONTENT,
} from './template-service'

const SEED_KEYS = [...GLOBAL_CONTENT_KEYS, ...SECTION_KEYS.map(sectionCopyKey)]

async function cleanTemplates() {
  await prisma.fieldTemplate.deleteMany({})
  await prisma.subsectionTemplate.deleteMany({})
  await prisma.sectionTemplate.deleteMany({})
  await prisma.viewbookGlobalContent.deleteMany({ where: { key: { in: [...SEED_KEYS, RECONCILE_MARKER_KEY] } } })
}

beforeEach(async () => {
  await cleanTemplates()
  await seedViewbookTemplates()
})
afterAll(cleanTemplates)

describe('bridge-parity acceptance (spec §6 deferred item)', () => {
  // ---- Area 1: template→legacy section copy, ALL 13 keys -------------------
  describe('area 1: template→legacy section copy, all 13 keys', () => {
    it('every seeded section: a template copy edit round-trips to the legacy row AND resolveSectionCopy', async () => {
      const { sections } = await getTemplateTree()
      for (const key of SECTION_KEYS) {
        const s = sections.find((x) => x.templateKey === key)!
        const copy: SectionCopyContent = {
          purpose: `Purpose for ${key}`,
          whatThis: `What this is for ${key}`,
          whatWeNeed: key.length % 2 === 0 ? `Need for ${key}` : null,
        }
        await patchSectionTemplate(s.id, { version: s.version, copy }, 'op@er.com')

        const legacyRow = await prisma.viewbookGlobalContent.findUnique({ where: { key: sectionCopyKey(key) } })
        const legacyValidated = validateSectionCopy(JSON.parse(legacyRow!.bodyJson))
        expect(legacyValidated).toEqual(copy)

        const templateRow = await prisma.sectionTemplate.findUnique({ where: { id: s.id } })
        const fromTemplate = toLegacySectionCopy(parseTemplateCopy(templateRow!.copyJson)!)
        expect(fromTemplate).toEqual(copy)

        // The render path (resolveSectionCopy) sees exactly the template edit.
        expect(resolveSectionCopy(key, legacyValidated, null)).toEqual(copy)
      }
    })
  })

  // ---- Area 2: template→legacy, ALL FOUR bridged content pairs --------------
  describe('area 2: template→legacy, all four bridged content pairs', () => {
    async function assertBridgeParts(templateKey: keyof typeof BRIDGED_CONTENT, subId: number, rendererType: string) {
      const after = await prisma.subsectionTemplate.findUnique({ where: { id: subId } })
      const parsed = parseSubsectionContent(rendererType, after!.contentJson)!
      for (const legacyKey of Object.values(BRIDGED_CONTENT[templateKey].parts)) {
        const legacyRow = await prisma.viewbookGlobalContent.findUnique({ where: { key: legacyKey } })
        const legacyDecoded = JSON.parse(legacyRow!.bodyJson)
        expect(legacyDecoded).toEqual(toLegacyGlobalBody(legacyKey, parsed))
        expect(await getGlobalContent(legacyKey)).toEqual(legacyDecoded)
      }
    }

    it('welcome: team/process/why all round-trip (photo re-derived from the seeded legacy roster)', async () => {
      await prisma.viewbookGlobalContent.create({
        data: {
          key: 'team',
          bodyJson: JSON.stringify([{ name: 'Distinct Person', role: 'R', photo: 'seed.webp', blurb: '' }]),
          updatedBy: 'x',
        },
      })
      const { sections } = await getTemplateTree()
      const s = sections.find((x) => x.templateKey === 'welcome')!
      const sub = s.subsections[0]
      await patchSubsection(
        sub.id,
        {
          version: s.version,
          content: {
            team: [{ name: 'Distinct Person', role: 'R2', photo: 'ignored-by-rederivation.webp', blurb: 'b' }],
            process: { blocks: [{ heading: 'Process H', body: 'Process B' }] },
            why: { blocks: [{ heading: 'Why H', body: 'Why B' }] },
          },
        },
        'op@er.com',
      )
      await assertBridgeParts('welcome', sub.id, 'welcome')
      // Photo parity within this same bridge write: re-derived, not the incoming value.
      const teamLegacy = (await getGlobalContent('team')) as TeamMember[]
      expect(teamLegacy[0].photo).toBe('seed.webp')
    })

    it('strategy: seoBase/geoBase/eeatBase all round-trip', async () => {
      const { sections } = await getTemplateTree()
      const s = sections.find((x) => x.templateKey === 'strategy')!
      const sub = s.subsections[0]
      await patchSubsection(
        sub.id,
        {
          version: s.version,
          content: {
            seoBase: { blocks: [{ heading: 'SEO H', body: 'SEO B' }] },
            geoBase: { blocks: [{ heading: 'GEO H', body: 'GEO B' }] },
            eeatBase: { blocks: [{ heading: 'EEAT H', body: 'EEAT B' }] },
          },
        },
        'op@er.com',
      )
      await assertBridgeParts('strategy', sub.id, 'strategy')
    })

    it('milestones: processMilestones round-trips', async () => {
      const { sections } = await getTemplateTree()
      const s = sections.find((x) => x.templateKey === 'milestones')!
      const sub = s.subsections[0]
      await patchSubsection(
        sub.id,
        { version: s.version, content: { processMilestones: { blocks: [{ heading: 'Milestone H', body: 'Milestone B' }] } } },
        'op@er.com',
      )
      await assertBridgeParts('milestones', sub.id, 'milestones')
    })

    it('pc-intro: intro round-trips', async () => {
      const { sections } = await getTemplateTree()
      const s = sections.find((x) => x.templateKey === 'pc-intro')!
      const sub = s.subsections[0]
      await patchSubsection(
        sub.id,
        { version: s.version, content: { intro: 'A distinct welcome message for parity testing.' } },
        'op@er.com',
      )
      await assertBridgeParts('pc-intro', sub.id, 'pc-intro')
    })
  })

  // ---- Area 3: legacy→template, ALL 8 global keys + section-copy put/delete
  describe('area 3: legacy→template, all 8 global keys + section-copy put/delete', () => {
    it('putGlobalContentBridged for every legacy key forward-writes the matching template part', async () => {
      const values: Record<GlobalContentKey, unknown> = {
        team: [{ name: 'Legacy Person', role: 'Role', photo: null, blurb: 'b' }],
        process: { blocks: [{ heading: 'Process', body: 'B' }] },
        why: { blocks: [{ heading: 'Why', body: 'B' }] },
        'seo-base': { blocks: [{ heading: 'SEO', body: 'B' }] },
        'geo-base': { blocks: [{ heading: 'GEO', body: 'B' }] },
        'eeat-base': { blocks: [{ heading: 'EEAT', body: 'B' }] },
        'process-milestones': { blocks: [{ heading: 'Milestone', body: 'B' }] },
        'pc-intro': 'A distinct legacy pc-intro string.',
      }
      const partByLegacyKey: Record<GlobalContentKey, { templateKey: SectionKey; part: string }> = {
        team: { templateKey: 'welcome', part: 'team' },
        process: { templateKey: 'welcome', part: 'process' },
        why: { templateKey: 'welcome', part: 'why' },
        'seo-base': { templateKey: 'strategy', part: 'seoBase' },
        'geo-base': { templateKey: 'strategy', part: 'geoBase' },
        'eeat-base': { templateKey: 'strategy', part: 'eeatBase' },
        'process-milestones': { templateKey: 'milestones', part: 'processMilestones' },
        'pc-intro': { templateKey: 'pc-intro', part: 'intro' },
      }

      for (const key of GLOBAL_CONTENT_KEYS) {
        await putGlobalContentBridged(key, values[key], 'op@er.com')
      }

      const { sections } = await getTemplateTree()
      for (const key of GLOBAL_CONTENT_KEYS) {
        const legacyDecoded = await getGlobalContent(key)
        const { templateKey, part } = partByLegacyKey[key]
        const section = sections.find((x) => x.templateKey === templateKey)!
        const templatePart = (section.subsections[0].content as Record<string, unknown>)[part]
        expect(templatePart).toEqual(legacyDecoded)
      }
    })

    it('putSectionCopyGlobalBridged/deleteSectionCopyGlobalBridged keep the template copy in sync (delete lands the code default)', async () => {
      const copy: SectionCopyContent = { purpose: 'Legacy purpose', whatThis: 'Legacy what', whatWeNeed: 'Legacy need' }
      await putSectionCopyGlobalBridged('assessment', copy, 'op@er.com')
      let { sections } = await getTemplateTree()
      expect(sections.find((x) => x.templateKey === 'assessment')!.copy).toEqual(copy)

      await deleteSectionCopyGlobalBridged('assessment')
      ;({ sections } = await getTemplateTree())
      expect(sections.find((x) => x.templateKey === 'assessment')!.copy).toEqual(resolveSectionCopy('assessment', null, null))
    })
  })

  // ---- Area 4: photo parity --------------------------------------------------
  describe('area 4: photo parity', () => {
    let PNG: Buffer
    let assetsDir: string
    beforeAll(async () => {
      PNG = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 9, g: 9, b: 9 } } })
        .png()
        .toBuffer()
    })
    beforeEach(async () => {
      assetsDir = await mkdtemp(path.join(tmpdir(), 'vb-tpl-parity-'))
      process.env.VIEWBOOK_ASSETS_DIR = assetsDir
      await prisma.viewbookGlobalContent.create({
        data: { key: 'team', bodyJson: JSON.stringify([{ name: 'Parity Person', role: 'R', photo: null, blurb: '' }]), updatedBy: 'x' },
      })
    })
    afterEach(async () => {
      delete process.env.VIEWBOOK_ASSETS_DIR
      await rm(assetsDir, { recursive: true, force: true })
      await prisma.viewbookGlobalContent.deleteMany({ where: { key: 'team' } })
    })

    it('attachTemplateTeamPhoto: legacy roster photo === template envelope photo === returned filename', async () => {
      const { sections } = await getTemplateTree()
      const s = sections.find((x) => x.templateKey === 'welcome')!
      const filename = await attachTemplateTeamPhoto(s.id, 'Parity Person', PNG, 'op@er.com', s.version)

      const legacyRow = await prisma.viewbookGlobalContent.findUnique({ where: { key: 'team' } })
      const legacyPhoto = (JSON.parse(legacyRow!.bodyJson) as TeamMember[])[0].photo

      const after = await getTemplateTree()
      const templatePhoto = (
        after.sections.find((x) => x.templateKey === 'welcome')!.subsections[0].content as { team: TeamMember[] }
      ).team[0].photo

      expect(legacyPhoto).toBe(filename)
      expect(templatePhoto).toBe(filename)
    })
  })

  // ---- Area 5: round-trip stability ------------------------------------------
  describe('area 5: round-trip stability (template write, then legacy write, same key)', () => {
    it('section copy: template write then legacy write agree; legacy bodyJson carries no v key', async () => {
      const { sections } = await getTemplateTree()
      const s = sections.find((x) => x.templateKey === 'brand')!
      await patchSectionTemplate(s.id, { version: s.version, copy: { purpose: 'Tpl', whatThis: 'Tpl2', whatWeNeed: null } }, 'op@er.com')

      const legacyCopy: SectionCopyContent = { purpose: 'Legacy2', whatThis: 'Legacy3', whatWeNeed: 'Legacy4' }
      await putSectionCopyGlobalBridged('brand', legacyCopy, 'op@er.com')

      const legacyRow = await prisma.viewbookGlobalContent.findUnique({ where: { key: sectionCopyKey('brand') } })
      const rawParsed = JSON.parse(legacyRow!.bodyJson)
      expect(Object.prototype.hasOwnProperty.call(rawParsed, 'v')).toBe(false)
      expect(validateSectionCopy(rawParsed)).toEqual(legacyCopy)

      const templateRow = await prisma.sectionTemplate.findUnique({ where: { templateKey: 'brand' } })
      expect(toLegacySectionCopy(parseTemplateCopy(templateRow!.copyJson)!)).toEqual(legacyCopy)
    })

    it('global content: template write then legacy write agree; legacy bodyJson carries no v key', async () => {
      const { sections } = await getTemplateTree()
      const s = sections.find((x) => x.templateKey === 'strategy')!
      const sub = s.subsections[0]
      await patchSubsection(
        sub.id,
        {
          version: s.version,
          content: {
            seoBase: { blocks: [{ heading: 'Tpl SEO', body: 'b' }] },
            geoBase: { blocks: [] },
            eeatBase: { blocks: [] },
          },
        },
        'op@er.com',
      )

      await putGlobalContentBridged('seo-base', { blocks: [{ heading: 'Legacy SEO', body: 'b2' }] }, 'op@er.com')

      const legacyRow = await prisma.viewbookGlobalContent.findUnique({ where: { key: 'seo-base' } })
      const rawParsed = JSON.parse(legacyRow!.bodyJson)
      expect(Object.prototype.hasOwnProperty.call(rawParsed, 'v')).toBe(false)
      expect(rawParsed).toEqual({ blocks: [{ heading: 'Legacy SEO', body: 'b2' }] })

      const after = await getTemplateTree()
      const content = after.sections.find((x) => x.templateKey === 'strategy')!.subsections[0].content as { seoBase: ContentBlocks }
      expect(content.seoBase).toEqual(rawParsed)
    })
  })

  // ---- Area 6: reconcile acceptance ------------------------------------------
  describe('area 6: reconcile acceptance (Task 7 behaviors restated)', () => {
    it('a window-edit is absorbed exactly once (marker-guarded)', async () => {
      await prisma.viewbookGlobalContent.create({
        data: { key: 'why', bodyJson: JSON.stringify({ blocks: [{ heading: 'Window Why', body: 'b' }] }), updatedBy: 'x' },
      })
      await reconcileSeededTemplates()
      const { sections } = await getTemplateTree()
      const w = sections.find((x) => x.templateKey === 'welcome')!
      expect((w.subsections[0].content as { why: ContentBlocks }).why.blocks[0].heading).toBe('Window Why')
      expect(await prisma.viewbookGlobalContent.findUnique({ where: { key: RECONCILE_MARKER_KEY } })).not.toBeNull()

      // A SECOND window edit + a second call must NOT be absorbed (marker already set).
      await prisma.viewbookGlobalContent.update({
        where: { key: 'why' },
        data: { bodyJson: JSON.stringify({ blocks: [{ heading: 'Second window edit', body: 'b' }] }) },
      })
      await reconcileSeededTemplates()
      const after = await getTemplateTree()
      expect(
        (after.sections.find((x) => x.templateKey === 'welcome')!.subsections[0].content as { why: ContentBlocks }).why
          .blocks[0].heading,
      ).toBe('Window Why')
    })

    it('a tree with any version > 1 anywhere in the subtree is skipped', async () => {
      await prisma.viewbookGlobalContent.create({
        data: { key: 'why', bodyJson: JSON.stringify({ blocks: [{ heading: 'Window Why', body: 'b' }] }), updatedBy: 'x' },
      })
      const { sections } = await getTemplateTree()
      const w = sections.find((x) => x.templateKey === 'welcome')!
      await prisma.sectionTemplate.update({ where: { id: w.id }, data: { version: 2 } }) // simulated operator edit
      await reconcileSeededTemplates()
      const after = await getTemplateTree()
      expect(
        (after.sections.find((x) => x.templateKey === 'welcome')!.subsections[0].content as { why: ContentBlocks }).why
          .blocks,
      ).toEqual([])
    })
  })
})
