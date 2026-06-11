import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import {
  sortAssignments,
  type ClientStatus,
  type QuarterPlanGetResponse,
  type QuarterPlanPayload,
  type Snapshots,
} from './state'

/** GET shape for the latest plan, or { plan: null }. Assignment order: assigned by week/position, pool last (JS sort — SQLite puts NULLs first). */
export async function loadPlanResponse(): Promise<QuarterPlanGetResponse> {
  const plan = await prisma.quarterPlan.findFirst({ orderBy: { id: 'desc' } })
  if (!plan) return { plan: null }
  const rows = await prisma.quarterAssignment.findMany({ where: { planId: plan.id } })
  let layouts: Snapshots = {}
  try { layouts = JSON.parse(plan.layouts) } catch { console.error(`[quarter-grid] corrupt layouts JSON on plan ${plan.id}`) }
  return {
    plan: {
      name: plan.name,
      startDate: plan.startDate,
      slotsPerWeek: plan.slotsPerWeek,
      layouts,
      updatedAt: plan.updatedAt.toISOString(),
    },
    assignments: sortAssignments(rows).map((r) => ({
      clientId: r.clientId,
      week: r.week,
      position: r.position,
      priority: r.priority,
      status: r.status as ClientStatus,
      note: r.note,
      completed: r.completedAt != null,
    })),
  }
}

export type PersistResult = { status: 'ok' } | { status: 'conflict' }

/**
 * Last-write-wins full-state persist against the singleton latest plan.
 * - createOnly (import): refuses with 'conflict' if any plan exists.
 * - Plan creation is a conditional raw INSERT ... WHERE NOT EXISTS so two
 *   racing creators can never produce two plans. Raw SQL bypasses
 *   @default/@updatedAt, so createdAt/updatedAt are set to Date.now() ms.
 * - Assignments are delete-and-recreate in ONE array-form transaction
 *   (never the interactive form — CLAUDE.md "Do not").
 */
export async function persistPlan(payload: QuarterPlanPayload, opts: { createOnly?: boolean } = {}): Promise<PersistResult> {
  let plan = await prisma.quarterPlan.findFirst({ orderBy: { id: 'desc' }, select: { id: true } })
  if (plan && opts.createOnly) return { status: 'conflict' }

  if (!plan) {
    const now = Date.now()
    const inserted = await prisma.$executeRaw`
      INSERT INTO "QuarterPlan" ("name", "startDate", "slotsPerWeek", "layouts", "createdAt", "updatedAt")
      SELECT ${payload.name}, ${payload.startDate}, ${payload.slotsPerWeek}, ${JSON.stringify(payload.layouts)}, ${now}, ${now}
      WHERE NOT EXISTS (SELECT 1 FROM "QuarterPlan")`
    if (inserted === 0 && opts.createOnly) return { status: 'conflict' } // lost the import race
    plan = await prisma.quarterPlan.findFirst({ orderBy: { id: 'desc' }, select: { id: true } })
    if (!plan) throw new Error('QuarterPlan creation failed')
  }
  const planId = plan.id

  // Pre-reads (outside the transaction): completedAt preservation + valid client ids.
  const [existingRows, clientRows] = await Promise.all([
    prisma.quarterAssignment.findMany({ where: { planId }, select: { clientId: true, completedAt: true } }),
    prisma.client.findMany({ where: { archivedAt: null }, select: { id: true } }),
  ])
  const validIds = new Set(clientRows.map((c) => c.id))
  const prevCompleted = new Map(existingRows.map((r) => [r.clientId, r.completedAt]))
  const now = new Date()

  // Rows whose client no longer exists OR is archived are dropped silently —
  // hiding archived clients from /api/clients is not enough (an already-open
  // browser keeps re-saving its stale state until reload); failing the
  // whole save on an FK violation would lose the analyst's edit.
  const rows = payload.assignments
    .filter((a) => validIds.has(a.clientId))
    .map((a) => ({
      planId,
      clientId: a.clientId,
      week: a.week,
      position: a.position,
      priority: a.priority,
      status: a.status,
      note: a.note,
      completedAt: a.completed ? (prevCompleted.get(a.clientId) ?? now) : null,
    }))

  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.quarterPlan.update({
      where: { id: planId },
      data: {
        name: payload.name,
        startDate: payload.startDate,
        slotsPerWeek: payload.slotsPerWeek,
        layouts: JSON.stringify(payload.layouts),
      },
    }),
    prisma.quarterAssignment.deleteMany({ where: { planId } }),
  ]
  if (rows.length > 0) ops.push(prisma.quarterAssignment.createMany({ data: rows }))
  await prisma.$transaction(ops)
  return { status: 'ok' }
}
