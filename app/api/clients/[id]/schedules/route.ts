// GET  /api/clients/[id]/schedules — list scan schedules + last-run info
// POST /api/clients/[id]/schedules — create a scan schedule
//
// Internal UI-facing routes: cookie-gated by the middleware (NOT in
// isPublicPath). One schedule per (client, domain) is best-effort v1 —
// app-level check; duplicates from racing POSTs are visible/deletable in
// the card UI.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { parseCadence, nextRun } from '@/lib/jobs/scheduler'
import { SCHEDULED_SITE_AUDIT_JOB_TYPE } from '@/lib/jobs/handlers/scheduled-site-audit'
import { getClientSchedules } from '@/lib/services/client-schedules'

type Params = { params: Promise<{ id: string }> }

function parseClientId(raw: string): number | null {
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

export async function GET(_request: NextRequest, { params }: Params) {
  const clientId = parseClientId((await params).id)
  if (clientId === null) return NextResponse.json({ error: 'invalid_client' }, { status: 400 })
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } })
  if (!client) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ schedules: await getClientSchedules(clientId) })
}

export async function POST(request: NextRequest, { params }: Params) {
  const clientId = parseClientId((await params).id)
  if (clientId === null) return NextResponse.json({ error: 'invalid_client' }, { status: 400 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { archivedAt: true, domains: true },
  })
  if (!client) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (client.archivedAt) return NextResponse.json({ error: 'client_archived' }, { status: 409 })

  let domains: string[] = []
  try {
    const parsed = JSON.parse(client.domains)
    if (Array.isArray(parsed)) domains = parsed.filter((d): d is string => typeof d === 'string')
  } catch { /* no domains */ }
  const domain = typeof body.domain === 'string' ? body.domain.trim() : ''
  if (!domain || !domains.includes(domain)) {
    return NextResponse.json({ error: 'domain_not_listed' }, { status: 400 })
  }

  const cadence = typeof body.cadence === 'string' ? body.cadence : ''
  let parsed: ReturnType<typeof parseCadence>
  try {
    parsed = parseCadence(cadence)
  } catch {
    return NextResponse.json({ error: 'cadence_invalid' }, { status: 400 })
  }
  if (parsed.kind !== 'weekly' && parsed.kind !== 'monthly') {
    // Literal weekly:/monthly: only. daily@/every:* stay rejected even after
    // C3 made blobs prunable: pruning at 90 d does not reduce WITHIN-window
    // volume — 14 daily audits per client hold full child blobs until the
    // 14-d scheduled-retention delete. Enabling daily safely needs
    // supersede-based blob trimming (keep blobs only on the latest N audits
    // per schedule) — C6's design space. every:* additionally has no UI
    // surface — cadenceClass still prices it in for retention robustness.
    return NextResponse.json({ error: 'cadence_not_allowed' }, { status: 400 })
  }

  const wcagLevel = body.wcagLevel === 'wcag22aa' ? 'wcag22aa' : 'wcag21aa'

  // Best-effort uniqueness (spec §7): one schedule per (client, domain).
  const existing = await prisma.schedule.findMany({
    where: { clientId, jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE },
    select: { payload: true },
  })
  const taken = existing.some((s) => {
    try {
      return (JSON.parse(s.payload) as Record<string, unknown>)?.domain === domain
    } catch {
      return false
    }
  })
  if (taken) return NextResponse.json({ error: 'schedule_exists' }, { status: 409 })

  const created = await prisma.schedule.create({
    data: {
      jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE,
      clientId,
      cadence,
      payload: JSON.stringify({ clientId, domain, wcagLevel }),
      nextRunAt: nextRun(cadence, new Date()), // never immediate
    },
  })
  return NextResponse.json({ id: created.id }, { status: 201 })
}
