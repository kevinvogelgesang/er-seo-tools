// app/api/health/route.ts
//
// A4 observability — PUBLIC shallow liveness for an uptime monitor. 200 when the
// app + DB are up (status ok|degraded — degraded stays 200 so the monitor does not
// false-page on a soft issue); 503 only when the DB ping fails (the sole hard-down
// signal). Operational internals stay behind the cookie gate on /admin/ops. This
// route is self-handling — it returns explicit Responses and never 500s.
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getLivenessSummary } from '@/lib/ops/health-summary'
import { logError } from '@/lib/log'
import pkg from '@/package.json'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(): Promise<Response> {
  // Hard-down signal: a cheap, uncached DB ping. A failure here is the one thing
  // worth logging from this endpoint.
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch (err) {
    logError({ scope: 'health-db-ping' }, err)
    return NextResponse.json({ status: 'down' }, { status: 503, headers: NO_STORE })
  }

  // Soft signal: TTL-cached, fail-open degraded flag (health-summary owns the guardrails).
  let status: 'ok' | 'degraded' = 'ok'
  try {
    status = (await getLivenessSummary()).status
  } catch {
    status = 'ok'
  }

  return NextResponse.json(
    { status, uptimeSec: Math.round(process.uptime()), version: pkg.version },
    { status: 200, headers: NO_STORE },
  )
}
