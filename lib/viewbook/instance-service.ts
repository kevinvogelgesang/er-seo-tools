// F2 (Task 4): instance content mutations + the single-bump aggregate fence
// (spec §4/§9). ViewbookSection.version is the AGGREGATE content-tree fence:
// EVERY content/copy/title mutation of the section OR its subsections, and
// every structural field op (create/archive), bumps it in the SAME array
// txn — pull (Task 5) fences on it so a subsection edit racing a pull 409s
// instead of being silently overwritten. Answer-VALUE writes never bump it.
//
// The section's OWN guarded update (patchSectionInstance) IS the bump when
// the section row itself is the target — never a second statement double-
// incrementing (Codex fix #7, carried from the template-service precedent).
// patchSubsectionInstance's txn adds EXACTLY ONE owning-section bump via
// bumpSectionAggregateGuarded (throwing — P2025 on a miss, never a silent
// zero-row no-op).
//
// Array-form $transaction([...]) only — NEVER interactive
// $transaction(async tx => ...).
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { HttpError } from '@/lib/api/errors'
import { logError } from '@/lib/log'
import { validateSectionCopy, type SectionCopyContent } from './section-copy-validator'
import { parseSubsectionCopy, parseSubsectionContent } from './template-content'
import { isPlainObject } from './content-validators'
import { syncVersionBumpStatement } from './sync'
import { loadTemplateTreeRaw } from './template-service'
import { projectSectionInstance, type SubsectionInstanceInput } from './instance-snapshot'
import { extractInstanceAssetRefs } from './instance-asset-refs'
import { deleteViewbookAssets, readViewbookAsset, saveViewbookAsset } from './assets'

function isP2025(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025'
}

const TITLE_MAX_CHARS = 200

function validateTitle(title: unknown): string {
  if (typeof title !== 'string' || title.trim().length === 0 || title.length > TITLE_MAX_CHARS) {
    throw new HttpError(400, 'invalid_content')
  }
  return title
}

/**
 * The ONE reusable aggregate-bump statement: a guarded (extended-where-
 * unique) `ViewbookSection.update` scoped to BOTH `id` and `viewbookId` (the
 * composite-FK tenant fence, Codex fix #1) — throws P2025 on a miss (wrong
 * tenant, or the section row genuinely absent) rather than a silent no-op.
 * Callers place it in the SAME array txn as the mutation that earns the
 * bump; if that mutation's own guard throws first, the whole txn rolls back
 * and this statement never commits either (array-txn atomicity).
 */
export function bumpSectionAggregateGuarded(sectionId: number, viewbookId: number): Prisma.PrismaPromise<unknown> {
  return prisma.viewbookSection.update({
    where: { id_viewbookId: { id: sectionId, viewbookId } },
    data: { version: { increment: 1 } },
  })
}

export interface PatchSectionInstanceInput {
  version: number
  title?: string
  copy?: unknown
}

/**
 * PATCH the section INSTANCE's title/copy. The guarded update's own
 * `version: {increment:1}` on the fenced row IS the aggregate bump — no
 * separate bumpSectionAggregateGuarded call here (that would double-count).
 * Every instance mutation bumps the viewbook's scoped syncVersion (§10 —
 * unlike the template bridge's title-only skip, F2 instance edits ALWAYS
 * bump sync since rendering reads instance rows directly).
 */
export async function patchSectionInstance(
  viewbookId: number,
  sectionKey: string,
  input: PatchSectionInstanceInput,
  updatedBy: string,
): Promise<void> {
  void updatedBy // ViewbookSection carries no updatedBy column — accepted for API-shape symmetry
  if (input.title === undefined && input.copy === undefined) throw new HttpError(400, 'invalid_content')

  const title = input.title !== undefined ? validateTitle(input.title) : undefined

  let validatedCopy: SectionCopyContent | null = null
  if (input.copy !== undefined) {
    validatedCopy = validateSectionCopy(input.copy)
    if (validatedCopy === null) throw new HttpError(400, 'invalid_content')
  }

  const section = await prisma.viewbookSection.findUnique({
    where: { viewbookId_sectionKey: { viewbookId, sectionKey } },
    select: { id: true },
  })
  if (!section) throw new HttpError(404, 'not_found')

  const guardedUpdate = prisma.viewbookSection.update({
    // extendedWhereUnique filter — P2025 on stale (precedent: template-service.ts patchSectionTemplate)
    where: { id: section.id, version: input.version },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(validatedCopy ? { copyJson: JSON.stringify({ v: 1, copy: validatedCopy }) } : {}),
      version: { increment: 1 },
    },
  })

  try {
    await prisma.$transaction([guardedUpdate, syncVersionBumpStatement(viewbookId)])
  } catch (err) {
    if (isP2025(err)) throw new HttpError(409, 'version_conflict')
    throw err
  }
}

export interface PatchSubsectionInstanceInput {
  version: number
  title?: string
  copy?: unknown | null
  content?: unknown | null
}

/**
 * PATCH the subsection INSTANCE's title/copy/content. Fenced on the
 * subsection's OWN version; the same txn bumps the owning section's
 * aggregate version EXACTLY once (bumpSectionAggregateGuarded) plus the
 * viewbook's scoped syncVersion.
 *
 * Content validation: the subsection's renderer context comes from its
 * OWNING SECTION's rendererType (spec §9) — `parseSubsectionContent` returns
 * null for any non-null content on a rendererType with no defined subsection-
 * content shape (every renderer besides welcome/strategy/milestones/pc-intro/
 * generic), which is exactly right for F2's current topology: every section
 * has a single 'main' subsection carrying that section's bridged content (or
 * none), and 'data-source's category subsections carry fields, never content.
 * Operator-created 'generic' subsections are out of scope until subsection
 * creation ships (F5b) — this function does not need to special-case them.
 */
export async function patchSubsectionInstance(
  viewbookId: number,
  subId: number,
  input: PatchSubsectionInstanceInput,
  updatedBy: string,
): Promise<void> {
  void updatedBy // ViewbookSubsection carries no updatedBy column — accepted for API-shape symmetry
  if (input.title === undefined && input.copy === undefined && input.content === undefined) {
    throw new HttpError(400, 'invalid_content')
  }

  const title = input.title !== undefined ? validateTitle(input.title) : undefined

  const sub = await prisma.viewbookSubsection.findUnique({
    where: { id_viewbookId: { id: subId, viewbookId } },
    select: { id: true, sectionId: true, section: { select: { rendererType: true } } },
  })
  if (!sub) throw new HttpError(404, 'not_found')

  // Fix round 1 (Codex review, Finding 2): persist the PARSER'S normalized
  // return value, not the raw request input — matches patchSectionInstance's
  // validatedCopy precedent. parseSubsectionCopy/parseSubsectionContent are
  // more than validity gates: they trim/lowercase emails (canonicalMailbox,
  // via validateTeam) and blank-to-null copy fields (norm()). Storing the raw
  // input would silently drop that normalization.
  let copyJson: string | null | undefined // undefined = field absent from the patch
  if (input.copy !== undefined) {
    if (input.copy === null) {
      copyJson = null
    } else {
      const envelope = JSON.stringify({ v: 1, copy: input.copy })
      const validated = parseSubsectionCopy(envelope)
      if (validated === null) throw new HttpError(400, 'invalid_content')
      copyJson = JSON.stringify(validated)
    }
  }

  let contentJson: string | null | undefined
  if (input.content !== undefined) {
    if (input.content === null) {
      contentJson = null
    } else {
      if (!isPlainObject(input.content)) throw new HttpError(400, 'invalid_content')
      const envelope = JSON.stringify({ v: 1, ...input.content })
      const validated = parseSubsectionContent(sub.section.rendererType, envelope)
      if (validated === null) throw new HttpError(400, 'invalid_content')
      contentJson = JSON.stringify(validated)
    }
  }

  const guardedSubsectionUpdate = prisma.viewbookSubsection.update({
    where: { id: subId, version: input.version },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(copyJson !== undefined ? { copyJson } : {}),
      ...(contentJson !== undefined ? { contentJson } : {}),
      version: { increment: 1 },
    },
  })

  try {
    await prisma.$transaction([
      guardedSubsectionUpdate,
      bumpSectionAggregateGuarded(sub.sectionId, viewbookId),
      syncVersionBumpStatement(viewbookId),
    ])
  } catch (err) {
    if (isP2025(err)) throw new HttpError(409, 'version_conflict')
    throw err
  }
}

// ---------------------------------------------------------------------------
// Pull — versioned per-section template merge (spec §6, Task 5)
// ---------------------------------------------------------------------------

export interface PullSummary {
  subsectionsAdded: number
  subsectionsUpdated: number
  subsectionsArchived: number
  fieldsAdded: number
  fieldsUpdated: number
  fieldsArchived: number
}

export interface PullDeps {
  // Test-only injection point: awaited between statement-build and the
  // $transaction so races against the aggregate fence are deterministic
  // (Codex fix #8; house DI precedent — team-members/answers beforeCommit).
  beforeCommit?: () => Promise<void>
}

// The instance-side effective renderer convention (mirrors instance-snapshot's
// template-side rule): the ONE 'main' subsection carries the section's own
// rendererType; everything else is 'generic'. Only 'welcome' yields asset refs.
function instanceEffectiveRenderer(sectionRendererType: string, subsectionKey: string): string {
  return subsectionKey === 'main' ? sectionRendererType : 'generic'
}

// Rewrite a projected (photo-null-stripped) welcome roster contentJson with the
// freshly-copied instance-scope filenames, keyed by member name — the same
// member mapping snapshotInstanceAssets applies in §5 phase 2, but in-memory
// BEFORE the txn so the transaction writes final content (spec §6 mechanics).
function rewriteRosterPhotos(contentJson: string | null, photoByMember: Map<string, string>): string | null {
  if (contentJson === null || photoByMember.size === 0) return contentJson
  let parsed: unknown
  try {
    parsed = JSON.parse(contentJson)
  } catch {
    return contentJson
  }
  if (!isPlainObject(parsed) || parsed.v !== 1 || !Array.isArray(parsed.team)) return contentJson
  const team = parsed.team.map((member) => {
    if (!isPlainObject(member) || typeof member.name !== 'string') return member
    const filename = photoByMember.get(member.name)
    return filename === undefined ? member : { ...member, photo: filename }
  })
  return JSON.stringify({ ...parsed, team })
}

/**
 * Pull "update to current template version" for ONE section instance —
 * a versioned MERGE, never a wipe (spec §6). The request's `expectedVersion`
 * is fenced against the section's AGGREGATE content-tree version by the ONE
 * throwing guarded section update (the only section-row bump in the txn); any
 * concurrent subsection/field content mutation invalidates the pull with a
 * 409 instead of being silently overwritten.
 *
 * Merge rules implemented here (§6, binding):
 * - Section scalars ← template; templateVersion ← current template version;
 *   state/introNote/narrative/acknowledgedAt/doneAt NEVER touched.
 * - Subsections diffed by subsectionKey vs the template's ACTIVE subsections
 *   filtered to the viewbook's enabled offerings; both-sides overwrite +
 *   restore, template-only snapshot-create (fields ride the global field
 *   loop, not a nested create — an existing defKey elsewhere in the viewbook
 *   must MERGE, not P2002), instance-only LIVE rows archive 'pull' (already-
 *   archived rows keep their provenance — an 'offering' archive must stay
 *   restorable by §7's re-enable). ZERO active matches after the filter →
 *   archive every live subsection AND the section itself ('pull'); not an
 *   error.
 * - Fields matched by defKey VIEWBOOK-GLOBALLY (the @@unique join): existing
 *   rows relabel/reorder/re-parent via raw UPDATE with a durable-key
 *   subselect (in-txn ID addressing, Codex fix #3), clearing archives unless
 *   archiveReason 'operator'; value, version, valueUpdated fields, and
 *   amendments NEVER touched. Missing rows INSERT…SELECT (createdBy 'pull', version 0, value
 *   NULL). This-section fields whose defKey has no active FieldTemplate in
 *   the offering-filtered template section archive 'pull' — with the
 *   OWNERSHIP predicate (a stale pull of section A must not archive a field
 *   a concurrent pull already moved to section B). Custom fields (defKey
 *   null) untouched; fieldType never changed.
 * - Assets: template roster files pre-copied into viewbook scope BEFORE the
 *   txn (member-mapped, §5 plan shape); contentJson rewritten in-memory so
 *   the txn writes final content. Txn loss → the NEW files are deleted.
 *   Post-commit, REPLACED instance files are deleted only when absent from
 *   the whole-viewbook reference union (ALL subsections incl. archived —
 *   Codex fix #8c).
 *
 * NOTE: ViewbookField has NO updatedAt column — raw field statements set
 * none (the manual-updatedAt house rule applies only where the column
 * exists). ViewbookSubsection raw INSERTs set createdAt/updatedAt manually
 * (integer ms — raw SQL bypasses @updatedAt).
 */
export async function pullSectionFromTemplate(
  viewbookId: number,
  sectionKey: string,
  expectedVersion: number,
  updatedBy: string,
  deps: PullDeps = {},
) {
  void updatedBy // no updatedBy column on the instance rows — API-shape symmetry
  const section = await prisma.viewbookSection.findUnique({
    where: { viewbookId_sectionKey: { viewbookId, sectionKey } },
    include: { subsections: { orderBy: { id: 'asc' } } },
  })
  if (!section) throw new HttpError(404, 'not_found')
  if (section.sectionTemplateId === null) throw new HttpError(409, 'template_missing')

  const viewbook = await prisma.viewbook.findUnique({
    where: { id: viewbookId },
    select: { offeringWebsite: true, offeringVa: true, offeringPpc: true },
  })
  if (!viewbook) throw new HttpError(404, 'not_found')
  const offerings = { website: viewbook.offeringWebsite, va: viewbook.offeringVa, ppc: viewbook.offeringPpc }

  // loadTemplateTreeRaw returns archived sections too — we need the row even
  // when archived, to answer with the honest 409.
  const rawTree = await loadTemplateTreeRaw()
  const tpl = rawTree.find((s) => s.id === section.sectionTemplateId)
  if (!tpl) throw new HttpError(409, 'template_missing') // FK SetNull makes this near-impossible; defensive
  if (tpl.archivedAt !== null) throw new HttpError(409, 'template_archived')

  // Pure projection (Task 3's single home): active subsections filtered to the
  // enabled offerings, active fields, welcome roster photos null-stripped with
  // the member-mapped assetPlan. null ⇔ ZERO active matches after the filter
  // (tpl.archivedAt was checked above) — the archive-everything branch.
  const projected = projectSectionInstance(tpl, offerings)
  const targetSubs: SubsectionInstanceInput[] = projected?.section.subsections ?? []
  const emptyAfterFilter = projected === null

  // ---- asset pre-copy (before the txn; §6 mechanics) ------------------------
  const scope = String(viewbookId)
  const newFiles: string[] = []
  const finalContentBySubKey = new Map<string, string | null>()
  for (const sub of targetSubs) finalContentBySubKey.set(sub.subsectionKey, sub.contentJson)
  try {
    for (const entry of projected?.assetPlan ?? []) {
      const photoByMember = new Map<string, string>()
      for (const ref of entry.refs) {
        const source = await readViewbookAsset('global', ref.filename)
        if (source === null) {
          // Honest degrade (§8): the member's photo stays null.
          logError(
            { subsystem: 'viewbook', op: 'pull-asset-copy', viewbookId, sectionKey, filename: ref.filename },
            new Error('pull asset source file missing'),
          )
          continue
        }
        const { filename } = await saveViewbookAsset(scope, source.buf)
        newFiles.push(filename)
        photoByMember.set(ref.memberName, filename)
      }
      finalContentBySubKey.set(
        entry.subsectionKey,
        rewriteRosterPhotos(finalContentBySubKey.get(entry.subsectionKey) ?? null, photoByMember),
      )
    }
  } catch (err) {
    await deleteViewbookAssets(scope, newFiles)
    throw err
  }

  // ---- pure merge diff -------------------------------------------------------
  const instanceByKey = new Map(section.subsections.map((s) => [s.subsectionKey, s]))
  const targetKeys = new Set(targetSubs.map((s) => s.subsectionKey))

  const matched = targetSubs.filter((s) => instanceByKey.has(s.subsectionKey))
  const toCreate = targetSubs.filter((s) => !instanceByKey.has(s.subsectionKey))
  // Only LIVE instance-only subsections archive; an already-archived row keeps
  // its provenance (archiveReason 'offering' must stay §7-restorable).
  const toArchive = section.subsections.filter((s) => !targetKeys.has(s.subsectionKey) && s.archivedAt === null)

  // The template field set for BOTH the update/insert and the archive rules is
  // the OFFERING-FILTERED active set (targetSubs): a field under a
  // non-matching subsection has no instance subsection to re-parent onto (the
  // durable-key subselect would NULL-violate), so it archives with the rest —
  // the merge makes the instance mirror the offering-filtered template.
  const tplFields = targetSubs.flatMap((sub) =>
    sub.fields.map((f) => ({ subKey: sub.subsectionKey, ...f })),
  )
  const tplFieldKeys = new Set(tplFields.map((f) => f.defKey))

  const sectionSubIds = section.subsections.map((s) => s.id)
  const thisSectionFields =
    sectionSubIds.length === 0
      ? []
      : await prisma.viewbookField.findMany({
          where: { viewbookId, subsectionId: { in: sectionSubIds } },
          select: { id: true, defKey: true, archivedAt: true },
        })
  const existingByDefKey =
    tplFields.length === 0
      ? []
      : await prisma.viewbookField.findMany({
          where: { viewbookId, defKey: { in: tplFields.map((f) => f.defKey) } },
          select: { defKey: true },
        })
  const existingDefKeys = new Set(existingByDefKey.map((f) => f.defKey))

  const fieldUpdates = tplFields.filter((f) => existingDefKeys.has(f.defKey))
  const fieldInserts = tplFields.filter((f) => !existingDefKeys.has(f.defKey))
  // Archive: this-section LIVE defKey'd fields whose defKey left the template
  // set. archivedAt IS NULL keeps existing archive provenance intact
  // ('operator' rows are archived, so they're excluded here by construction).
  const fieldArchiveKeys = [
    ...new Set(
      thisSectionFields
        .filter((f) => f.defKey !== null && f.archivedAt === null && !tplFieldKeys.has(f.defKey))
        .map((f) => f.defKey as string),
    ),
  ]

  // Replaced-file candidates: refs the UPDATED subsections' current content
  // holds (evaluated under the OLD rendererType — that is what the stored
  // content was written as).
  const oldRefs = new Set<string>()
  for (const sub of matched) {
    const inst = instanceByKey.get(sub.subsectionKey)!
    for (const ref of extractInstanceAssetRefs(
      instanceEffectiveRenderer(section.rendererType, inst.subsectionKey),
      inst.contentJson,
    )) {
      oldRefs.add(ref)
    }
  }

  // ---- statements (ONE array-form txn; NEVER interactive) --------------------
  const now = Date.now()
  const archiveDate = new Date(now)

  // The ONE section-row bump: throwing guarded update fenced on the AGGREGATE
  // version (extendedWhereUnique — P2025 on stale). Also the empty-after-filter
  // section archive / non-empty restore seam.
  const guardedSectionUpdate = prisma.viewbookSection.update({
    where: { id: section.id, version: expectedVersion },
    data: {
      title: tpl.title,
      rendererType: tpl.rendererType,
      copyJson: tpl.copyJson,
      contentJson: tpl.contentJson,
      templateVersion: tpl.version,
      version: { increment: 1 },
      ...(emptyAfterFilter
        ? { archivedAt: archiveDate, archiveReason: 'pull' }
        : { archivedAt: null, archiveReason: null }),
    },
  })

  const subUpdateStmts = matched.map((sub) => {
    const inst = instanceByKey.get(sub.subsectionKey)!
    return prisma.viewbookSubsection.update({
      where: { id_viewbookId: { id: inst.id, viewbookId } },
      data: {
        subsectionTemplateId: sub.subsectionTemplateId, // re-pin snapshot provenance at pull time
        title: sub.title,
        copyJson: sub.copyJson,
        contentJson: finalContentBySubKey.get(sub.subsectionKey) ?? null,
        offeringWebsite: sub.offeringWebsite,
        offeringVa: sub.offeringVa,
        offeringPpc: sub.offeringPpc,
        version: { increment: 1 },
        archivedAt: null,
        archiveReason: null,
      },
    })
  })

  // Raw INSERT (not a nested Prisma create): all scalars are known, and the
  // new row's fields ride the defKey-global field loop below.
  const subInsertStmts = toCreate.map(
    (sub) => prisma.$executeRaw`
      INSERT INTO "ViewbookSubsection"
        ("viewbookId", "sectionId", "subsectionTemplateId", "subsectionKey", "title",
         "offeringWebsite", "offeringVa", "offeringPpc", "copyJson", "contentJson",
         "sortOrder", "version", "createdAt", "updatedAt")
      VALUES (${viewbookId}, ${section.id}, ${sub.subsectionTemplateId}, ${sub.subsectionKey}, ${sub.title},
        ${sub.offeringWebsite ? 1 : 0}, ${sub.offeringVa ? 1 : 0}, ${sub.offeringPpc ? 1 : 0},
        ${sub.copyJson}, ${finalContentBySubKey.get(sub.subsectionKey) ?? null},
        ${sub.sortOrder}, 1, ${now}, ${now})`,
  )

  const subArchiveStmts = toArchive.map((inst) =>
    prisma.viewbookSubsection.update({
      where: { id_viewbookId: { id: inst.id, viewbookId } },
      data: { archivedAt: archiveDate, archiveReason: 'pull' },
    }),
  )

  // Existing fields: relabel/reorder/re-parent by durable-key subselect; the
  // viewbook-global defKey WHERE is the cross-section-restore reach (spec §6);
  // archives clear unless operator-stamped. value/version/valueUpdated*/
  // amendments are deliberately absent from the SET list.
  const fieldUpdateStmts = fieldUpdates.map(
    (tf) => prisma.$executeRaw`
      UPDATE "ViewbookField" SET
        "subsectionId" = (SELECT s."id" FROM "ViewbookSubsection" s
          WHERE s."viewbookId" = ${viewbookId} AND s."sectionId" = ${section.id} AND s."subsectionKey" = ${tf.subKey}),
        "category" = ${tf.subKey},
        "label" = ${tf.label},
        "sortOrder" = ${tf.sortOrder},
        "archivedAt" = CASE WHEN "archiveReason" = 'operator' THEN "archivedAt" ELSE NULL END,
        "archiveReason" = CASE WHEN "archiveReason" = 'operator' THEN "archiveReason" ELSE NULL END
      WHERE "viewbookId" = ${viewbookId} AND "defKey" = ${tf.defKey}`,
  )

  const fieldInsertStmts = fieldInserts.map(
    (tf) => prisma.$executeRaw`
      INSERT INTO "ViewbookField"
        ("viewbookId", "subsectionId", "defKey", "category", "label", "fieldType",
         "sortOrder", "value", "version", "createdBy", "createdAt")
      SELECT ${viewbookId}, s."id", ${tf.defKey}, ${tf.subKey}, ${tf.label}, ${tf.fieldType},
        ${tf.sortOrder}, NULL, 0, 'pull', ${now}
      FROM "ViewbookSubsection" s
      WHERE s."viewbookId" = ${viewbookId} AND s."sectionId" = ${section.id} AND s."subsectionKey" = ${tf.subKey}`,
  )

  // OWNERSHIP predicate (spec §6): only rows whose CURRENT subsection belongs
  // to THIS section are in reach — a field a concurrent pull moved to another
  // section must not be archived by this (now stale-loaded) pass.
  const fieldArchiveStmts = fieldArchiveKeys.map(
    (defKey) => prisma.$executeRaw`
      UPDATE "ViewbookField" SET "archivedAt" = ${now}, "archiveReason" = 'pull'
      WHERE "viewbookId" = ${viewbookId} AND "defKey" = ${defKey}
        AND "archivedAt" IS NULL
        AND "subsectionId" IN (SELECT "id" FROM "ViewbookSubsection" WHERE "sectionId" = ${section.id})`,
  )

  let results: unknown[]
  try {
    await deps.beforeCommit?.()
    results = await prisma.$transaction([
      guardedSectionUpdate, // throwing fence FIRST (house pattern)
      ...subUpdateStmts,
      ...subInsertStmts, // before the field statements — their subselects resolve these rows
      ...subArchiveStmts,
      ...fieldUpdateStmts,
      ...fieldInsertStmts,
      ...fieldArchiveStmts,
      syncVersionBumpStatement(viewbookId),
    ])
  } catch (err) {
    // Txn loss (or beforeCommit throw): the freshly-copied files are orphans.
    await deleteViewbookAssets(scope, newFiles)
    if (isP2025(err)) throw new HttpError(409, 'version_conflict')
    throw err
  }

  // ---- summary (raw counts for the field statements — 0-row archives mean
  // the ownership predicate declined a concurrently-moved row) ---------------
  const base = 1 + subUpdateStmts.length + subInsertStmts.length + subArchiveStmts.length
  const sumAt = (offset: number, length: number) => {
    let total = 0
    for (let i = 0; i < length; i++) total += results[offset + i] as number
    return total
  }
  const summary: PullSummary = {
    subsectionsAdded: subInsertStmts.length,
    subsectionsUpdated: subUpdateStmts.length,
    subsectionsArchived: subArchiveStmts.length,
    fieldsUpdated: sumAt(base, fieldUpdateStmts.length),
    fieldsAdded: sumAt(base + fieldUpdateStmts.length, fieldInsertStmts.length),
    fieldsArchived: sumAt(base + fieldUpdateStmts.length + fieldInsertStmts.length, fieldArchiveStmts.length),
  }

  // ---- post-commit replacement deletes (Codex fix #8c) -----------------------
  // A replaced filename dies ONLY when the complete post-commit reference
  // union of the WHOLE viewbook (all subsections, archived included) no
  // longer holds it. Best-effort — a failure here never fails the pull.
  if (oldRefs.size > 0) {
    try {
      const allSubs = await prisma.viewbookSubsection.findMany({
        where: { viewbookId },
        select: { subsectionKey: true, contentJson: true, section: { select: { rendererType: true } } },
      })
      const union = new Set<string>()
      for (const sub of allSubs) {
        for (const ref of extractInstanceAssetRefs(
          instanceEffectiveRenderer(sub.section.rendererType, sub.subsectionKey),
          sub.contentJson,
        )) {
          union.add(ref)
        }
      }
      const toDelete = [...oldRefs].filter((f) => !union.has(f))
      if (toDelete.length > 0) await deleteViewbookAssets(scope, toDelete)
    } catch (err) {
      logError({ subsystem: 'viewbook', op: 'pull-replaced-asset-sweep', viewbookId, sectionKey }, err)
    }
  }

  const refreshed = await prisma.viewbookSection.findUniqueOrThrow({
    where: { viewbookId_sectionKey: { viewbookId, sectionKey } },
    include: {
      subsections: {
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        include: { fields: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
      },
    },
  })

  return { summary, section: refreshed }
}
