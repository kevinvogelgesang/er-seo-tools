// PR/UX-pass Task 4 (Lane 4): operator-authored assessment notes + images —
// the persistence core behind the assessment-tab rich-text editor and
// user-behaviour image gallery. Server-only.
//
// Fencing discipline (mirrors docs.ts's file-write/DB-stamp/orphan-cleanup
// flow + sync.ts's predicate-sharing contract):
// - `assessmentPredicate(viewbookId)` is the ONE self-contained EXISTS
//   predicate proving the viewbook exists AND its client is not archived.
//   Every mutation's `syncVersionBumpWhere` rides this same predicate; the
//   deleteMany domain write expresses the equivalent condition via a typed
//   nested relation filter (Prisma can't add extra WHERE clauses to an
//   `upsert`, so those writes are additionally guarded by an upfront
//   `assertViewbookActive` check — the same discipline `assignViewbookCsm`/
//   `createMilestone` use in service.ts).
// - `addAssessmentImage` CANNOT read a freshly-created content row's id
//   between array-txn statements (interactive transactions are banned
//   repo-wide), so the image is created via the upsert's NESTED `images:
//   { create: … }` on both the `create` and `update` branches — never a
//   separate statement referencing a prior statement's id.
// - Reads re-sanitize both HTML bodies before returning (defense against a
//   sanitizer-version change since the row was written).

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { HttpError } from '@/lib/api/errors'
import { sanitizeRichText } from '@/lib/richtext/sanitize'
import { deleteViewbookAssets, saveViewbookAsset } from './assets'
import { syncVersionBumpWhere } from './sync'
import type { PublicAssessmentImage, PublicAssessmentNotes } from './public-types'

export type AssessmentNoteField = 'general' | 'userBehaviour'

const FIELD_COLUMN = {
  general: 'generalNotesHtml',
  userBehaviour: 'userBehaviourHtml',
} as const satisfies Record<AssessmentNoteField, string>

// Self-contained: owns its own aliases, never references another
// statement's scope (sync.ts's predicate contract).
function assessmentPredicate(viewbookId: number): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1
    FROM "Viewbook" AS "vb_assess"
    JOIN "Client" AS "client_assess" ON "client_assess"."id" = "vb_assess"."clientId"
    WHERE "vb_assess"."id" = ${viewbookId} AND "client_assess"."archivedAt" IS NULL
  )`
}

async function assertViewbookActive(viewbookId: number): Promise<void> {
  const viewbook = await prisma.viewbook.findUnique({
    where: { id: viewbookId },
    select: { client: { select: { archivedAt: true } } },
  })
  if (!viewbook) throw new HttpError(404, 'not_found')
  if (viewbook.client.archivedAt) throw new HttpError(409, 'client_archived')
}

export async function loadAssessmentNotes(viewbookId: number): Promise<PublicAssessmentNotes | null> {
  const content = await prisma.viewbookAssessmentContent.findUnique({
    where: { viewbookId },
    select: {
      generalNotesHtml: true,
      userBehaviourHtml: true,
      images: {
        select: { id: true, filename: true, sortOrder: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      },
    },
  })
  if (!content) return null

  const userBehaviourImages: PublicAssessmentImage[] = content.images.map((img) => ({
    id: img.id,
    filename: img.filename,
    sortOrder: img.sortOrder,
  }))

  return {
    generalNotesHtml: content.generalNotesHtml != null ? sanitizeRichText(content.generalNotesHtml) : null,
    userBehaviourHtml: content.userBehaviourHtml != null ? sanitizeRichText(content.userBehaviourHtml) : null,
    userBehaviourImages,
  }
}

export async function setAssessmentNote(
  viewbookId: number,
  field: AssessmentNoteField,
  html: string,
  actor: string,
): Promise<void> {
  if (typeof html !== 'string') throw new HttpError(400, 'invalid_html')
  if (!(field in FIELD_COLUMN)) throw new HttpError(400, 'invalid_field')

  await assertViewbookActive(viewbookId)

  const sanitized = sanitizeRichText(html)
  const column = FIELD_COLUMN[field]
  const predicate = assessmentPredicate(viewbookId)

  await prisma.$transaction([
    prisma.viewbookAssessmentContent.upsert({
      where: { viewbookId },
      create: { viewbookId, [column]: sanitized, updatedBy: actor },
      update: { [column]: sanitized, updatedBy: actor },
    }),
    syncVersionBumpWhere(viewbookId, predicate),
  ])
}

export async function addAssessmentImage(
  viewbookId: number,
  buf: Buffer,
  actor: string,
): Promise<{ filename: string }> {
  await assertViewbookActive(viewbookId)

  const scope = String(viewbookId)
  const { filename } = await saveViewbookAsset(scope, buf)

  try {
    const max = await prisma.viewbookAssessmentImage.aggregate({
      where: { content: { viewbookId } },
      _max: { sortOrder: true },
    })
    const sortOrder = (max._max.sortOrder ?? 0) + 1
    const predicate = assessmentPredicate(viewbookId)

    await prisma.$transaction([
      // Nested create is the ONLY way to attach an image row to a
      // possibly-just-created content row inside an array-form txn — there
      // is no freshly-minted content id available to a second statement.
      prisma.viewbookAssessmentContent.upsert({
        where: { viewbookId },
        create: {
          viewbookId,
          updatedBy: actor,
          images: { create: { filename, sortOrder, createdBy: actor } },
        },
        update: {
          updatedBy: actor,
          images: { create: { filename, sortOrder, createdBy: actor } },
        },
      }),
      syncVersionBumpWhere(viewbookId, predicate),
    ])
    return { filename }
  } catch (err) {
    await deleteViewbookAssets(scope, [filename])
    throw err
  }
}

export async function deleteAssessmentImage(
  viewbookId: number,
  imageId: number,
  actor: string,
): Promise<void> {
  void actor // no durable field for this actor today; kept for signature/logging symmetry

  const row = await prisma.viewbookAssessmentImage.findFirst({
    where: { id: imageId, content: { viewbookId } },
    select: { filename: true },
  })
  if (!row) throw new HttpError(404, 'not_found')

  const predicate = assessmentPredicate(viewbookId)
  const [, deleted] = await prisma.$transaction([
    syncVersionBumpWhere(viewbookId, predicate),
    prisma.viewbookAssessmentImage.deleteMany({
      where: {
        id: imageId,
        // Equivalent condition to `assessmentPredicate`, expressed as a
        // typed nested-relation filter (docs.ts `deleteViewbookDoc`
        // precedent: the bump's raw predicate and the deleteMany's typed
        // where express the same logical fence).
        content: { viewbookId, viewbook: { client: { archivedAt: null } } },
      },
    }),
  ])
  if (deleted.count === 0) throw new HttpError(404, 'not_found')

  await deleteViewbookAssets(String(viewbookId), [row.filename])
}

export async function collectAssessmentImageSnapshot(
  clientId: number,
): Promise<{ viewbookId: number; filenames: string[] } | null> {
  const viewbook = await prisma.viewbook.findUnique({
    where: { clientId },
    select: {
      id: true,
      assessmentContent: { select: { images: { select: { filename: true } } } },
    },
  })
  if (!viewbook) return null

  return {
    viewbookId: viewbook.id,
    filenames: viewbook.assessmentContent?.images.map((img) => img.filename) ?? [],
  }
}
