// app/api/fleet/kpi/route.ts
// A8 PR 3.5 — fleet-wide KPI strip data (active scans, avg ADA, avg SEO, open
// criticals). Cookie-gated by middleware omission (NOT in isPublicPath).
import { NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { getFleetKpi } from '@/lib/services/fleet-aggregates'

export const dynamic = 'force-dynamic'

export const GET = withRoute(async () => {
  return NextResponse.json(await getFleetKpi())
})
