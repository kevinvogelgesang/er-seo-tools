// Viewbook strategy PDF service. Files are written before rows and removed on
// row-create failure; deletes capture the filename before a scope-fenced row
// delete and only touch disk when that delete wins.

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { HttpError } from '@/lib/api/errors'
import {
  deleteViewbookAssets,
  MAX_DOC_BYTES,
  saveViewbookDoc,
  sniffPdfType,
} from './assets'
import {
  syncVersionBumpAllStatement,
  syncVersionBumpAllWhere,
  syncVersionBumpStatement,
  syncVersionBumpWhere,
} from './sync'

export interface DocRow {
  id: number
  title: string
  blurb: string | null
  filename: string
  sortOrder: number
}

const DOC_SELECT = {
  id: true,
  title: true,
  blurb: true,
  filename: true,
  sortOrder: true,
} as const

function assertByteCap(value: string, cap: number, code: string): void {
  if (Buffer.byteLength(value, 'utf8') > cap) throw new HttpError(400, code)
}

export async function listViewbookDocs(
  viewbookId: number,
): Promise<{ global: DocRow[]; own: DocRow[] }> {
  const [global, own] = await Promise.all([
    listDocsInScope(null),
    listDocsInScope(viewbookId),
  ])
  return { global, own }
}

export function listGlobalViewbookDocs(): Promise<DocRow[]> {
  return listDocsInScope(null)
}

function listDocsInScope(viewbookId: number | null): Promise<DocRow[]> {
  return prisma.viewbookDoc.findMany({
    where: { viewbookId },
    select: DOC_SELECT,
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  })
}

export async function createViewbookDoc(input: {
  viewbookId: number | null
  title: string
  blurb?: string | null
  buf: Buffer
  createdBy: string
}): Promise<DocRow> {
  assertByteCap(input.title, 160, 'invalid_title')
  if (input.blurb != null) assertByteCap(input.blurb, 512, 'invalid_blurb')
  if (input.buf.length > MAX_DOC_BYTES || !sniffPdfType(input.buf)) {
    throw new HttpError(400, 'invalid_pdf')
  }

  const scope = input.viewbookId == null ? 'global' : String(input.viewbookId)
  const max = await prisma.viewbookDoc.aggregate({
    where: { viewbookId: input.viewbookId },
    _max: { sortOrder: true },
  })
  const { filename } = await saveViewbookDoc(scope, input.buf)

  try {
    // Unconditional create — no prior-state fence needed (team-roster-create
    // precedent in global-content.ts): the row create carries the bump
    // alongside it, global docs bump every viewbook, owned docs bump only
    // their own.
    const [created] = await prisma.$transaction([
      prisma.viewbookDoc.create({
        data: {
          viewbookId: input.viewbookId,
          title: input.title,
          blurb: input.blurb ?? null,
          filename,
          sortOrder: (max._max.sortOrder ?? 0) + 1,
          createdBy: input.createdBy,
        },
        select: DOC_SELECT,
      }),
      input.viewbookId == null
        ? syncVersionBumpAllStatement()
        : syncVersionBumpStatement(input.viewbookId),
    ])
    return created
  } catch (err) {
    await deleteViewbookAssets(scope, [filename])
    throw err
  }
}

export async function deleteViewbookDoc(
  docId: number,
  viewbookId: number | null,
): Promise<void> {
  const row = await prisma.viewbookDoc.findFirst({
    where: { id: docId, viewbookId },
    select: { filename: true },
  })
  if (!row) throw new HttpError(404, 'not_found')

  // Predicated bump BEFORE the deleteMany (deleteContentOverride precedent):
  // a cross-scope or already-lost-the-race delete matches neither predicate,
  // so it bumps nothing.
  const fence =
    viewbookId == null
      ? Prisma.sql`EXISTS (SELECT 1 FROM "ViewbookDoc" WHERE "id" = ${docId} AND "viewbookId" IS NULL)`
      : Prisma.sql`EXISTS (SELECT 1 FROM "ViewbookDoc" WHERE "id" = ${docId} AND "viewbookId" = ${viewbookId})`
  const [, deleted] = await prisma.$transaction([
    viewbookId == null ? syncVersionBumpAllWhere(fence) : syncVersionBumpWhere(viewbookId, fence),
    prisma.viewbookDoc.deleteMany({ where: { id: docId, viewbookId } }),
  ])
  if (deleted.count === 0) throw new HttpError(404, 'not_found')

  const scope = viewbookId == null ? 'global' : String(viewbookId)
  await deleteViewbookAssets(scope, [row.filename])
}
