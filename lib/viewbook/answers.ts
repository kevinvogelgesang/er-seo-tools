// Transactional core for Viewbook Data Source edits, lock-in, and amendments.
//
// Public writes are commit-time fenced on token/revocation, active client,
// visible section, field ownership/archive state, optimistic version, and the
// lock boundary. Operator writes use the same fence except token/revocation.
// Every write is an array-form transaction; the conditional activity INSERT
// precedes an identically guarded domain write so conflicts and no-ops cannot
// produce activity rows.

import { Prisma, type Viewbook, type ViewbookField, type ViewbookFieldAmendment } from '@prisma/client'
import { prisma } from '@/lib/db'
import { HttpError } from '@/lib/api/errors'
import { requireViewbookToken } from './route-auth'
import { validateClientMutationId } from './public-write-guard'
import { syncVersionBumpWhere } from './sync'

const VALUE_CAP_BYTES = 8 * 1024
const AMENDMENT_CAP = 20

export interface MutationHooks {
  beforeCommit?: () => Promise<void>
}

export type AnswerValueInput = string | string[] | null

export interface AnswerEditInput {
  fieldId: number
  value: AnswerValueInput
  expectedVersion: number
}

export interface AmendmentInput {
  fieldId: number
  value: Exclude<AnswerValueInput, null>
  clientMutationId: string
}

export interface CurrentAnswer {
  value: string | null
  version: number
}

export class AnswerConflictError extends HttpError {
  constructor(code: string, public readonly current: CurrentAnswer) {
    super(409, code)
  }
}

interface NormalizedValue {
  stored: string | null
  kind: 'null' | 'string' | 'list'
}

function normalizeValue(value: unknown, allowNull: boolean): NormalizedValue {
  if (value === null) {
    if (!allowNull) throw new HttpError(400, 'invalid_answer')
    return { stored: null, kind: 'null' }
  }
  let stored: string
  let kind: NormalizedValue['kind']
  if (typeof value === 'string') {
    stored = value
    kind = 'string'
  } else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    stored = JSON.stringify(value)
    kind = 'list'
  } else {
    throw new HttpError(400, 'invalid_answer')
  }
  if (Buffer.byteLength(stored, 'utf8') > VALUE_CAP_BYTES) {
    throw new HttpError(400, 'invalid_answer')
  }
  return { stored, kind }
}

function assertFieldId(fieldId: number): void {
  if (!Number.isInteger(fieldId) || fieldId <= 0) throw new HttpError(400, 'invalid_answer')
}

function assertExpectedVersion(version: number): void {
  if (!Number.isInteger(version) || version < 0) throw new HttpError(400, 'invalid_answer')
}

function typeFence(kind: NormalizedValue['kind']): Prisma.Sql {
  return Prisma.sql`(
    ${kind} = 'null'
    OR (${kind} = 'list' AND f."fieldType" = 'list')
    OR (${kind} = 'string' AND f."fieldType" IN ('text', 'textarea'))
  )`
}

function accessFence(viewbookId: number, token: string | null): Prisma.Sql {
  return Prisma.sql`
    v."id" = ${viewbookId}
    ${token === null ? Prisma.empty : Prisma.sql`AND v."token" = ${token} AND v."revokedAt" IS NULL`}
    AND c."archivedAt" IS NULL
    AND s."sectionKey" = 'data-source' AND s."state" <> 'hidden'
  `
}

function fieldAccessWhere(
  viewbookId: number,
  token: string | null,
  fieldId: number,
): Prisma.Sql {
  return Prisma.sql`
    f."id" = ${fieldId} AND f."viewbookId" = v."id" AND f."archivedAt" IS NULL
    AND ${accessFence(viewbookId, token)}
  `
}

// Wraps a WHERE fragment built from the f/v/c/s aliases (editableWhere,
// amendmentWhere) in a SELF-CONTAINED EXISTS subquery declaring those same
// aliases itself — safe to embed in the syncVersion bump's outer UPDATE
// "Viewbook" (which has no aliases of its own), unlike pasting the bare
// fragment (Codex wave-2 fix 2).
function fieldJoinExists(where: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1 FROM "ViewbookField" f
    JOIN "Viewbook" v ON v."id" = f."viewbookId"
    JOIN "Client" c ON c."id" = v."clientId"
    JOIN "ViewbookSection" s ON s."viewbookId" = v."id"
    WHERE ${where}
  )`
}

function editableWhere(
  viewbookId: number,
  token: string | null,
  input: AnswerEditInput,
  value: NormalizedValue,
): Prisma.Sql {
  return Prisma.sql`
    ${fieldAccessWhere(viewbookId, token, input.fieldId)}
    AND f."version" = ${input.expectedVersion}
    AND (v."dataLockedAt" IS NULL OR f."createdAt" > v."dataLockedAt")
    AND ${typeFence(value.kind)}
    AND NOT (f."value" IS ${value.stored})
  `
}

type FieldState = Pick<ViewbookField, 'id' | 'value' | 'version' | 'valueUpdatedBy' | 'valueUpdatedAt'>

async function diagnoseField(
  viewbook: Viewbook,
  token: string | null,
  fieldId: number,
) {
  if (token !== null) await requireViewbookToken(token)
  const field = await prisma.viewbookField.findFirst({
    where: {
      id: fieldId,
      viewbookId: viewbook.id,
      archivedAt: null,
      viewbook: {
        client: { archivedAt: null },
        sections: { some: { sectionKey: 'data-source', state: { not: 'hidden' } } },
      },
    },
    select: {
      id: true,
      value: true,
      version: true,
      fieldType: true,
      createdAt: true,
      valueUpdatedBy: true,
      valueUpdatedAt: true,
      viewbook: { select: { dataLockedAt: true } },
      _count: { select: { amendments: true } },
    },
  })
  if (!field) throw new HttpError(404, 'not_found')
  return field
}

function valueMatchesFieldType(fieldType: string, value: NormalizedValue): boolean {
  return value.kind === 'null'
    || (fieldType === 'list' && value.kind === 'list')
    || ((fieldType === 'text' || fieldType === 'textarea') && value.kind === 'string')
}

function isLockedBaseline(createdAt: Date, dataLockedAt: Date | null): boolean {
  return dataLockedAt !== null && createdAt.getTime() <= dataLockedAt.getTime()
}

export async function applyAnswerEdit(
  viewbook: Viewbook,
  token: string | null,
  input: AnswerEditInput,
  actor: string,
  hooks: MutationHooks = {},
): Promise<{ field: FieldState }> {
  assertFieldId(input.fieldId)
  assertExpectedVersion(input.expectedVersion)
  const value = normalizeValue(input.value, true)
  await hooks.beforeCommit?.()
  const now = Date.now()
  const where = editableWhere(viewbook.id, token, input, value)
  const [, activityCount, updateCount] = await prisma.$transaction([
    syncVersionBumpWhere(viewbook.id, fieldJoinExists(where)),
    prisma.$executeRaw`
      INSERT INTO "ViewbookActivity" ("viewbookId", "kind", "actor", "summary", "createdAt")
      SELECT v."id", 'answer', ${actor}, 'Updated Data Source answer', ${now}
      FROM "ViewbookField" f
      JOIN "Viewbook" v ON v."id" = f."viewbookId"
      JOIN "Client" c ON c."id" = v."clientId"
      JOIN "ViewbookSection" s ON s."viewbookId" = v."id"
      WHERE ${where}
    `,
    prisma.$executeRaw`
      UPDATE "ViewbookField" AS f
      SET "value" = ${value.stored}, "version" = "version" + 1,
          "valueUpdatedBy" = ${actor}, "valueUpdatedAt" = ${now}
      WHERE f."id" = ${input.fieldId}
        AND EXISTS (
          SELECT 1 FROM "Viewbook" v
          JOIN "Client" c ON c."id" = v."clientId"
          JOIN "ViewbookSection" s ON s."viewbookId" = v."id"
          WHERE ${where}
        )
    `,
  ])

  if (updateCount === 1 && activityCount === 1) {
    return {
      field: await prisma.viewbookField.findUniqueOrThrow({
        where: { id: input.fieldId },
        select: { id: true, value: true, version: true, valueUpdatedBy: true, valueUpdatedAt: true },
      }),
    }
  }
  if (updateCount !== activityCount) throw new Error('viewbook_answer_activity_mismatch')

  const current = await diagnoseField(viewbook, token, input.fieldId)
  if (current.version !== input.expectedVersion) {
    throw new AnswerConflictError('stale_version', { value: current.value, version: current.version })
  }
  if (!valueMatchesFieldType(current.fieldType, value)) throw new HttpError(400, 'invalid_answer')
  if (current.value === value.stored) {
    return {
      field: {
        id: current.id,
        value: current.value,
        version: current.version,
        valueUpdatedBy: current.valueUpdatedBy,
        valueUpdatedAt: current.valueUpdatedAt,
      },
    }
  }
  if (isLockedBaseline(current.createdAt, current.viewbook.dataLockedAt)) {
    throw new AnswerConflictError('data_locked', { value: current.value, version: current.version })
  }
  throw new HttpError(404, 'not_found')
}

function amendmentWhere(
  viewbookId: number,
  token: string | null,
  input: AmendmentInput,
  value: NormalizedValue,
): Prisma.Sql {
  return Prisma.sql`
    ${fieldAccessWhere(viewbookId, token, input.fieldId)}
    AND v."dataLockedAt" IS NOT NULL AND f."createdAt" <= v."dataLockedAt"
    AND ${typeFence(value.kind)}
    AND (SELECT COUNT(*) FROM "ViewbookFieldAmendment" a2 WHERE a2."fieldId" = f."id") < ${AMENDMENT_CAP}
  `
}

export async function proposeAmendment(
  viewbook: Viewbook,
  token: string | null,
  input: AmendmentInput,
  actor: string,
  hooks: MutationHooks = {},
): Promise<{ amendment: ViewbookFieldAmendment; replayed: boolean }> {
  assertFieldId(input.fieldId)
  const value = normalizeValue(input.value, false)
  const clientMutationId = validateClientMutationId(input.clientMutationId)
  if (!clientMutationId) throw new HttpError(400, 'invalid_client_mutation_id')
  await hooks.beforeCommit?.()
  const now = Date.now()
  const where = amendmentWhere(viewbook.id, token, input, value)
  const replayGuard = Prisma.sql`NOT EXISTS (
    SELECT 1 FROM "ViewbookFieldAmendment" a WHERE a."clientMutationId" = ${clientMutationId}
  )`
  const [, activityCount, insertCount] = await prisma.$transaction([
    syncVersionBumpWhere(viewbook.id, Prisma.sql`${replayGuard} AND ${fieldJoinExists(where)}`),
    prisma.$executeRaw`
      INSERT INTO "ViewbookActivity" ("viewbookId", "kind", "actor", "summary", "createdAt")
      SELECT v."id", 'amendment', ${actor}, 'Proposed a Data Source amendment', ${now}
      FROM "ViewbookField" f
      JOIN "Viewbook" v ON v."id" = f."viewbookId"
      JOIN "Client" c ON c."id" = v."clientId"
      JOIN "ViewbookSection" s ON s."viewbookId" = v."id"
      WHERE ${replayGuard} AND ${where}
    `,
    prisma.$executeRaw`
      INSERT INTO "ViewbookFieldAmendment"
        ("fieldId", "value", "author", "clientMutationId", "createdAt")
      SELECT f."id", ${value.stored}, ${actor}, ${clientMutationId}, ${now}
      FROM "ViewbookField" f
      JOIN "Viewbook" v ON v."id" = f."viewbookId"
      JOIN "Client" c ON c."id" = v."clientId"
      JOIN "ViewbookSection" s ON s."viewbookId" = v."id"
      WHERE ${where}
      ON CONFLICT("clientMutationId") DO NOTHING
    `,
  ])

  if (insertCount !== activityCount) throw new Error('viewbook_amendment_activity_mismatch')
  const replay = await prisma.viewbookFieldAmendment.findFirst({
    where: {
      clientMutationId,
      fieldId: input.fieldId,
      field: {
        viewbookId: viewbook.id,
        archivedAt: null,
        viewbook: {
          client: { archivedAt: null },
          sections: { some: { sectionKey: 'data-source', state: { not: 'hidden' } } },
          ...(token === null ? {} : { token, revokedAt: null }),
        },
      },
    },
  })
  if (replay) return { amendment: replay, replayed: insertCount === 0 }

  const current = await diagnoseField(viewbook, token, input.fieldId)
  if (!valueMatchesFieldType(current.fieldType, value)) throw new HttpError(400, 'invalid_answer')
  if (!isLockedBaseline(current.createdAt, current.viewbook.dataLockedAt)) {
    throw new AnswerConflictError('not_locked', { value: current.value, version: current.version })
  }
  if (current._count.amendments >= AMENDMENT_CAP) {
    throw new AnswerConflictError('amendment_limit_reached', { value: current.value, version: current.version })
  }
  throw new HttpError(404, 'not_found')
}

export async function lockViewbook(
  viewbookId: number,
  operatorEmail: string,
): Promise<{ dataLockedAt: Date; dataLockedBy: string | null; alreadyLocked: boolean }> {
  const now = new Date()
  const nowMs = now.getTime()
  const notYetLocked = Prisma.sql`EXISTS (
    SELECT 1 FROM "Viewbook" WHERE "id" = ${viewbookId} AND "dataLockedAt" IS NULL
  )`
  const [, activityCount, updated] = await prisma.$transaction([
    syncVersionBumpWhere(viewbookId, notYetLocked),
    prisma.$executeRaw`
      INSERT INTO "ViewbookActivity" ("viewbookId", "kind", "actor", "summary", "createdAt")
      SELECT v."id", 'lock', ${operatorEmail}, 'Locked in Data Source answers', ${nowMs}
      FROM "Viewbook" v WHERE v."id" = ${viewbookId} AND v."dataLockedAt" IS NULL
    `,
    prisma.viewbook.updateMany({
      where: { id: viewbookId, dataLockedAt: null },
      data: { dataLockedAt: now, dataLockedBy: operatorEmail },
    }),
  ])
  if (updated.count === 1 && activityCount === 1) {
    return { dataLockedAt: now, dataLockedBy: operatorEmail, alreadyLocked: false }
  }
  if (updated.count !== activityCount) throw new Error('viewbook_lock_activity_mismatch')
  const current = await prisma.viewbook.findUnique({
    where: { id: viewbookId }, select: { dataLockedAt: true, dataLockedBy: true },
  })
  if (!current?.dataLockedAt) throw new HttpError(404, 'not_found')
  return { dataLockedAt: current.dataLockedAt, dataLockedBy: current.dataLockedBy, alreadyLocked: true }
}
