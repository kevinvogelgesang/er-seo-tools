import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { HttpError } from '@/lib/api/errors'
import {
  AnswerConflictError,
  applyAnswerEdit,
  proposeAmendment,
  type AnswerValueInput,
} from '@/lib/viewbook/answers'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { parseId, requireJsonObject } from '@/lib/viewbook/route-utils'
import { validateClientMutationId } from '@/lib/viewbook/public-write-guard'
import { syncVersionBumpWhere } from '@/lib/viewbook/sync'

export const dynamic = 'force-dynamic'

const LABEL_MAX_CHARS = 200
const LABEL_MAX_BYTES = 800

type RouteParams = { params: Promise<{ id: string; fieldId: string }> }

function labelValue(raw: unknown): string {
  if (typeof raw !== 'string') throw new HttpError(400, 'invalid_field')
  const label = raw.trim()
  if (!label || [...label].length > LABEL_MAX_CHARS || Buffer.byteLength(label, 'utf8') > LABEL_MAX_BYTES) {
    throw new HttpError(400, 'invalid_field')
  }
  return label
}

function conflictResponse(error: AnswerConflictError): NextResponse {
  return NextResponse.json({ error: error.code, current: error.current }, { status: 409 })
}

export const PATCH = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const operatorEmail = await requireOperatorEmail(request)
  const { id: rawId, fieldId: rawFieldId } = await params
  const viewbookId = parseId(rawId)
  const fieldId = parseId(rawFieldId)
  const body = requireJsonObject(await parseJsonBody(request))
  const viewbook = await prisma.viewbook.findUnique({ where: { id: viewbookId } })
  if (!viewbook) throw new HttpError(404, 'not_found')

  try {
    if (body.mode === 'amend') {
      const clientMutationId = validateClientMutationId(body.clientMutationId)
      if (!clientMutationId || body.value === null) throw new HttpError(400, 'invalid_answer')
      const result = await proposeAmendment(viewbook, null, {
        fieldId,
        value: body.value as Exclude<AnswerValueInput, null>,
        clientMutationId,
      }, { principal: { kind: 'operator', email: operatorEmail } })
      return NextResponse.json(
        { amendment: result.amendment },
        { status: result.replayed ? 200 : 201 },
      )
    }

    const hasValue = Object.prototype.hasOwnProperty.call(body, 'value')
    const hasLabel = Object.prototype.hasOwnProperty.call(body, 'label')
    if (hasValue && hasLabel) throw new HttpError(400, 'invalid_field_patch')
    if (hasValue) {
      if (!Number.isInteger(body.expectedVersion) || (body.expectedVersion as number) < 0) {
        throw new HttpError(400, 'invalid_answer')
      }
      return NextResponse.json(await applyAnswerEdit(viewbook, null, {
        fieldId,
        value: body.value as AnswerValueInput,
        expectedVersion: body.expectedVersion as number,
      }, { principal: { kind: 'operator', email: operatorEmail } }))
    }
    if (hasLabel) {
      const label = labelValue(body.label)
      const [, updated] = await prisma.$transaction([
        syncVersionBumpWhere(viewbookId, Prisma.sql`
          EXISTS (
            SELECT 1 FROM "ViewbookField"
            WHERE "id" = ${fieldId} AND "viewbookId" = ${viewbookId} AND "defKey" IS NULL AND "archivedAt" IS NULL
          )
        `),
        prisma.viewbookField.updateMany({
          where: { id: fieldId, viewbookId, defKey: null, archivedAt: null },
          data: { label },
        }),
      ])
      if (updated.count !== 1) {
        const target = await prisma.viewbookField.findFirst({
          where: { id: fieldId, viewbookId, archivedAt: null }, select: { defKey: true },
        })
        if (target?.defKey != null) throw new HttpError(400, 'catalog_field_label')
        throw new HttpError(404, 'not_found')
      }
      const field = await prisma.viewbookField.findUniqueOrThrow({ where: { id: fieldId } })
      return NextResponse.json({ field })
    }
    throw new HttpError(400, 'invalid_field_patch')
  } catch (error) {
    if (error instanceof AnswerConflictError) return conflictResponse(error)
    throw error
  }
})

export const DELETE = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  await requireOperatorEmail(request)
  const { id: rawId, fieldId: rawFieldId } = await params
  const viewbookId = parseId(rawId)
  const fieldId = parseId(rawFieldId)
  const [, updated] = await prisma.$transaction([
    syncVersionBumpWhere(viewbookId, Prisma.sql`
      EXISTS (
        SELECT 1 FROM "ViewbookField"
        WHERE "id" = ${fieldId} AND "viewbookId" = ${viewbookId} AND "archivedAt" IS NULL
      )
    `),
    prisma.viewbookField.updateMany({
      where: { id: fieldId, viewbookId, archivedAt: null },
      data: { archivedAt: new Date() },
    }),
  ])
  if (updated.count !== 1) throw new HttpError(404, 'not_found')
  return NextResponse.json({ ok: true })
})
