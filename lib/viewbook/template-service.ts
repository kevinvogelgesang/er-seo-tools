// THE single dual-write authority (spec §7 fixes #2/#3). Deleted whole in F2.
//
// getTemplateTree = the tree read (F1a's SectionTemplate/SubsectionTemplate/
// FieldTemplate rows decoded into typed views, corrupt columns degrading to
// null + a logged signal — never thrown). patchSectionTemplate = the ONE
// section-level write: a title-only edit touches only SectionTemplate, but a
// copy edit ALSO dual-writes the legacy `section-copy:<key>` global-content
// row inside the SAME array-form $transaction (Codex plan-fix #2/#3) — the
// throwing extendedWhereUnique guard is placed FIRST so a stale version rolls
// back BOTH sides (precedent: lib/viewbook/service.ts:397). syncVersion policy
// (plan decision D-e): a bridged copy write bumps every viewbook's
// syncVersion (via putSectionCopyGlobalStatements' syncBump); a title-only
// edit has no legacy statement and bumps nothing. reorderSections is an
// all-or-nothing sortOrder swap under the same guard-per-row shape. Array-form
// $transaction([...]) only — NEVER interactive $transaction(async tx => ...).
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { HttpError } from '@/lib/api/errors'
import { logError } from '@/lib/log'
import {
  parseTemplateCopy,
  parseSubsectionContent,
  parseSubsectionCopy,
  toLegacyGlobalBody,
  FIELD_KEY_RE,
  type SubsectionContentV1,
} from './template-content'
import { validateSectionCopy, type SectionCopyContent } from './section-copy-validator'
import { putSectionCopyGlobalStatements, deleteSectionCopyGlobalStatements, sectionCopyKey } from './section-copy-content'
import {
  putGlobalContentStatements,
  buildTeamRosterWrite,
  attachTeamPhoto,
  teamRosterFence,
  validateGlobalContent,
} from './global-content'
import { deleteViewbookAssets } from './assets'
import { validateTeam } from './content-validators'
import { SECTION_KEYS, type SectionKey } from './theme'
import { SECTION_COPY } from './section-copy'
import { CATALOG_CATEGORIES } from './catalog'
import { syncVersionBumpAllStatement, syncVersionBumpAllWhere } from './sync'
import {
  projectMainContentJson,
  projectTemplateSeedWithIssues,
  seedTreeCreateData,
  createSeedTree,
  type SeedSourceRow,
} from './template-seed'
import { GLOBAL_CONTENT_KEYS } from './global-content-keys'
import type { GlobalContentKey, TeamMember, ContentBlocks } from './global-content-keys'

// The four bridged (templateKey, 'main') content pairs and their legacy keys.
export const BRIDGED_CONTENT: Record<string, { parts: Record<string, GlobalContentKey> }> = {
  welcome: { parts: { team: 'team', process: 'process', why: 'why' } },
  strategy: { parts: { seoBase: 'seo-base', geoBase: 'geo-base', eeatBase: 'eeat-base' } },
  milestones: { parts: { processMilestones: 'process-milestones' } },
  'pc-intro': { parts: { intro: 'pc-intro' } },
}
export type ContentKind = 'welcome' | 'strategy' | 'milestones' | 'pc-intro' | 'generic' | 'none'

// Task 6: the inverse of BRIDGED_CONTENT — every legacy GlobalContentKey maps
// to exactly one bridged templateKey + the envelope part name it substitutes
// into. Built ONCE at module scope from BRIDGED_CONTENT so the forward
// (envelope→legacy keys) and inverse (legacy key→envelope part) views can
// never drift apart.
const LEGACY_KEY_TARGET: Partial<Record<GlobalContentKey, { templateKey: SectionKey; part: string }>> = {}
for (const [templateKey, { parts }] of Object.entries(BRIDGED_CONTENT)) {
  for (const [part, legacyKey] of Object.entries(parts)) {
    LEGACY_KEY_TARGET[legacyKey] = { templateKey: templateKey as SectionKey, part }
  }
}

export interface TemplateFieldView {
  id: number
  fieldKey: string
  label: string
  fieldType: string
  sortOrder: number
  version: number
  archivedAt: string | null
}
export interface TemplateSubsectionView {
  id: number
  subsectionKey: string
  title: string
  offeringWebsite: boolean
  offeringVa: boolean
  offeringPpc: boolean
  copy: { intro: string | null; whatWeNeed: string | null } | null
  content: SubsectionContentV1 | null // decoded; null when absent OR corrupt
  contentKind: ContentKind
  sortOrder: number
  version: number
  archivedAt: string | null
  fields: TemplateFieldView[]
}
export interface TemplateSectionView {
  id: number
  templateKey: string
  rendererType: string
  title: string
  copy: SectionCopyContent | null // decoded from copyJson; null = corrupt (UI shows a warning, not a form)
  sortOrder: number
  version: number
  archivedAt: string | null
  subsections: TemplateSubsectionView[]
}

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null)
const CATALOG_CATEGORY_SET: ReadonlySet<string> = new Set(CATALOG_CATEGORIES)

// contentKind rule (plan decision D-b): the ONE 'main' subsection of a
// bridged renderer carries that renderer's kind; every other seeded 'main'
// (a content-less renderer like brand/materials/etc.) is 'none'; the
// data-source category subsections (keyed by CATALOG_CATEGORIES, never
// 'main') are also 'none' (they hold FieldTemplate rows, not free content) —
// but ONLY under the 'data-source' section itself: an operator-created
// subsection under a DIFFERENT section that happens to share a
// CATALOG_CATEGORIES key (e.g. a `programs` subsection under `brand`) is a
// distinct row (per-section @@unique makes the collision impossible under
// data-source anyway) and decodes 'generic' like any other operator-created
// subsection (review fix — was un-scoped, mislabeling that row 'none').
// Anything else — an F2 operator-created subsection — is 'generic'.
function contentKindFor(templateKey: string, subsectionKey: string): ContentKind {
  if (subsectionKey === 'main') {
    return Object.prototype.hasOwnProperty.call(BRIDGED_CONTENT, templateKey)
      ? (templateKey as ContentKind)
      : 'none'
  }
  return templateKey === 'data-source' && CATALOG_CATEGORY_SET.has(subsectionKey) ? 'none' : 'generic'
}

function isSectionKey(key: string): key is SectionKey {
  return (SECTION_KEYS as readonly string[]).includes(key)
}

function isP2025(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025'
}

// Shared txn runner for Task 4's mutations (patchSubsection/patchField): both
// map a stale version guard (P2025) AND — for patchSubsection's team-roster
// fence — a lost concurrent-roster race (also P2025, uniformly NOT
// distinguished from a stale template version; the UI refetches either way)
// to the SAME conflict code. createSubsection/createField do NOT use this —
// their P2002 (subsectionKey/fieldKey collision) needs a DISTINCT code from
// their P2025 (stale version), so they catch inline instead.
async function runGuarded<T extends Prisma.PrismaPromise<unknown>[]>(
  statements: [...T],
  conflictCode = 'version_conflict',
): Promise<void> {
  try {
    await prisma.$transaction(statements)
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      (err.code === 'P2025' || err.code === 'P2002')
    ) {
      throw new HttpError(409, conflictCode)
    }
    throw err
  }
}

export async function getTemplateTree(): Promise<{ sections: TemplateSectionView[] }> {
  const rows = await prisma.sectionTemplate.findMany({
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: {
      subsections: {
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        include: {
          fields: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
        },
      },
    },
  })

  const sections: TemplateSectionView[] = rows.map((section) => {
    const parsedCopy = parseTemplateCopy(section.copyJson)
    if (parsedCopy === null) {
      // copyJson is NOT NULL on this model — a null parse is always corrupt,
      // never a legitimate "absent" state.
      logError(
        { subsystem: 'viewbook', op: 'template-tree-copy', templateKey: section.templateKey },
        new Error(`corrupt SectionTemplate.copyJson: ${section.templateKey}`),
      )
    }

    return {
      id: section.id,
      templateKey: section.templateKey,
      rendererType: section.rendererType,
      title: section.title,
      copy: parsedCopy?.copy ?? null,
      sortOrder: section.sortOrder,
      version: section.version,
      archivedAt: iso(section.archivedAt),
      subsections: section.subsections.map((sub) => {
        const parsedSubCopy = sub.copyJson !== null ? parseSubsectionCopy(sub.copyJson) : null
        if (sub.copyJson !== null && parsedSubCopy === null) {
          logError(
            {
              subsystem: 'viewbook',
              op: 'template-tree-subsection-copy',
              templateKey: section.templateKey,
              subsectionKey: sub.subsectionKey,
            },
            new Error(`corrupt SubsectionTemplate.copyJson: ${section.templateKey}/${sub.subsectionKey}`),
          )
        }

        // Bridged content lives on the 'main' subsection under the section's
        // OWN rendererType; every other subsection (data-source categories,
        // future F2 operator-created ones) uses the 'generic' shape — content
        // is null for the category rows anyway, so the choice is immaterial there.
        const contentRendererType = sub.subsectionKey === 'main' ? section.rendererType : 'generic'
        const parsedContent = parseSubsectionContent(contentRendererType, sub.contentJson)
        if (sub.contentJson !== null && parsedContent === null) {
          logError(
            {
              subsystem: 'viewbook',
              op: 'template-tree-subsection-content',
              templateKey: section.templateKey,
              subsectionKey: sub.subsectionKey,
            },
            new Error(`corrupt SubsectionTemplate.contentJson: ${section.templateKey}/${sub.subsectionKey}`),
          )
        }

        return {
          id: sub.id,
          subsectionKey: sub.subsectionKey,
          title: sub.title,
          offeringWebsite: sub.offeringWebsite,
          offeringVa: sub.offeringVa,
          offeringPpc: sub.offeringPpc,
          copy: parsedSubCopy?.copy ?? null,
          content: parsedContent,
          contentKind: contentKindFor(section.templateKey, sub.subsectionKey),
          sortOrder: sub.sortOrder,
          version: sub.version,
          archivedAt: iso(sub.archivedAt),
          fields: sub.fields.map((f) => ({
            id: f.id,
            fieldKey: f.fieldKey,
            label: f.label,
            fieldType: f.fieldType,
            sortOrder: f.sortOrder,
            version: f.version,
            archivedAt: iso(f.archivedAt),
          })),
        }
      }),
    }
  })

  return { sections }
}

export async function patchSectionTemplate(
  sectionId: number,
  input: { version: number; title?: string; copy?: unknown },
  updatedBy: string,
): Promise<void> {
  if (input.title === undefined && input.copy === undefined) {
    throw new HttpError(400, 'invalid_content')
  }
  if (input.title !== undefined) {
    if (typeof input.title !== 'string' || input.title.trim().length === 0 || input.title.length > 200) {
      throw new HttpError(400, 'invalid_content')
    }
  }

  const existing = await prisma.sectionTemplate.findUnique({
    where: { id: sectionId },
    select: { templateKey: true },
  })
  if (!existing) throw new HttpError(404, 'not_found')

  let validatedCopy: SectionCopyContent | null = null
  if (input.copy !== undefined) {
    validatedCopy = validateSectionCopy(input.copy)
    if (validatedCopy === null) throw new HttpError(400, 'invalid_content')
    if (!isSectionKey(existing.templateKey)) {
      // The fixed F1a catalog (13 canonical keys) is the only bridge target —
      // a templateKey off that catalog (never produced today) has no legacy
      // section-copy home to dual-write.
      throw new HttpError(400, 'invalid_content')
    }
  }

  const guardedTemplateWrite = prisma.sectionTemplate.update({
    // extendedWhereUnique filter — P2025 on stale (precedent: lib/viewbook/service.ts:397)
    where: { id: sectionId, version: input.version },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(validatedCopy ? { copyJson: JSON.stringify({ v: 1, copy: validatedCopy }) } : {}),
      version: { increment: 1 },
    },
  })

  const statements: Prisma.PrismaPromise<unknown>[] = validatedCopy
    ? (({ legacyWrite, syncBump }) => [guardedTemplateWrite, legacyWrite, syncBump])(
        putSectionCopyGlobalStatements(existing.templateKey as SectionKey, validatedCopy, updatedBy),
      )
    : [guardedTemplateWrite] // title-only: no legacy statement, no syncVersion bump (D-e)

  try {
    await prisma.$transaction(statements)
  } catch (err) {
    if (isP2025(err)) throw new HttpError(409, 'version_conflict')
    throw err
  }
}

export async function reorderSections(
  items: Array<{ id: number; version: number; sortOrder: number }>,
): Promise<void> {
  if (items.length === 0) throw new HttpError(400, 'invalid_content')
  const seen = new Set<number>()
  for (const item of items) {
    if (!Number.isInteger(item.id) || !Number.isInteger(item.version) || !Number.isInteger(item.sortOrder)) {
      throw new HttpError(400, 'invalid_content')
    }
    if (seen.has(item.id)) throw new HttpError(400, 'invalid_content')
    seen.add(item.id)
  }

  const statements = items.map((item) =>
    prisma.sectionTemplate.update({
      where: { id: item.id, version: item.version },
      data: { sortOrder: item.sortOrder, version: { increment: 1 } },
    }),
  )

  try {
    await prisma.$transaction(statements)
  } catch (err) {
    if (isP2025(err)) throw new HttpError(409, 'version_conflict')
    throw err
  }
}

export interface PatchSubsectionDeps {
  // Test-only seam (mirrors attachTeamPhoto.beforeStamp): awaited between the
  // loads (incl. the team row read used to fence the roster guard-write) and
  // the $transaction, so a test can inject a rival roster write that lands in
  // the gap and prove the throwing guard catches it.
  beforeWrite?: () => Promise<void>
}

export async function patchSubsection(
  subId: number,
  input: {
    version: number
    title?: string
    offeringWebsite?: boolean
    offeringVa?: boolean
    offeringPpc?: boolean
    copy?: unknown | null
    content?: unknown | null
    archived?: boolean
  },
  updatedBy: string,
  deps: PatchSubsectionDeps = {},
): Promise<void> {
  const sub = await prisma.subsectionTemplate.findUnique({
    where: { id: subId },
    include: { section: true },
  })
  if (!sub) throw new HttpError(404, 'not_found')
  const section = sub.section

  if (input.title !== undefined) {
    if (typeof input.title !== 'string' || input.title.trim().length === 0 || input.title.length > 200) {
      throw new HttpError(400, 'invalid_content')
    }
  }
  for (const flag of ['offeringWebsite', 'offeringVa', 'offeringPpc'] as const) {
    if (input[flag] !== undefined && typeof input[flag] !== 'boolean') {
      throw new HttpError(400, 'invalid_content')
    }
  }

  // copy: null clears; otherwise validate the {v:1, copy:{...}} envelope.
  let copyJson: string | null | undefined // undefined = field absent from the patch
  if (input.copy !== undefined) {
    if (input.copy === null) {
      copyJson = null
    } else {
      const envelope = JSON.stringify({ v: 1, copy: input.copy })
      if (parseSubsectionCopy(envelope) === null) throw new HttpError(400, 'invalid_content')
      copyJson = envelope
    }
  }

  const contentKind = contentKindFor(section.templateKey, sub.subsectionKey)

  // content: null clears (no legacy dual-write — there's nothing to derive a
  // legacy body FROM); a non-null value is validated by contentKind (D-b(2)).
  // Data-loss guard (final review fix #1): for the four BRIDGED kinds, a null
  // envelope is ALWAYS corrupt, never a legitimate empty state — every
  // bridged 'main' subsection is seeded with a real (non-null) envelope
  // (template-seed.ts's projectMainContentJson) and never operator-created.
  // Accepting `content: null` here would clear contentJson (harmless on its
  // own — it dual-writes nothing) but the UI's corresponding "safe" empty
  // form would then let an operator Save an EMPTY roster/blocks draft next,
  // which DOES dual-write and wipes the legacy rows (roster photos included).
  // Reject at the source instead of trusting the client to never construct
  // this payload. 'generic' keeps null as a legitimate clear (operator-
  // created subsections start empty); 'none' never reaches here non-null.
  let contentJson: string | null | undefined
  const legacyStatements: Prisma.PrismaPromise<unknown>[] = []
  let syncBump: Prisma.PrismaPromise<unknown> | null = null
  let orphanedPhotos: string[] = []
  const isBridgedKind = Object.prototype.hasOwnProperty.call(BRIDGED_CONTENT, contentKind)

  if (input.content !== undefined) {
    if (input.content === null) {
      if (isBridgedKind) throw new HttpError(400, 'invalid_content')
      contentJson = null
    } else if (contentKind === 'none') {
      throw new HttpError(400, 'invalid_content')
    } else if (contentKind === 'generic') {
      // The client sends the bare ContentBlocks value ({blocks:[...]}) — the
      // generic envelope's OWN 'blocks' field holds that value directly (the
      // double-nesting is real: SubsectionContentV1's generic variant is
      // `{v:1, blocks: ContentBlocks}`, template-content.test.ts pins it).
      const envelope = JSON.stringify({ v: 1, blocks: input.content })
      if (parseSubsectionContent('generic', envelope) === null) throw new HttpError(400, 'invalid_content')
      contentJson = envelope
    } else {
      // Bridged kind ('welcome' | 'strategy' | 'milestones' | 'pc-intro'):
      // validate against the section's own rendererType (same convention as
      // getTemplateTree's read side).
      const rawContent = input.content as Record<string, unknown>
      let envelopeContent: Record<string, unknown> = rawContent
      let teamRow: { bodyJson: string } | null = null

      if (contentKind === 'welcome') {
        const validatedIncomingTeam = validateTeam(rawContent.team)
        if (validatedIncomingTeam === null) throw new HttpError(400, 'invalid_content')
        // Photo re-derivation rule (buildTeamRosterWrite): incoming `photo`
        // values are IGNORED and re-derived from the STORED roster by name —
        // the DERIVED roster replaces content.team in BOTH the template
        // envelope and the legacy write below.
        teamRow = await prisma.viewbookGlobalContent.findUnique({ where: { key: 'team' } })
        const teamWrite = buildTeamRosterWrite(teamRow, validatedIncomingTeam, updatedBy)
        envelopeContent = { ...rawContent, team: teamWrite.next }
        legacyStatements.push(teamWrite.legacyWrite)
        orphanedPhotos = teamWrite.orphaned
      }

      const envelope = JSON.stringify({ v: 1, ...envelopeContent })
      const parsed = parseSubsectionContent(section.rendererType, envelope)
      if (parsed === null) throw new HttpError(400, 'invalid_content')
      contentJson = envelope

      const bridge = BRIDGED_CONTENT[section.templateKey]
      for (const [, legacyKey] of Object.entries(bridge.parts)) {
        if (legacyKey === 'team') continue // already built above (throwing guard-write)
        // Never TeamMember[] here ('team' skipped above) — the remaining
        // bridge parts are always ContentBlocks or (pc-intro) a string.
        const legacyBody = toLegacyGlobalBody(legacyKey, parsed) as Exclude<ReturnType<typeof toLegacyGlobalBody>, TeamMember[] | null>
        legacyStatements.push(putGlobalContentStatements(legacyKey, legacyBody, updatedBy).legacyWrite)
      }
      // ONE bump for the whole bridged write (D-e). The PLAIN (unfenced)
      // variant is deliberate here, not `teamWrite.syncBump`'s roster-fenced
      // one: array-txn atomicity already makes this safe — if the roster
      // guard-write above throws (lost race), this statement never commits
      // either, it rolls back with everything else in the same transaction.
      syncBump = syncVersionBumpAllStatement()
    }
  }

  if (deps.beforeWrite) await deps.beforeWrite()

  const guard = prisma.sectionTemplate.update({
    where: { id: section.id, version: input.version },
    data: { version: { increment: 1 } },
  })
  const subsectionUpdate = prisma.subsectionTemplate.update({
    where: { id: subId },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.offeringWebsite !== undefined ? { offeringWebsite: input.offeringWebsite } : {}),
      ...(input.offeringVa !== undefined ? { offeringVa: input.offeringVa } : {}),
      ...(input.offeringPpc !== undefined ? { offeringPpc: input.offeringPpc } : {}),
      ...(copyJson !== undefined ? { copyJson } : {}),
      ...(contentJson !== undefined ? { contentJson } : {}),
      ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}),
      version: { increment: 1 },
    },
  })

  const statements: Prisma.PrismaPromise<unknown>[] = [guard, subsectionUpdate, ...legacyStatements]
  if (syncBump) statements.push(syncBump)

  await runGuarded(statements)

  if (orphanedPhotos.length > 0) await deleteViewbookAssets('global', orphanedPhotos)
}

export async function createSubsection(
  sectionId: number,
  input: {
    version: number
    subsectionKey: string
    title: string
    offeringWebsite?: boolean
    offeringVa?: boolean
    offeringPpc?: boolean
    copy?: unknown
    content?: unknown
  },
  updatedBy: string,
): Promise<void> {
  if (!FIELD_KEY_RE.test(input.subsectionKey)) throw new HttpError(400, 'invalid_key')
  if (typeof input.title !== 'string' || input.title.trim().length === 0 || input.title.length > 200) {
    throw new HttpError(400, 'invalid_content')
  }

  // Deterministic pre-check (P2002 would catch these anyway): 'main' exists
  // in EVERY seeded section, so it's rejected universally. The
  // CATALOG_CATEGORIES keys, though, are only the seeded row under
  // data-source specifically (per-section @@unique — the SAME key under a
  // different section is a distinct, legal row: e.g. a `programs`
  // subsection under `brand` is fine and decodes 'generic', matching
  // contentKindFor's scoping). Operator-created subsections are ALWAYS
  // 'generic' — never a bridge pair.
  const section = await prisma.sectionTemplate.findUnique({
    where: { id: sectionId },
    select: { templateKey: true },
  })
  if (!section) throw new HttpError(404, 'not_found')
  if (
    input.subsectionKey === 'main' ||
    (section.templateKey === 'data-source' && CATALOG_CATEGORY_SET.has(input.subsectionKey))
  ) {
    throw new HttpError(409, 'subsection_exists')
  }

  let contentJson: string | null = null
  if (input.content !== undefined && input.content !== null) {
    // Same double-nesting as patchSubsection's generic branch: the client
    // sends the bare ContentBlocks value; the envelope's 'blocks' field holds
    // it directly.
    const envelope = JSON.stringify({ v: 1, blocks: input.content })
    if (parseSubsectionContent('generic', envelope) === null) throw new HttpError(400, 'invalid_content')
    contentJson = envelope
  }

  let copyJson: string | null = null
  if (input.copy !== undefined && input.copy !== null) {
    const envelope = JSON.stringify({ v: 1, copy: input.copy })
    if (parseSubsectionCopy(envelope) === null) throw new HttpError(400, 'invalid_content')
    copyJson = envelope
  }

  // Safe to load-then-use (not re-derive-under-lock): the version guard makes
  // a concurrent same-section create conflict on the SECTION version instead
  // of racing this max (Codex fix #5).
  const maxRow = await prisma.subsectionTemplate.aggregate({
    where: { sectionTemplateId: sectionId },
    _max: { sortOrder: true },
  })
  const sortOrder = (maxRow._max.sortOrder ?? 0) + 10

  const statements: Prisma.PrismaPromise<unknown>[] = [
    prisma.sectionTemplate.update({
      where: { id: sectionId, version: input.version },
      data: { version: { increment: 1 } },
    }),
    prisma.subsectionTemplate.create({
      data: {
        sectionTemplateId: sectionId,
        subsectionKey: input.subsectionKey,
        title: input.title,
        offeringWebsite: input.offeringWebsite ?? false,
        offeringVa: input.offeringVa ?? false,
        offeringPpc: input.offeringPpc ?? false,
        copyJson,
        contentJson,
        sortOrder,
      },
    }),
  ]

  try {
    await prisma.$transaction(statements)
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') throw new HttpError(409, 'version_conflict')
      if (err.code === 'P2002') throw new HttpError(409, 'subsection_exists')
    }
    throw err
  }
}

export async function createField(
  subsectionId: number,
  input: { version: number; fieldKey: string; label: string; fieldType: string },
  updatedBy: string,
): Promise<void> {
  void updatedBy // fieldTemplate carries no updatedBy column — accepted for API-shape symmetry only
  const sub = await prisma.subsectionTemplate.findUnique({
    where: { id: subsectionId },
    select: { sectionTemplateId: true, archivedAt: true },
  })
  if (!sub) throw new HttpError(404, 'not_found')
  if (sub.archivedAt !== null) throw new HttpError(409, 'subsection_archived')

  if (!FIELD_KEY_RE.test(input.fieldKey)) throw new HttpError(400, 'invalid_key')
  if (!['text', 'textarea', 'list'].includes(input.fieldType)) throw new HttpError(400, 'invalid_content')
  if (typeof input.label !== 'string' || input.label.trim().length === 0 || input.label.length > 200) {
    throw new HttpError(400, 'invalid_content')
  }

  const maxRow = await prisma.fieldTemplate.aggregate({
    where: { subsectionTemplateId: subsectionId },
    _max: { sortOrder: true },
  })
  const sortOrder = (maxRow._max.sortOrder ?? 0) + 1

  const statements: Prisma.PrismaPromise<unknown>[] = [
    prisma.sectionTemplate.update({
      where: { id: sub.sectionTemplateId, version: input.version },
      data: { version: { increment: 1 } },
    }),
    prisma.fieldTemplate.create({
      data: {
        subsectionTemplateId: subsectionId,
        fieldKey: input.fieldKey,
        label: input.label,
        fieldType: input.fieldType,
        sortOrder,
      },
    }),
  ]

  try {
    await prisma.$transaction(statements)
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') throw new HttpError(409, 'version_conflict')
      if (err.code === 'P2002') throw new HttpError(409, 'field_key_exists')
    }
    throw err
  }
}

// fieldKey is IMMUTABLE — no fieldKey input here; the route rejects a
// fieldKey body property with 400.
export async function patchField(
  fieldId: number,
  input: { version: number; label?: string; sortOrder?: number; archived?: boolean },
  updatedBy: string,
): Promise<void> {
  void updatedBy // fieldTemplate carries no updatedBy column — accepted for API-shape symmetry only
  const field = await prisma.fieldTemplate.findUnique({
    where: { id: fieldId },
    select: { subsection: { select: { sectionTemplateId: true } } },
  })
  if (!field) throw new HttpError(404, 'not_found')

  if (input.label !== undefined) {
    if (typeof input.label !== 'string' || input.label.trim().length === 0 || input.label.length > 200) {
      throw new HttpError(400, 'invalid_content')
    }
  }
  if (input.sortOrder !== undefined && !Number.isInteger(input.sortOrder)) {
    throw new HttpError(400, 'invalid_content')
  }

  const guard = prisma.sectionTemplate.update({
    where: { id: field.subsection.sectionTemplateId, version: input.version },
    data: { version: { increment: 1 } },
  })
  const fieldUpdate = prisma.fieldTemplate.update({
    where: { id: fieldId },
    data: {
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}),
      version: { increment: 1 },
    },
  })

  await runGuarded([guard, fieldUpdate])
}

// ---- Task 5: team-photo flows (F1b) ----------------------------------------
//
// Both photo entry points call global-content's attachTeamPhoto — the ONE
// file-save/fence/delete-old authority — supplying a buildTxn that adds
// welcome/main template-envelope statements alongside the roster guard-write.
// Neither flow re-derives the roster: `ctx.next` (attachTeamPhoto's own
// computed roster with the new filename stamped in) is the single source of
// truth for what the template's `team` field becomes.

type WelcomeSubsectionContent = Extract<SubsectionContentV1, { team: TeamMember[] }>

// Corrupt/missing envelope rule (Codex fix #3, both photo paths): a valid
// parsed envelope keeps its OWN process/why (never silently replaced by the
// legacy projection); a corrupt/missing one self-heals by re-projecting the
// whole envelope from the current legacy rows via projectMainContentJson,
// with the derived roster substituted for 'team' — never a 4xx for
// corruption.
function buildWelcomeEnvelope(
  parsedWelcome: WelcomeSubsectionContent | null,
  legacyRows: SeedSourceRow[] | null,
  next: TeamMember[],
): string {
  if (parsedWelcome) {
    return JSON.stringify({ v: 1, team: next, process: parsedWelcome.process, why: parsedWelcome.why })
  }
  const rowsWithDerivedRoster: SeedSourceRow[] = [
    ...(legacyRows ?? []),
    { key: 'team', bodyJson: JSON.stringify(next) },
  ]
  // 'welcome' always returns a non-null string (projectMainContentJson's
  // switch has a defined case for it) — the `| null` return type is shared
  // with the other section keys' contentless default.
  return projectMainContentJson('welcome', rowsWithDerivedRoster, []) as string
}

// process/why legacy rows are the ONLY thing the corrupt-envelope fallback
// needs from the DB — 'team' is always overridden with the derived roster at
// buildTxn time (buildWelcomeEnvelope), so it's never queried here.
async function loadWelcomeLegacyRows(): Promise<SeedSourceRow[]> {
  return prisma.viewbookGlobalContent.findMany({
    where: { key: { in: ['process', 'why'] } },
    select: { key: true, bodyJson: true },
  })
}

function parseWelcome(contentJson: string | null): WelcomeSubsectionContent | null {
  const parsed = parseSubsectionContent('welcome', contentJson)
  return parsed && 'team' in parsed ? parsed : null
}

// Template route (HARD path — everything all-or-nothing in one txn): resolves
// sectionId to the welcome template (404 if it's some other section), 409
// template_missing only when the welcome tree row is genuinely absent (can't
// guard what isn't there). conflictCode is 'version_conflict' UNIFORMLY for
// both guards in the txn (the stale-template-version guard AND the roster
// guard-write) — a lost roster race is indistinguishable from a stale
// template token by design; the caller refetches either way.
export async function attachTemplateTeamPhoto(
  sectionId: number,
  memberName: string,
  buf: Buffer,
  updatedBy: string,
  expectedVersion: number,
): Promise<string> {
  const section = await prisma.sectionTemplate.findUnique({
    where: { id: sectionId },
    include: { subsections: { where: { subsectionKey: 'main' } } },
  })
  if (!section || section.templateKey !== 'welcome') throw new HttpError(404, 'not_found')
  const sub = section.subsections[0]
  if (!sub) throw new HttpError(409, 'template_missing')

  const parsedWelcome = parseWelcome(sub.contentJson)
  const legacyRows = parsedWelcome ? null : await loadWelcomeLegacyRows()

  return attachTeamPhoto(memberName, buf, updatedBy, {
    buildTxn: (ctx) => ({
      statements: [
        // GUARD 1: stale template version → P2025 → 409 version_conflict.
        prisma.sectionTemplate.update({
          where: { id: sectionId, version: expectedVersion },
          data: { version: { increment: 1 } },
        }),
        // GUARD 2: the Task 2 throwing roster write — a lost roster race →
        // P2025 → the SAME 409 version_conflict (module comment above).
        prisma.viewbookGlobalContent.update({
          where: { key: 'team', bodyJson: ctx.row.bodyJson },
          data: { bodyJson: JSON.stringify(ctx.next), updatedBy: ctx.updatedBy },
        }),
        // Plain — both guards above already fenced the whole txn.
        prisma.subsectionTemplate.update({
          where: { id: sub.id },
          data: {
            contentJson: buildWelcomeEnvelope(parsedWelcome, legacyRows, ctx.next),
            version: { increment: 1 },
          },
        }),
        syncVersionBumpAllStatement(),
      ],
      conflictCode: 'version_conflict',
    }),
  })
}

// Legacy route (SOFT template companion): the roster guard-write is
// default-shaped (same throwing shape attachTeamPhoto uses on its own) —
// HARD, 409 roster_conflict on a lost race. The template forward-write is
// non-throwing raw SQL fenced on the subsection's pre-state contentJson,
// ordered bump-first (section statement BEFORE the sub statement whose
// pre-state it reads — the same pattern syncVersionBumpAllWhere's callers
// use). A miss (stale pre-state, or no welcome tree at all) is drift-logged
// via `inspect`, never a throw — this route has no version token to guard
// with in the first place.
export async function attachTeamPhotoBridged(
  memberName: string,
  buf: Buffer,
  updatedBy: string,
): Promise<string> {
  const section = await prisma.sectionTemplate.findUnique({
    where: { templateKey: 'welcome' },
    include: { subsections: { where: { subsectionKey: 'main' } } },
  })
  const sub = section?.subsections[0] ?? null
  const hasTemplate = section !== null && sub !== null

  const parsedWelcome = sub ? parseWelcome(sub.contentJson) : null
  const legacyRows = hasTemplate && !parsedWelcome ? await loadWelcomeLegacyRows() : null

  return attachTeamPhoto(memberName, buf, updatedBy, {
    buildTxn: (ctx) => {
      const fence = teamRosterFence(ctx.row.bodyJson)
      const statements: Prisma.PrismaPromise<unknown>[] = [
        syncVersionBumpAllWhere(fence),
        prisma.viewbookGlobalContent.update({
          where: { key: 'team', bodyJson: ctx.row.bodyJson },
          data: { bodyJson: JSON.stringify(ctx.next), updatedBy: ctx.updatedBy },
        }),
      ]

      if (hasTemplate && section && sub) {
        const newEnvelope = buildWelcomeEnvelope(parsedWelcome, legacyRows, ctx.next)
        // Prisma.sql branch: SQLite `= NULL` never matches — a null pre-state
        // needs IS NULL, a non-null pre-state needs an exact value compare.
        const contentPredicate = sub.contentJson === null
          ? Prisma.sql`"contentJson" IS NULL`
          : Prisma.sql`"contentJson" = ${sub.contentJson}`
        statements.push(
          // Bump-first: this predicate reads SubsectionTemplate's CURRENT
          // contentJson, so it must run BEFORE the update below changes it.
          prisma.$executeRaw`UPDATE "SectionTemplate" SET "version" = "version" + 1, "updatedAt" = ${Date.now()} WHERE "id" = ${section.id} AND EXISTS (
            SELECT 1 FROM "SubsectionTemplate" WHERE "id" = ${sub.id} AND ${contentPredicate}
          )`,
          prisma.$executeRaw`UPDATE "SubsectionTemplate" SET "contentJson" = ${newEnvelope}, "version" = "version" + 1, "updatedAt" = ${Date.now()} WHERE "id" = ${sub.id} AND ${contentPredicate}`,
        )
      }

      return {
        statements,
        conflictCode: 'roster_conflict',
        // SOFT drift log only — the roster write already committed by the
        // time this runs; there is nothing left to roll back.
        inspect: (results) => {
          if (!hasTemplate) {
            logError(
              { subsystem: 'viewbook', op: 'template-forward-write-miss', reason: 'no-welcome-tree' },
              new Error('bridged team photo: welcome template tree absent'),
            )
            return
          }
          const sectionRows = results[2] as number
          const subRows = results[3] as number
          if (sectionRows === 0 || subRows === 0) {
            logError(
              { subsystem: 'viewbook', op: 'template-forward-write-miss' },
              new Error('bridged team photo: template forward-write missed a stale pre-state'),
            )
          }
        },
      }
    },
  })
}

// ---- Task 6: legacy routes forward-write through the service --------------
//
// putGlobalContentBridged / putSectionCopyGlobalBridged /
// deleteSectionCopyGlobalBridged are the three legacy write entry points
// (viewbook-content/[key], viewbook-content/team-photo's sibling text
// content, section-copy/[sectionKey]) becoming SOFT dual-writers: the legacy
// row is the HARD write (same validation/error surface as the un-bridged
// putGlobalContent/putSectionCopyGlobal/deleteSectionCopyGlobal), the
// template-tree companion is a raw-SQL fenced write that drift-logs on a miss
// but never fails the legacy commit. Same conventions as Task 5's bridged
// photo flow: fence on the PRE-state loaded before any write, bump-before-
// update ordering, Prisma.sql null-branch for SQLite `IS NULL`, manual
// integer-ms updatedAt.

// Load the OTHER bridged legacy rows for a templateKey (excluding the key
// currently being written — the caller substitutes that one with the
// just-validated value instead of the possibly-stale stored row).
async function loadOtherBridgeLegacyRows(templateKey: string, excludeKey: GlobalContentKey): Promise<SeedSourceRow[]> {
  const bridge = BRIDGED_CONTENT[templateKey]
  const keys = Object.values(bridge.parts).filter((k) => k !== excludeKey)
  if (keys.length === 0) return []
  return prisma.viewbookGlobalContent.findMany({
    where: { key: { in: keys } },
    select: { key: true, bodyJson: true },
  })
}

export interface PutGlobalContentBridgedDeps {
  // Test-only seam (mirrors PatchSubsectionDeps/AttachTeamPhotoDeps): awaited
  // between the loads (section+sub, and — for 'team' — the roster row) and
  // the $transaction, so a test can inject a rival roster write that lands in
  // the gap and prove the throwing roster guard catches it.
  beforeWrite?: () => Promise<void>
}

export async function putGlobalContentBridged(
  key: string,
  raw: unknown,
  updatedBy: string,
  deps: PutGlobalContentBridgedDeps = {},
): Promise<void> {
  const validated = validateGlobalContent(key, raw)
  if (!validated) throw new HttpError(400, 'invalid_content')
  const legacyKey = key as GlobalContentKey
  const isTeam = legacyKey === 'team'

  const target = LEGACY_KEY_TARGET[legacyKey]
  const section = target
    ? await prisma.sectionTemplate.findUnique({
        where: { templateKey: target.templateKey },
        include: { subsections: { where: { subsectionKey: 'main' } } },
      })
    : null
  const sub = section?.subsections[0] ?? null
  const hasTemplate = target !== undefined && section !== null && sub !== null

  const teamRow = isTeam ? await prisma.viewbookGlobalContent.findUnique({ where: { key: 'team' } }) : null

  if (deps.beforeWrite) await deps.beforeWrite()

  let legacyWrite: Prisma.PrismaPromise<unknown>
  let syncBump: Prisma.PrismaPromise<unknown>
  // The value substituted into the template envelope: for 'team' this is the
  // DERIVED roster (photo re-derivation, buildTeamRosterWrite), never the raw
  // incoming validated array — the same rule patchSubsection's welcome branch
  // follows.
  let substitutionValue: TeamMember[] | ContentBlocks | string = validated as ContentBlocks | string
  let orphanedPhotos: string[] = []

  if (isTeam) {
    const teamWrite = buildTeamRosterWrite(teamRow, validated as TeamMember[], updatedBy)
    legacyWrite = teamWrite.legacyWrite
    syncBump = teamWrite.syncBump
    substitutionValue = teamWrite.next
    orphanedPhotos = teamWrite.orphaned
  } else {
    const stmts = putGlobalContentStatements(legacyKey, validated as ContentBlocks | string, updatedBy)
    legacyWrite = stmts.legacyWrite
    syncBump = stmts.syncBump
  }

  const statements: Prisma.PrismaPromise<unknown>[] = [syncBump]

  if (hasTemplate && section && sub && target) {
    const parsed = parseSubsectionContent(section.rendererType, sub.contentJson)
    let newEnvelope: string
    if (parsed) {
      newEnvelope = JSON.stringify({ ...parsed, v: 1, [target.part]: substitutionValue })
    } else {
      // Corrupt/missing envelope: self-heal by re-projecting the whole
      // envelope from the CURRENT legacy rows (excluding this key, which is
      // substituted with the just-validated value) — never a 4xx for
      // template corruption.
      const otherRows = await loadOtherBridgeLegacyRows(target.templateKey, legacyKey)
      const rowsWithSubstitution: SeedSourceRow[] = [
        ...otherRows,
        { key: legacyKey, bodyJson: JSON.stringify(substitutionValue) },
      ]
      newEnvelope = projectMainContentJson(target.templateKey, rowsWithSubstitution, []) as string
    }
    // Prisma.sql branch: SQLite `= NULL` never matches — a null pre-state
    // needs IS NULL, a non-null pre-state needs an exact value compare.
    const contentPredicate = sub.contentJson === null
      ? Prisma.sql`"contentJson" IS NULL`
      : Prisma.sql`"contentJson" = ${sub.contentJson}`
    statements.push(
      // Bump-first: this predicate reads SubsectionTemplate's CURRENT
      // contentJson, so it must run BEFORE the update below changes it.
      prisma.$executeRaw`UPDATE "SectionTemplate" SET "version" = "version" + 1, "updatedAt" = ${Date.now()} WHERE "id" = ${section.id} AND EXISTS (
        SELECT 1 FROM "SubsectionTemplate" WHERE "id" = ${sub.id} AND ${contentPredicate}
      )`,
      prisma.$executeRaw`UPDATE "SubsectionTemplate" SET "contentJson" = ${newEnvelope}, "version" = "version" + 1, "updatedAt" = ${Date.now()} WHERE "id" = ${sub.id} AND ${contentPredicate}`,
    )
  }

  statements.push(legacyWrite)

  let results: unknown[]
  try {
    results = await prisma.$transaction(statements)
  } catch (err) {
    if (isTeam && err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2025' || err.code === 'P2002')) {
      // Roster conflict: the template companion rolled back with it — no
      // orphan deletion (nothing committed).
      throw new HttpError(409, 'roster_conflict')
    }
    throw err
  }

  if (orphanedPhotos.length > 0) await deleteViewbookAssets('global', orphanedPhotos)

  // SOFT drift log only — the legacy write already committed by the time
  // this runs; there is nothing left to roll back.
  if (target) {
    if (!hasTemplate) {
      logError(
        { subsystem: 'viewbook', op: 'template-forward-write-miss', reason: 'no-template-tree', templateKey: target.templateKey },
        new Error(`bridged global content: template tree absent for ${target.templateKey}`),
      )
    } else {
      const sectionRows = results[1] as number
      const subRows = results[2] as number
      if (sectionRows === 0 || subRows === 0) {
        logError(
          { subsystem: 'viewbook', op: 'template-forward-write-miss', templateKey: target.templateKey },
          new Error('bridged global content: template forward-write missed a stale pre-state'),
        )
      }
    }
  }
}

export async function putSectionCopyGlobalBridged(sectionKey: string, raw: unknown, updatedBy: string): Promise<void> {
  if (!isSectionKey(sectionKey)) throw new HttpError(400, 'invalid_content')
  const validated = validateSectionCopy(raw)
  if (validated === null) throw new HttpError(400, 'invalid_content')

  const { legacyWrite, syncBump } = putSectionCopyGlobalStatements(sectionKey, validated, updatedBy)
  // Unfenced soft companion (legacy last-writer-wins) — mirrors patchSectionTemplate's guarded template write in reverse.
  const templateUpdate = prisma.sectionTemplate.updateMany({
    where: { templateKey: sectionKey },
    data: { copyJson: JSON.stringify({ v: 1, copy: validated }), version: { increment: 1 } },
  })

  const results = await prisma.$transaction([legacyWrite, syncBump, templateUpdate])
  const templateCount = (results[2] as { count: number }).count
  if (templateCount === 0) {
    logError(
      { subsystem: 'viewbook', op: 'template-forward-write-miss', templateKey: sectionKey },
      new Error(`bridged section copy: template row missing for ${sectionKey}`),
    )
  }
}

export async function deleteSectionCopyGlobalBridged(sectionKey: string): Promise<void> {
  if (!isSectionKey(sectionKey)) throw new HttpError(400, 'invalid_content')

  const { fence, syncBump, deleteStmt } = deleteSectionCopyGlobalStatements(sectionKey)
  // Delete means "revert to code default" in the resolve chain
  // (resolveSectionCopy falls through to SECTION_COPY when neither the
  // legacy row nor an override exists) — so the template reset writes the
  // CODE DEFAULT envelope, sharing the delete's EXISTS pre-state fence (the
  // ONE surviving raw cross-table fence: both statements share `fence`,
  // placed BEFORE the deleteMany so it still sees the row).
  const codeDefault = SECTION_COPY[sectionKey]
  const templateEnvelope = JSON.stringify({
    v: 1,
    copy: { purpose: codeDefault.purpose, whatThis: codeDefault.whatThis, whatWeNeed: codeDefault.whatWeNeed },
  })
  const templateReset = prisma.$executeRaw`UPDATE "SectionTemplate" SET "copyJson" = ${templateEnvelope}, "version" = "version" + 1, "updatedAt" = ${Date.now()} WHERE "templateKey" = ${sectionKey} AND (${fence})`

  const results = await prisma.$transaction([syncBump, templateReset, deleteStmt])
  const templateCount = results[1] as number
  const deleteResult = results[2] as { count: number }
  if (deleteResult.count === 0) throw new HttpError(404, 'not_found')
  if (templateCount === 0) {
    logError(
      { subsystem: 'viewbook', op: 'template-forward-write-miss', templateKey: sectionKey },
      new Error(`bridged section copy delete: template reset missed for ${sectionKey}`),
    )
  }
}

// ---- Task 7: one-time F1b activation reconciliation (spec fix #1) ---------
//
// The F1a seeder (template-seed.ts) only creates a tree when its templateKey
// row is ABSENT — it never touches a tree that already exists. That's correct
// steady-state behavior (operator edits win), but it leaves a gap for the
// F1a→F1b activation window: a legacy edit landing via the un-bridged routes
// (putGlobalContentBridged etc. didn't exist yet) is invisible to a tree
// that was already seeded from the OLD (pre-edit) legacy rows. This function
// runs ONCE at boot (marker-guarded) to re-project every still-untouched
// (version===1 everywhere) tree from the CURRENT legacy rows, so any
// window edit is absorbed exactly once. Trees an operator has since touched
// (any version > 1 anywhere in the subtree) are left alone — this is
// defensive, not expected to fire in practice.
export const RECONCILE_MARKER_KEY = 'template-library:reconciled'

export interface ReconcileSeededTemplatesDeps {
  // Test-only crash-window seam (Codex fix #8): awaited AFTER all tree
  // reprojection and BEFORE the marker row is created, so a test can force a
  // failure there and prove the whole pass safely re-runs (converges) on the
  // next boot.
  beforeMarker?: () => Promise<void>
}

export async function reconcileSeededTemplates(deps: ReconcileSeededTemplatesDeps = {}): Promise<void> {
  const marker = await prisma.viewbookGlobalContent.findUnique({ where: { key: RECONCILE_MARKER_KEY } })
  if (marker) return // already reconciled — never again

  const [globalRows, sectionCopyRows] = await Promise.all([
    prisma.viewbookGlobalContent.findMany({
      where: { key: { in: [...GLOBAL_CONTENT_KEYS] } },
      select: { key: true, bodyJson: true },
    }),
    prisma.viewbookGlobalContent.findMany({
      where: { key: { in: SECTION_KEYS.map(sectionCopyKey) } },
      select: { key: true, bodyJson: true },
    }),
  ])

  const { trees, issues } = projectTemplateSeedWithIssues(globalRows, sectionCopyRows)
  for (const issue of issues) {
    logError(
      { subsystem: 'viewbook', op: 'template-reconcile', key: issue.key, reason: issue.reason },
      new Error(`viewbook reconcile source ${issue.reason}: ${issue.key}`),
    )
  }

  for (const tree of trees) {
    const existing = await prisma.sectionTemplate.findUnique({
      where: { templateKey: tree.templateKey },
      include: { subsections: { include: { fields: true } } },
    })

    if (!existing) {
      // The boot seeder runs before this — a missing row only happens after a
      // manual deletion. Still correct to create it fresh.
      await createSeedTree(tree)
      continue
    }

    const untouched =
      existing.version === 1 &&
      existing.subsections.every((sub) => sub.version === 1 && sub.fields.every((f) => f.version === 1))
    if (!untouched) continue // operator-edited (or partially so) — skip, defensive

    // Overwrite: delete THEN create in one array-form txn (never interactive)
    // so the global fieldKey uniques (CATALOG defKeys) can't collide with the
    // about-to-be-recreated row's own fields.
    await prisma.$transaction([
      prisma.sectionTemplate.delete({ where: { templateKey: tree.templateKey } }),
      prisma.sectionTemplate.create({ data: seedTreeCreateData(tree) }),
    ])
  }

  await deps.beforeMarker?.()

  try {
    await prisma.viewbookGlobalContent.create({
      data: {
        key: RECONCILE_MARKER_KEY,
        bodyJson: JSON.stringify({ v: 1, reconciledAt: new Date().toISOString() }),
        updatedBy: 'system',
      },
    })
  } catch (err) {
    // A concurrent boot won the marker race — fine, tolerate it.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err
  }
}
