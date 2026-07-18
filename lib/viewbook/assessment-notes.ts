// PR/UX-pass Task 4 (Lane 4): operator-authored assessment notes + images —
// the persistence core behind the assessment-tab rich-text editor and
// user-behaviour image gallery. Server-only.
//
// Fencing discipline (mirrors docs.ts's file-write/DB-stamp/orphan-cleanup
// flow + sync.ts's predicate-sharing contract):
// - `assessmentPredicate(viewbookId)` is the ONE self-contained EXISTS
//   predicate proving the viewbook exists AND its client is not archived.
//   Every mutation's `syncVersionBumpWhere` rides this same predicate.
// - **The domain write itself is fenced on this predicate, not just the
//   bump.** `assignViewbookCsm` in service.ts is the correct precedent to
//   match — it re-expresses the guard on its raw `UPDATE "Viewbook" ... WHERE
//   "id" = ? AND (predicate)` statement, not only on the bump. (An earlier
//   version of this file's comment claimed the upfront `assertViewbookActive`
//   check + an unconditional typed `upsert` "matched" that precedent — it
//   didn't: a client archived in the gap between the check and the
//   transaction let the upsert commit while only the bump silently no-opped,
//   i.e. content could land on an archived viewbook with a stale
//   syncVersion. That gap is closed here.) Prisma's typed `upsert` can't take
//   an extra WHERE, so both writers below use a single guarded raw-SQL
//   statement: `INSERT ... SELECT ... WHERE (predicate) ON CONFLICT(...) DO
//   UPDATE SET ...`. **Verified empirically against this SQLite build**
//   (see `docs/superpowers/sdd/task-4-report.md`): when the guard is false
//   the SELECT yields zero candidate rows, so SQLite never attempts the
//   INSERT and the ON CONFLICT/DO UPDATE branch is therefore never reached
//   either — one statement fences BOTH the create and the update path of the
//   upsert. Exact guarantee: if the viewbook's client is archived (or the
//   viewbook itself is gone) at transaction time, the domain write affects
//   zero rows in the SAME atomic transaction as the (also zero-row) bump —
//   never a partial state where content lands but the version doesn't move.
//   Both writers check the affected-row count and throw 409 `client_archived`
//   rather than returning as if the write had landed (an upfront
//   `assertViewbookActive` call stays as a fast-fail for the common
//   already-archived-at-call-time case; the raw-SQL guard is what actually
//   makes the write atomic against a race in the gap — an optional
//   `deps.beforeWrite` hook exists solely so tests can land a race in that
//   gap, mirroring `AssignViewbookCsmDeps` in service.ts).
// - `addAssessmentImage` CANNOT read a freshly-created content row's id
//   between array-txn statements (interactive transactions are banned
//   repo-wide), so the image insert re-derives the contentId via `SELECT
//   "id" FROM "ViewbookAssessmentContent" WHERE "viewbookId" = ? AND
//   (predicate)` — guarded the same way, independently of statement 1, so a
//   content row that already existed before the race window still blocks
//   the image insert if the guard fails at write time.
// - Reads re-sanitize both HTML bodies before returning (defense against a
//   sanitizer-version change since the row was written).

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { HttpError } from '@/lib/api/errors'
import { isBlankRichText, sanitizeRichText } from '@/lib/richtext/sanitize'
import { deleteViewbookAssets, saveViewbookAsset } from './assets'
import { syncVersionBumpWhere } from './sync'
import type { PublicAssessmentImage, PublicAssessmentNotes } from './public-types'

// Test-only race seam (mirrors `AssignViewbookCsmDeps` in service.ts): a hook
// invoked after the upfront `assertViewbookActive` check but before the
// guarded transaction, so a test can archive the client (or, for
// `addAssessmentImage`, do so AFTER the file is already saved) to prove the
// raw-SQL guard — not just the upfront check — is what closes the race.
export interface AssessmentWriteDeps {
  beforeWrite?: () => Promise<void>
}

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
  deps: AssessmentWriteDeps = {},
): Promise<void> {
  if (typeof html !== 'string') throw new HttpError(400, 'invalid_html')
  if (!(field in FIELD_COLUMN)) throw new HttpError(400, 'invalid_field')

  await assertViewbookActive(viewbookId)

  // codex-review P2: a cleared contentEditable region sanitizes to
  // break-only markup (`<br />`, `<p><br /></p>`) rather than `''` — store
  // clean-empty instead, so the public page's `hasHtml` check (and any
  // other reader) never has to special-case break-only HTML that made it
  // into the column before this normalization existed at write time.
  const sanitized = sanitizeRichText(html)
  const normalized = isBlankRichText(sanitized) ? '' : sanitized
  const column = FIELD_COLUMN[field]
  // `column` is always one of the two hardcoded FIELD_COLUMN values (never
  // derived from request input beyond the `field in FIELD_COLUMN` check
  // above) — safe to splice as a raw SQL identifier.
  const columnIdent = Prisma.raw(`"${column}"`)
  const predicate = assessmentPredicate(viewbookId)
  const now = Date.now()

  if (deps.beforeWrite) await deps.beforeWrite()

  const [writeCount] = await prisma.$transaction([
    // Single guarded upsert — see the file-header comment for why this one
    // statement fences both the create and the update path.
    prisma.$executeRaw`
      INSERT INTO "ViewbookAssessmentContent" ("viewbookId", ${columnIdent}, "updatedAt", "updatedBy")
      SELECT ${viewbookId}, ${normalized}, ${now}, ${actor}
      WHERE (${predicate})
      ON CONFLICT("viewbookId") DO UPDATE SET
        ${columnIdent} = excluded.${columnIdent},
        "updatedAt" = excluded."updatedAt",
        "updatedBy" = excluded."updatedBy"
    `,
    syncVersionBumpWhere(viewbookId, predicate),
  ])

  // The guard failed at write time (archived/deleted in the gap since the
  // upfront check) — the write no-op'd atomically. Throw rather than return
  // as if it had landed.
  if (writeCount === 0) throw new HttpError(409, 'client_archived')
}

export async function addAssessmentImage(
  viewbookId: number,
  buf: Buffer,
  actor: string,
  deps: AssessmentWriteDeps = {},
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
    const now = Date.now()

    if (deps.beforeWrite) await deps.beforeWrite()

    const [, imageInsertCount] = await prisma.$transaction([
      // (1) Ensure the content row exists, guarded the same way as (2) — see
      // the file-header comment for why this one statement fences both the
      // create and the update path.
      prisma.$executeRaw`
        INSERT INTO "ViewbookAssessmentContent" ("viewbookId", "updatedAt", "updatedBy")
        SELECT ${viewbookId}, ${now}, ${actor}
        WHERE (${predicate})
        ON CONFLICT("viewbookId") DO UPDATE SET
          "updatedAt" = excluded."updatedAt",
          "updatedBy" = excluded."updatedBy"
      `,
      // (2) Re-derive the contentId via SELECT rather than reusing a prior
      // statement's freshly-minted id (interactive transactions are banned
      // repo-wide). Guarded INDEPENDENTLY of (1): a content row that already
      // existed before this call still blocks the image insert if the guard
      // fails at write time — (1) alone no-opping isn't sufficient, since a
      // pre-existing row would otherwise let (2) attach an image to it.
      prisma.$executeRaw`
        INSERT INTO "ViewbookAssessmentImage" ("contentId", "filename", "sortOrder", "createdBy", "createdAt")
        SELECT "id", ${filename}, ${sortOrder}, ${actor}, ${now}
        FROM "ViewbookAssessmentContent"
        WHERE "viewbookId" = ${viewbookId} AND (${predicate})
      `,
      syncVersionBumpWhere(viewbookId, predicate),
    ])

    // The guard failed at write time (archived/deleted in the gap since the
    // upfront check, or since the file was saved) — no image row was
    // inserted. Throw so the outer catch deletes the orphaned file instead
    // of returning a filename that was never persisted.
    if (imageInsertCount === 0) throw new HttpError(409, 'client_archived')

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
