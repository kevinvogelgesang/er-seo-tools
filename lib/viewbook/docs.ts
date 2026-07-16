// Viewbook strategy PDF service. Files are written before rows and removed on
// row-create failure; deletes capture the filename before a scope-fenced row
// delete and only touch disk when that delete wins.

import { prisma } from '@/lib/db'
import { HttpError } from '@/lib/api/errors'
import {
  deleteViewbookAssets,
  MAX_DOC_BYTES,
  saveViewbookDoc,
  sniffPdfType,
} from './assets'

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
    // PR2-rebase: adopt syncVersionBumpStatement here (all for global, scoped otherwise).
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

  // PR2-rebase: adopt syncVersionBumpStatement here (all for global, scoped otherwise).
  const [deleted] = await prisma.$transaction([
    prisma.viewbookDoc.deleteMany({ where: { id: docId, viewbookId } }),
  ])
  if (deleted.count === 0) throw new HttpError(404, 'not_found')

  const scope = viewbookId == null ? 'global' : String(viewbookId)
  await deleteViewbookAssets(scope, [row.filename])
}
