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
import { validateSectionCopy, type SectionCopyContent } from './section-copy-validator'
import { parseSubsectionCopy, parseSubsectionContent } from './template-content'
import { isPlainObject } from './content-validators'
import { syncVersionBumpStatement } from './sync'

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

  let contentJson: string | null | undefined
  if (input.content !== undefined) {
    if (input.content === null) {
      contentJson = null
    } else {
      if (!isPlainObject(input.content)) throw new HttpError(400, 'invalid_content')
      const envelope = JSON.stringify({ v: 1, ...input.content })
      if (parseSubsectionContent(sub.section.rendererType, envelope) === null) {
        throw new HttpError(400, 'invalid_content')
      }
      contentJson = envelope
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
