// PATCH  /api/clients/[id]/schedules/[scheduleId] — { enabled: boolean }
// DELETE /api/clients/[id]/schedules/[scheduleId]
//
// Both scope the lookup to (clientId, jobType: scheduled-site-audit) so
// these routes can never touch system-* or other job types' Schedule rows.
// DELETE: historical audits become manual-class via SetNull (retained as
// manual history — deleting a schedule never schedules data destruction).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { nextRun } from '@/lib/jobs/scheduler'
import { cancelJobsByGroup } from '@/lib/jobs/queue'
import { SCHEDULED_SITE_AUDIT_JOB_TYPE } from '@/lib/jobs/handlers/scheduled-site-audit'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'

type Params = { params: Promise<{ id: string; scheduleId: string }> }

async function findOwnedSchedule(rawClientId: string, scheduleId: string) {
  const clientId = Number(rawClientId)
  if (!Number.isInteger(clientId) || clientId <= 0) return null
  return prisma.schedule.findFirst({
    where: { id: scheduleId, clientId, jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE },
  })
}

export const PATCH = withRoute(async (request: NextRequest, { params }: Params) => {
  const { id, scheduleId } = await params
  const body = await parseJsonBody<Record<string, unknown>>(request)
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled_required' }, { status: 400 })
  }
  const sched = await findOwnedSchedule(id, scheduleId)
  if (!sched) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  if (body.enabled) {
    // Archive disables schedules; resume must not sneak past that.
    const client = await prisma.client.findUnique({
      where: { id: sched.clientId as number },
      select: { archivedAt: true },
    })
    if (!client || client.archivedAt) {
      return NextResponse.json({ error: 'client_archived' }, { status: 409 })
    }
  }

  await prisma.schedule.update({
    where: { id: sched.id },
    data: body.enabled
      ? // Re-enable recomputes the slot from now — a long-paused schedule
        // must not fire instantly on a stale nextRunAt.
        { enabled: true, nextRunAt: nextRun(sched.cadence, new Date()) }
      : { enabled: false },
  })
  return NextResponse.json({ ok: true })
})

export const DELETE = withRoute(async (_request: NextRequest, { params }: Params) => {
  const { id, scheduleId } = await params
  const sched = await findOwnedSchedule(id, scheduleId)
  if (!sched) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await cancelJobsByGroup(`schedule:${sched.id}`)
  await prisma.schedule.delete({ where: { id: sched.id } })
  return NextResponse.json({ ok: true })
})
