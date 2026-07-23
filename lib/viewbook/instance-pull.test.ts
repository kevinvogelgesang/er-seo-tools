// F2 (Task 5): pull — versioned per-section template merge (spec §6).
//
// The merge contract under test, condensed:
// - Section scalars ← template; templateVersion ← current; version fenced on
//   the request's expectedVersion (the AGGREGATE fence) and bumped by the ONE
//   guarded section update. state/introNote/narrative/ack/doneAt untouched.
// - Subsections diffed by subsectionKey vs the template's ACTIVE subsections
//   filtered to the viewbook's offerings: both sides → overwrite + restore;
//   template-only → snapshot-create WITH fields; instance-only → archive
//   'pull' (never delete); ZERO after filter → archive everything incl. the
//   section (not an error).
// - Fields matched by defKey viewbook-GLOBALLY: existing → relabel/reorder/
//   re-parent, restore unless archiveReason 'operator'; value/version/
//   amendments NEVER touched; missing → create (createdBy 'pull', value
//   NULL); this-section defKeys gone from the template → archive 'pull' with
//   the ownership predicate. Custom fields (defKey null) untouched.
// - Assets: template roster photos pre-copied into viewbook scope; replaced
//   instance files deleted post-commit ONLY when absent from the whole-
//   viewbook reference union; txn loss deletes the NEW files.
//
// Tests mutate ONLY their own `t5-`-prefixed template sections (created per
// test, deleted in afterEach) so the shared per-worker DB's seeded 13-tree —
// which other suites pin — is never perturbed.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import sharp from 'sharp'
import { prisma } from '@/lib/db'
import { createViewbook } from './service'
import { ensureSeededTemplates } from './__fixtures__/instance-test-helpers'
import { readViewbookAsset, saveViewbookAsset } from './assets'
import { pullSectionFromTemplate } from './instance-service'

const OPERATOR = 'kevin@enrollmentresources.com'

let realPng: Buffer

beforeAll(async () => {
  await ensureSeededTemplates()
  realPng = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 9, g: 9, b: 9 } } })
    .png()
    .toBuffer()
})

let assetsDir: string
beforeEach(async () => {
  assetsDir = await mkdtemp(path.join(tmpdir(), 'vb-pull-'))
  process.env.VIEWBOOK_ASSETS_DIR = assetsDir
})

afterEach(async () => {
  delete process.env.VIEWBOOK_ASSETS_DIR
  await rm(assetsDir, { recursive: true, force: true })
  await prisma.client.deleteMany({ where: { name: { startsWith: 'vb-t5-' } } })
  // Cascade wipes this test's SubsectionTemplates + FieldTemplates; instance
  // rows are already gone with the clients above (Viewbook cascade).
  await prisma.sectionTemplate.deleteMany({ where: { templateKey: { startsWith: 't5-' } } })
})

// ---- fixtures ---------------------------------------------------------------

interface TplFieldSpec {
  fieldKey: string
  label?: string
  fieldType?: string
  sortOrder?: number
}

interface TplSubSpec {
  key: string
  title?: string
  offeringWebsite?: boolean
  offeringVa?: boolean
  contentJson?: string | null
  copyJson?: string | null
  sortOrder?: number
  fields?: TplFieldSpec[]
}

async function mkTpl(opts: { rendererType?: string; version?: number; subs: TplSubSpec[] }) {
  const templateKey = `t5-${crypto.randomUUID().slice(0, 12)}`
  return prisma.sectionTemplate.create({
    data: {
      templateKey,
      rendererType: opts.rendererType ?? 'generic',
      title: `Tpl ${templateKey}`,
      copyJson: JSON.stringify({ v: 1, copy: { purpose: 'p', whatThis: 'wt', whatWeNeed: null } }),
      sortOrder: 900,
      version: opts.version ?? 1,
      subsections: {
        create: opts.subs.map((s, i) => ({
          subsectionKey: s.key,
          title: s.title ?? `Sub ${s.key}`,
          offeringWebsite: s.offeringWebsite ?? true,
          offeringVa: s.offeringVa ?? false,
          copyJson: s.copyJson ?? null,
          contentJson: s.contentJson ?? null,
          sortOrder: s.sortOrder ?? (i + 1) * 10,
          fields: {
            create: (s.fields ?? []).map((f, j) => ({
              fieldKey: f.fieldKey,
              label: f.label ?? `Label ${f.fieldKey}`,
              fieldType: f.fieldType ?? 'text',
              sortOrder: f.sortOrder ?? (j + 1) * 10,
            })),
          },
        })),
      },
    },
    include: { subsections: { include: { fields: true } } },
  })
}

function fk(): string {
  return `t5-${crypto.randomUUID().slice(0, 12)}`
}

async function mkViewbook() {
  const client = await prisma.client.create({ data: { name: `vb-t5-${crypto.randomUUID()}` } })
  return createViewbook(client.id, 'upgrade', OPERATOR)
}

async function getSection(viewbookId: number, sectionKey: string) {
  return prisma.viewbookSection.findUniqueOrThrow({
    where: { viewbookId_sectionKey: { viewbookId, sectionKey } },
    include: { subsections: { orderBy: { id: 'asc' } } },
  })
}

async function getSub(viewbookId: number, sectionKey: string, subsectionKey: string) {
  const section = await getSection(viewbookId, sectionKey)
  return prisma.viewbookSubsection.findUniqueOrThrow({
    where: { sectionId_subsectionKey: { sectionId: section.id, subsectionKey } },
  })
}

async function getFieldByDefKey(viewbookId: number, defKey: string) {
  return prisma.viewbookField.findUniqueOrThrow({ where: { viewbookId_defKey: { viewbookId, defKey } } })
}

async function syncVersion(viewbookId: number): Promise<number> {
  return (await prisma.viewbook.findUniqueOrThrow({ where: { id: viewbookId } })).syncVersion
}

// ---- preconditions ----------------------------------------------------------

describe('pullSectionFromTemplate — preconditions', () => {
  it('unknown viewbook / unknown sectionKey → 404 not_found', async () => {
    const { id } = await mkViewbook()
    await expect(pullSectionFromTemplate(999999999, 'brand', 1, OPERATOR)).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    })
    await expect(pullSectionFromTemplate(id, 'no-such-section', 1, OPERATOR)).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    })
  })

  it('sectionTemplateId null (SetNull orphan) → 409 template_missing', async () => {
    const tpl = await mkTpl({ subs: [{ key: 'main' }] })
    const { id } = await mkViewbook()
    const section = await getSection(id, tpl.templateKey)
    await prisma.viewbookSection.update({ where: { id: section.id }, data: { sectionTemplateId: null } })

    await expect(pullSectionFromTemplate(id, tpl.templateKey, section.version, OPERATOR)).rejects.toMatchObject({
      status: 409,
      code: 'template_missing',
    })
  })

  it('archived template section → 409 template_archived', async () => {
    const tpl = await mkTpl({ subs: [{ key: 'main' }] })
    const { id } = await mkViewbook()
    const section = await getSection(id, tpl.templateKey)
    await prisma.sectionTemplate.update({ where: { id: tpl.id }, data: { archivedAt: new Date() } })

    await expect(pullSectionFromTemplate(id, tpl.templateKey, section.version, OPERATOR)).rejects.toMatchObject({
      status: 409,
      code: 'template_archived',
    })
  })

  it('stale expectedVersion → 409 version_conflict and FULL rollback (pending template-only subsection is NOT created)', async () => {
    const tpl = await mkTpl({ subs: [{ key: 'main' }] })
    const { id } = await mkViewbook()
    const section = await getSection(id, tpl.templateKey)
    const beforeSync = await syncVersion(id)
    await prisma.subsectionTemplate.create({
      data: { sectionTemplateId: tpl.id, subsectionKey: 'extra', title: 'Extra', offeringWebsite: true, sortOrder: 20 },
    })

    await expect(pullSectionFromTemplate(id, tpl.templateKey, section.version + 5, OPERATOR)).rejects.toMatchObject({
      status: 409,
      code: 'version_conflict',
    })

    const after = await getSection(id, tpl.templateKey)
    expect(after.version).toBe(section.version)
    expect(after.subsections.map((s) => s.subsectionKey)).toEqual(['main'])
    expect(await syncVersion(id)).toBe(beforeSync)
  })

  it('race: beforeCommit bumps the section aggregate → 409 version_conflict, ZERO changes committed', async () => {
    const tpl = await mkTpl({ subs: [{ key: 'main', fields: [{ fieldKey: fk() }] }] })
    const { id } = await mkViewbook()
    const section = await getSection(id, tpl.templateKey)
    const beforeSync = await syncVersion(id)
    await prisma.subsectionTemplate.create({
      data: { sectionTemplateId: tpl.id, subsectionKey: 'racer', title: 'Racer', offeringWebsite: true, sortOrder: 30 },
    })
    await prisma.sectionTemplate.update({ where: { id: tpl.id }, data: { title: 'Raced Title' } })

    await expect(
      pullSectionFromTemplate(id, tpl.templateKey, section.version, OPERATOR, {
        beforeCommit: async () => {
          // A concurrent subsection edit lands between statement-build and
          // the txn: it bumps the section AGGREGATE version (spec §4), so
          // the pull's fenced section update must lose.
          await prisma.viewbookSection.update({
            where: { id: section.id },
            data: { version: { increment: 1 } },
          })
        },
      }),
    ).rejects.toMatchObject({ status: 409, code: 'version_conflict' })

    const after = await getSection(id, tpl.templateKey)
    expect(after.version).toBe(section.version + 1) // only the racer's bump
    expect(after.title).toBe(section.title) // template title did NOT land
    expect(after.subsections.map((s) => s.subsectionKey)).toEqual(['main'])
    expect(await syncVersion(id)).toBe(beforeSync)
  })
})

// ---- section scalars --------------------------------------------------------

describe('pullSectionFromTemplate — section scalars', () => {
  it('overwrites title/rendererType/copyJson/contentJson + templateVersion; NEVER touches state/introNote/narrative/ack/doneAt', async () => {
    const tpl = await mkTpl({ subs: [{ key: 'main' }] })
    const { id } = await mkViewbook()
    const section = await getSection(id, tpl.templateKey)
    const doneAt = new Date('2026-01-01T00:00:00Z')
    const ackAt = new Date('2026-01-02T00:00:00Z')
    await prisma.viewbookSection.update({
      where: { id: section.id },
      data: { state: 'done', introNote: 'per-client intro', narrative: 'per-client prose', doneAt, acknowledgedAt: ackAt },
    })
    const newCopy = JSON.stringify({ v: 1, copy: { purpose: 'p2', whatThis: 'wt2', whatWeNeed: 'wwn2' } })
    await prisma.sectionTemplate.update({
      where: { id: tpl.id },
      data: { title: 'Pulled Title', rendererType: 'strategy', copyJson: newCopy, contentJson: '{"v":1,"cfg":true}', version: 7 },
    })
    const beforeSync = await syncVersion(id)

    const { summary } = await pullSectionFromTemplate(id, tpl.templateKey, section.version, OPERATOR)

    const after = await getSection(id, tpl.templateKey)
    expect(after.title).toBe('Pulled Title')
    expect(after.rendererType).toBe('strategy')
    expect(after.copyJson).toBe(newCopy)
    expect(after.contentJson).toBe('{"v":1,"cfg":true}')
    expect(after.templateVersion).toBe(7)
    expect(after.version).toBe(section.version + 1)
    // Per-viewbook state is sacred:
    expect(after.state).toBe('done')
    expect(after.introNote).toBe('per-client intro')
    expect(after.narrative).toBe('per-client prose')
    expect(after.doneAt?.getTime()).toBe(doneAt.getTime())
    expect(after.acknowledgedAt?.getTime()).toBe(ackAt.getTime())
    expect(await syncVersion(id)).toBe(beforeSync + 1)
    expect(summary).toEqual({
      subsectionsAdded: 0,
      subsectionsUpdated: 1,
      subsectionsArchived: 0,
      fieldsAdded: 0,
      fieldsUpdated: 0,
      fieldsArchived: 0,
    })
  })

  it('EQUAL-version pull is legal (refresh/repair path) and still bumps version + syncVersion', async () => {
    const tpl = await mkTpl({ subs: [{ key: 'main' }] })
    const { id } = await mkViewbook()
    const section = await getSection(id, tpl.templateKey)
    expect(section.templateVersion).toBe(tpl.version) // premise: nothing newer
    const beforeSync = await syncVersion(id)

    const result = await pullSectionFromTemplate(id, tpl.templateKey, section.version, OPERATOR)

    const after = await getSection(id, tpl.templateKey)
    expect(after.version).toBe(section.version + 1)
    expect(after.templateVersion).toBe(tpl.version)
    expect(await syncVersion(id)).toBe(beforeSync + 1)
    expect(result.section).toBeTruthy()
  })
})

// ---- subsection diff --------------------------------------------------------

describe('pullSectionFromTemplate — subsection diff', () => {
  it('both sides: overwrites title/copy/content/offering booleans, bumps subsection version, clears archivedAt/archiveReason', async () => {
    const tpl = await mkTpl({ subs: [{ key: 'alpha', title: 'Old', copyJson: null, contentJson: null }] })
    const { id } = await mkViewbook()
    const section = await getSection(id, tpl.templateKey)
    const sub = await getSub(id, tpl.templateKey, 'alpha')
    // Simulate a previous pull-archive we are now recovering from:
    await prisma.viewbookSubsection.update({
      where: { id: sub.id },
      data: { archivedAt: new Date(), archiveReason: 'pull' },
    })
    const newCopy = JSON.stringify({ v: 1, copy: { intro: 'i2', whatWeNeed: null } })
    await prisma.subsectionTemplate.updateMany({
      where: { sectionTemplateId: tpl.id, subsectionKey: 'alpha' },
      data: { title: 'New Title', copyJson: newCopy, offeringWebsite: true, offeringVa: true },
    })

    const { summary } = await pullSectionFromTemplate(id, tpl.templateKey, section.version, OPERATOR)

    const after = await getSub(id, tpl.templateKey, 'alpha')
    expect(after.title).toBe('New Title')
    expect(after.copyJson).toBe(newCopy)
    expect(after.offeringVa).toBe(true)
    expect(after.version).toBe(sub.version + 1)
    expect(after.archivedAt).toBeNull()
    expect(after.archiveReason).toBeNull()
    expect(summary.subsectionsUpdated).toBe(1)
  })

  it('template-only: snapshot-creates the subsection WITH its fields (createdBy pull, version 0, value NULL)', async () => {
    const tpl = await mkTpl({ subs: [{ key: 'main' }] })
    const { id } = await mkViewbook()
    const section = await getSection(id, tpl.templateKey)
    const fieldKey = fk()
    await prisma.subsectionTemplate.create({
      data: {
        sectionTemplateId: tpl.id,
        subsectionKey: 'fresh',
        title: 'Fresh Sub',
        offeringWebsite: true,
        sortOrder: 20,
        copyJson: JSON.stringify({ v: 1, copy: { intro: 'fresh intro', whatWeNeed: null } }),
        fields: { create: [{ fieldKey, label: 'Fresh Field', fieldType: 'textarea', sortOrder: 10 }] },
      },
    })

    const { summary } = await pullSectionFromTemplate(id, tpl.templateKey, section.version, OPERATOR)

    const created = await getSub(id, tpl.templateKey, 'fresh')
    expect(created.title).toBe('Fresh Sub')
    expect(created.version).toBe(1)
    expect(created.archivedAt).toBeNull()
    const field = await getFieldByDefKey(id, fieldKey)
    expect(field.subsectionId).toBe(created.id)
    expect(field.category).toBe('fresh')
    expect(field.label).toBe('Fresh Field')
    expect(field.fieldType).toBe('textarea')
    expect(field.createdBy).toBe('pull')
    expect(field.version).toBe(0)
    expect(field.value).toBeNull()
    expect(summary.subsectionsAdded).toBe(1)
    expect(summary.fieldsAdded).toBe(1)
  })

  it('instance-only: archives the subsection with archiveReason pull (never deletes); its dropped-defKey fields archive pull with values preserved', async () => {
    const fieldKey = fk()
    const tpl = await mkTpl({
      subs: [
        { key: 'main' },
        { key: 'doomed', fields: [{ fieldKey }] },
      ],
    })
    const { id } = await mkViewbook()
    const section = await getSection(id, tpl.templateKey)
    const doomedSub = await getSub(id, tpl.templateKey, 'doomed')
    await prisma.viewbookField.update({
      where: { viewbookId_defKey: { viewbookId: id, defKey: fieldKey } },
      data: { value: 'client answer', valueUpdatedBy: 'client' },
    })
    // Template drops the subsection (archived template-side):
    await prisma.subsectionTemplate.updateMany({
      where: { sectionTemplateId: tpl.id, subsectionKey: 'doomed' },
      data: { archivedAt: new Date() },
    })

    const { summary } = await pullSectionFromTemplate(id, tpl.templateKey, section.version, OPERATOR)

    const after = await getSub(id, tpl.templateKey, 'doomed')
    expect(after.id).toBe(doomedSub.id) // never deleted
    expect(after.archivedAt).not.toBeNull()
    expect(after.archiveReason).toBe('pull')
    const field = await getFieldByDefKey(id, fieldKey)
    expect(field.archivedAt).not.toBeNull()
    expect(field.archiveReason).toBe('pull')
    expect(field.value).toBe('client answer') // answers preserved
    expect(summary.subsectionsArchived).toBe(1)
    expect(summary.fieldsArchived).toBe(1)
  })

  it('an already-archived instance-only subsection is left untouched (offering provenance is not rewritten to pull)', async () => {
    const tpl = await mkTpl({ subs: [{ key: 'main' }, { key: 'va-only' }] })
    const { id } = await mkViewbook()
    const section = await getSection(id, tpl.templateKey)
    const sub = await getSub(id, tpl.templateKey, 'va-only')
    const stamp = new Date('2026-02-02T00:00:00Z')
    await prisma.viewbookSubsection.update({
      where: { id: sub.id },
      data: { archivedAt: stamp, archiveReason: 'offering' },
    })
    // Template-side the subsection now matches only VA (out of this
    // website-only viewbook's filter) → instance-only branch.
    await prisma.subsectionTemplate.updateMany({
      where: { sectionTemplateId: tpl.id, subsectionKey: 'va-only' },
      data: { offeringWebsite: false, offeringVa: true },
    })

    const { summary } = await pullSectionFromTemplate(id, tpl.templateKey, section.version, OPERATOR)

    const after = await getSub(id, tpl.templateKey, 'va-only')
    expect(after.archivedAt?.getTime()).toBe(stamp.getTime())
    expect(after.archiveReason).toBe('offering')
    expect(summary.subsectionsArchived).toBe(0)
  })

  it('EMPTY after offering filter: archives every live subsection AND the section itself (pull), not an error', async () => {
    const fieldKey = fk()
    const tpl = await mkTpl({ subs: [{ key: 'main', fields: [{ fieldKey }] }, { key: 'second' }] })
    const { id } = await mkViewbook()
    const section = await getSection(id, tpl.templateKey)
    await prisma.subsectionTemplate.updateMany({
      where: { sectionTemplateId: tpl.id },
      data: { archivedAt: new Date() },
    })
    const beforeSync = await syncVersion(id)

    const { summary } = await pullSectionFromTemplate(id, tpl.templateKey, section.version, OPERATOR)

    const after = await getSection(id, tpl.templateKey)
    expect(after.archivedAt).not.toBeNull()
    expect(after.archiveReason).toBe('pull')
    expect(after.version).toBe(section.version + 1) // fence still bumps
    for (const sub of after.subsections) {
      expect(sub.archivedAt).not.toBeNull()
      expect(sub.archiveReason).toBe('pull')
    }
    const field = await getFieldByDefKey(id, fieldKey)
    expect(field.archivedAt).not.toBeNull()
    expect(field.archiveReason).toBe('pull')
    expect(summary.subsectionsArchived).toBe(2)
    expect(summary.subsectionsAdded).toBe(0)
    expect(summary.subsectionsUpdated).toBe(0)
    expect(await syncVersion(id)).toBe(beforeSync + 1)
  })

  it('a section archived by a previous empty-filter pull is restored when the template regains a matching subsection', async () => {
    const tpl = await mkTpl({ subs: [{ key: 'main' }] })
    const { id } = await mkViewbook()
    let section = await getSection(id, tpl.templateKey)
    await prisma.subsectionTemplate.updateMany({
      where: { sectionTemplateId: tpl.id },
      data: { archivedAt: new Date() },
    })
    await pullSectionFromTemplate(id, tpl.templateKey, section.version, OPERATOR)
    section = await getSection(id, tpl.templateKey)
    expect(section.archivedAt).not.toBeNull()
    // Template regains the subsection:
    await prisma.subsectionTemplate.updateMany({
      where: { sectionTemplateId: tpl.id },
      data: { archivedAt: null },
    })

    await pullSectionFromTemplate(id, tpl.templateKey, section.version, OPERATOR)

    const after = await getSection(id, tpl.templateKey)
    expect(after.archivedAt).toBeNull()
    expect(after.archiveReason).toBeNull()
    const sub = await getSub(id, tpl.templateKey, 'main')
    expect(sub.archivedAt).toBeNull()
    expect(sub.archiveReason).toBeNull()
  })
})

// ---- field merge ------------------------------------------------------------

describe('pullSectionFromTemplate — field merge', () => {
  it('value + version + valueUpdated* + amendments survive a template relabel/reorder', async () => {
    const fieldKey = fk()
    const tpl = await mkTpl({ subs: [{ key: 'qs', fields: [{ fieldKey, label: 'Old label', sortOrder: 10 }] }] })
    const { id } = await mkViewbook()
    const section = await getSection(id, tpl.templateKey)
    const valueUpdatedAt = new Date('2026-03-03T03:03:03Z')
    const before = await getFieldByDefKey(id, fieldKey)
    await prisma.viewbookField.update({
      where: { id: before.id },
      data: { value: 'the answer', version: 4, valueUpdatedBy: 'client', valueUpdatedByKind: 'client', valueUpdatedAt },
    })
    await prisma.viewbookFieldAmendment.create({
      data: { fieldId: before.id, value: 'amended answer', author: 'client', authorKind: 'client' },
    })
    await prisma.fieldTemplate.update({
      where: { fieldKey },
      data: { label: 'New label', sortOrder: 55 },
    })

    const { summary } = await pullSectionFromTemplate(id, tpl.templateKey, section.version, OPERATOR)

    const after = await prisma.viewbookField.findUniqueOrThrow({
      where: { id: before.id },
      include: { amendments: true },
    })
    expect(after.label).toBe('New label')
    expect(after.sortOrder).toBe(55)
    expect(after.value).toBe('the answer')
    expect(after.version).toBe(4)
    expect(after.valueUpdatedBy).toBe('client')
    expect(after.valueUpdatedAt?.getTime()).toBe(valueUpdatedAt.getTime())
    expect(after.amendments).toHaveLength(1)
    expect(after.amendments[0].value).toBe('amended answer')
    expect(after.fieldType).toBe(before.fieldType) // never changed
    expect(summary.fieldsUpdated).toBe(1)
  })

  it('cross-SUBSECTION template move re-parents the SAME row (id preserved, category follows)', async () => {
    const fieldKey = fk()
    const tpl = await mkTpl({ subs: [{ key: 's1', fields: [{ fieldKey }] }, { key: 's2' }] })
    const { id } = await mkViewbook()
    const section = await getSection(id, tpl.templateKey)
    const before = await getFieldByDefKey(id, fieldKey)
    await prisma.viewbookField.update({ where: { id: before.id }, data: { value: 'kept' } })
    const s2Tpl = tpl.subsections.find((s) => s.subsectionKey === 's2')!
    await prisma.fieldTemplate.update({ where: { fieldKey }, data: { subsectionTemplateId: s2Tpl.id } })

    await pullSectionFromTemplate(id, tpl.templateKey, section.version, OPERATOR)

    const after = await getFieldByDefKey(id, fieldKey)
    const s2 = await getSub(id, tpl.templateKey, 's2')
    expect(after.id).toBe(before.id)
    expect(after.subsectionId).toBe(s2.id)
    expect(after.category).toBe('s2')
    expect(after.value).toBe('kept')
    expect(after.archivedAt).toBeNull()
  })

  it('cross-SECTION template move: pull(source) archives; pull(destination) restores + re-parents the SAME row with its value', async () => {
    const fieldKey = fk()
    const tplA = await mkTpl({ subs: [{ key: 'a-main', fields: [{ fieldKey }] }] })
    const tplB = await mkTpl({ subs: [{ key: 'b-main' }] })
    const { id } = await mkViewbook()
    const sectionA = await getSection(id, tplA.templateKey)
    const before = await getFieldByDefKey(id, fieldKey)
    await prisma.viewbookField.update({ where: { id: before.id }, data: { value: 'moving answer' } })
    // Template-side: the field moves from A/a-main to B/b-main.
    const bMainTpl = tplB.subsections.find((s) => s.subsectionKey === 'b-main')!
    await prisma.fieldTemplate.update({ where: { fieldKey }, data: { subsectionTemplateId: bMainTpl.id } })

    // Pull the SOURCE section: the defKey has no active FieldTemplate in A
    // anymore → archived 'pull' (ownership predicate reaches it: it still
    // sits under A's subsection).
    const pullA = await pullSectionFromTemplate(id, tplA.templateKey, sectionA.version, OPERATOR)
    const archived = await getFieldByDefKey(id, fieldKey)
    expect(archived.id).toBe(before.id)
    expect(archived.archivedAt).not.toBeNull()
    expect(archived.archiveReason).toBe('pull')
    expect(archived.value).toBe('moving answer')
    expect(pullA.summary.fieldsArchived).toBe(1)

    // Pull the DESTINATION section: defKey matching is viewbook-global →
    // the SAME row is restored + re-parented, answer intact.
    const sectionB = await getSection(id, tplB.templateKey)
    const pullB = await pullSectionFromTemplate(id, tplB.templateKey, sectionB.version, OPERATOR)
    const restored = await getFieldByDefKey(id, fieldKey)
    const bMain = await getSub(id, tplB.templateKey, 'b-main')
    expect(restored.id).toBe(before.id)
    expect(restored.subsectionId).toBe(bMain.id)
    expect(restored.category).toBe('b-main')
    expect(restored.archivedAt).toBeNull()
    expect(restored.archiveReason).toBeNull()
    expect(restored.value).toBe('moving answer')
    expect(pullB.summary.fieldsUpdated).toBe(1)
  })

  it('operator-archived field is NEVER auto-restored (label still refreshes; archive state survives)', async () => {
    const fieldKey = fk()
    const tpl = await mkTpl({ subs: [{ key: 'qs', fields: [{ fieldKey, label: 'Old label' }] }] })
    const { id } = await mkViewbook()
    const section = await getSection(id, tpl.templateKey)
    const stamp = new Date('2026-04-04T00:00:00Z')
    await prisma.viewbookField.update({
      where: { viewbookId_defKey: { viewbookId: id, defKey: fieldKey } },
      data: { archivedAt: stamp, archiveReason: 'operator' },
    })
    await prisma.fieldTemplate.update({ where: { fieldKey }, data: { label: 'Refreshed label' } })

    await pullSectionFromTemplate(id, tpl.templateKey, section.version, OPERATOR)

    const after = await getFieldByDefKey(id, fieldKey)
    expect(after.label).toBe('Refreshed label')
    expect(after.archivedAt?.getTime()).toBe(stamp.getTime())
    expect(after.archiveReason).toBe('operator')
  })

  it('custom fields (defKey null) are untouched by pull', async () => {
    const tpl = await mkTpl({ subs: [{ key: 'qs' }] })
    const { id } = await mkViewbook()
    const section = await getSection(id, tpl.templateKey)
    const qs = await getSub(id, tpl.templateKey, 'qs')
    const custom = await prisma.viewbookField.create({
      data: {
        viewbookId: id,
        subsectionId: qs.id,
        defKey: null,
        category: 'qs',
        label: 'Operator custom question',
        fieldType: 'text',
        sortOrder: 999,
        value: 'custom answer',
        createdBy: OPERATOR,
      },
    })

    await pullSectionFromTemplate(id, tpl.templateKey, section.version, OPERATOR)

    const after = await prisma.viewbookField.findUniqueOrThrow({ where: { id: custom.id } })
    expect(after.label).toBe('Operator custom question')
    expect(after.value).toBe('custom answer')
    expect(after.archivedAt).toBeNull()
    expect(after.subsectionId).toBe(qs.id)
  })

  it('missing field (template gained one on an existing subsection) is created by INSERT…SELECT with durable-key resolution', async () => {
    const tpl = await mkTpl({ subs: [{ key: 'qs' }] })
    const { id } = await mkViewbook()
    const section = await getSection(id, tpl.templateKey)
    const fieldKey = fk()
    const qsTpl = tpl.subsections.find((s) => s.subsectionKey === 'qs')!
    await prisma.fieldTemplate.create({
      data: { subsectionTemplateId: qsTpl.id, fieldKey, label: 'Late addition', fieldType: 'list', sortOrder: 20 },
    })

    const { summary } = await pullSectionFromTemplate(id, tpl.templateKey, section.version, OPERATOR)

    const qs = await getSub(id, tpl.templateKey, 'qs')
    const field = await getFieldByDefKey(id, fieldKey)
    expect(field.subsectionId).toBe(qs.id)
    expect(field.category).toBe('qs')
    expect(field.fieldType).toBe('list')
    expect(field.createdBy).toBe('pull')
    expect(field.value).toBeNull()
    expect(field.version).toBe(0)
    expect(summary.fieldsAdded).toBe(1)
  })
})

// ---- assets -----------------------------------------------------------------

const rosterContent = (name: string, photo: string | null) =>
  JSON.stringify({ v: 1, team: [{ name, role: 'CSM', photo, blurb: '', email: null }], process: { blocks: [] }, why: { blocks: [] } })

describe('pullSectionFromTemplate — asset snapshot', () => {
  it('EQUAL-version pull repairs a photoless viewbook: copies the template roster photo into viewbook scope', async () => {
    // Create the viewbook while the global source file is MISSING → phase 2
    // degrades to photoless (the §5 crash-window shape).
    const missing = `${crypto.randomUUID()}.webp`
    const tpl = await mkTpl({ rendererType: 'welcome', subs: [{ key: 'main', contentJson: rosterContent('Jo', missing) }] })
    const { id } = await mkViewbook()
    const section = await getSection(id, tpl.templateKey)
    const beforeSub = await getSub(id, tpl.templateKey, 'main')
    expect(JSON.parse(beforeSub.contentJson!).team[0].photo).toBeNull() // photoless premise

    // The source file appears (the repair scenario) — template now references it.
    const { filename } = await saveViewbookAsset('global', realPng)
    await prisma.subsectionTemplate.updateMany({
      where: { sectionTemplateId: tpl.id, subsectionKey: 'main' },
      data: { contentJson: rosterContent('Jo', filename) },
    })
    const beforeSync = await syncVersion(id)

    await pullSectionFromTemplate(id, tpl.templateKey, section.version, OPERATOR)

    const afterSub = await getSub(id, tpl.templateKey, 'main')
    const photo = JSON.parse(afterSub.contentJson!).team[0].photo
    expect(typeof photo).toBe('string')
    expect(photo).not.toBe(filename) // NEW instance-scope uuid, never the global name
    expect(await readViewbookAsset(String(id), photo)).not.toBeNull()
    expect(await syncVersion(id)).toBe(beforeSync + 1)
  })

  it('replaced instance file is deleted post-commit when nothing else references it, but a SHARED filename survives', async () => {
    const { filename: globalA } = await saveViewbookAsset('global', realPng)
    const tplW1 = await mkTpl({ rendererType: 'welcome', subs: [{ key: 'main', contentJson: rosterContent('Jo', globalA) }] })
    const tplW2 = await mkTpl({ rendererType: 'welcome', subs: [{ key: 'main', contentJson: rosterContent('Kim', globalA) }] })
    const { id } = await mkViewbook()

    const w1Before = await getSub(id, tplW1.templateKey, 'main')
    const oldPhoto = JSON.parse(w1Before.contentJson!).team[0].photo as string
    expect(await readViewbookAsset(String(id), oldPhoto)).not.toBeNull()

    // Make W2's instance reference the SAME instance-scope file W1 holds
    // (shared-filename premise).
    const w2Before = await getSub(id, tplW2.templateKey, 'main')
    await prisma.viewbookSubsection.update({
      where: { id: w2Before.id },
      data: { contentJson: rosterContent('Kim', oldPhoto) },
    })

    // Template W1 replaces the roster photo with a different global file.
    const { filename: globalB } = await saveViewbookAsset('global', realPng)
    await prisma.subsectionTemplate.updateMany({
      where: { sectionTemplateId: tplW1.id, subsectionKey: 'main' },
      data: { contentJson: rosterContent('Jo', globalB) },
    })

    // Pull W1: its old photo is REPLACED, but W2 still references it → the
    // file must survive.
    const sectionW1 = await getSection(id, tplW1.templateKey)
    await pullSectionFromTemplate(id, tplW1.templateKey, sectionW1.version, OPERATOR)
    expect(await readViewbookAsset(String(id), oldPhoto)).not.toBeNull()
    const w1After = await getSub(id, tplW1.templateKey, 'main')
    const newPhoto = JSON.parse(w1After.contentJson!).team[0].photo as string
    expect(newPhoto).not.toBe(oldPhoto)
    expect(await readViewbookAsset(String(id), newPhoto)).not.toBeNull()

    // Now pull W2 (its template points at globalA → fresh copy replaces the
    // shared ref). Nothing references oldPhoto anymore → deleted.
    const sectionW2 = await getSection(id, tplW2.templateKey)
    await pullSectionFromTemplate(id, tplW2.templateKey, sectionW2.version, OPERATOR)
    expect(await readViewbookAsset(String(id), oldPhoto)).toBeNull()
  })

  it('a lost fence (beforeCommit race) deletes the freshly-copied files', async () => {
    const { filename: globalA } = await saveViewbookAsset('global', realPng)
    const tpl = await mkTpl({ rendererType: 'welcome', subs: [{ key: 'main', contentJson: rosterContent('Jo', globalA) }] })
    const { id } = await mkViewbook()
    const section = await getSection(id, tpl.templateKey)
    const keptPhoto = JSON.parse((await getSub(id, tpl.templateKey, 'main')).contentJson!).team[0].photo as string

    await expect(
      pullSectionFromTemplate(id, tpl.templateKey, section.version + 9, OPERATOR),
    ).rejects.toMatchObject({ status: 409, code: 'version_conflict' })

    // The create-time copy survives; the pull's aborted copy is gone: the
    // viewbook scope holds exactly ONE file.
    const sub = await getSub(id, tpl.templateKey, 'main')
    expect(JSON.parse(sub.contentJson!).team[0].photo).toBe(keptPhoto)
    expect(await readViewbookAsset(String(id), keptPhoto)).not.toBeNull()
    const { readdir } = await import('fs/promises')
    const files = await readdir(path.join(assetsDir, String(id)))
    expect(files).toEqual([keptPhoto])
  })
})

// ---- response shape ---------------------------------------------------------

describe('pullSectionFromTemplate — response', () => {
  it('returns the refreshed section tree (subsections with fields) alongside the summary', async () => {
    const fieldKey = fk()
    const tpl = await mkTpl({ subs: [{ key: 'qs', fields: [{ fieldKey }] }] })
    const { id } = await mkViewbook()
    const section = await getSection(id, tpl.templateKey)

    const { section: tree, summary } = await pullSectionFromTemplate(id, tpl.templateKey, section.version, OPERATOR)

    expect(tree.sectionKey).toBe(tpl.templateKey)
    expect(tree.version).toBe(section.version + 1)
    expect(tree.subsections).toHaveLength(1)
    expect(tree.subsections[0].fields.map((f) => f.defKey)).toEqual([fieldKey])
    expect(summary.fieldsUpdated).toBe(1)
  })
})
