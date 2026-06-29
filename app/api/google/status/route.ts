// app/api/google/status/route.ts
// GET /api/google/status — service-account status check.
// Returns: { loaded: boolean, email: string|null, ga4Count?: number, gscCount?: number }
// The service-account email is only returned on the explicit ?test=1 connection
// test (an operator action), not on the passive status poll — it is unnecessary
// recon for an ordinary page load. When ?test=1: also calls GA4 Admin + GSC list
// endpoints for live counts.
// Cookie-gated by global middleware. Key material NEVER returned to the browser.

import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getAuthClient, getServiceAccountEmail } from '@/lib/analytics/google/auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const authResult = await getAuthClient()
  const loaded = authResult.ok

  const doTest = new URL(request.url).searchParams.get('test') === '1'

  // Email is gated behind the explicit connection test — the passive poll only
  // reveals whether a key is loaded.
  const email = doTest ? await getServiceAccountEmail() : null

  if (!doTest || !authResult.ok) {
    return NextResponse.json({ loaded, email })
  }

  // Live connection test: count accessible GA4 properties + GSC sites
  let ga4Count = 0
  let gscCount = 0
  const errors: string[] = []

  try {
    const admin = google.analyticsadmin({ version: 'v1beta', auth: authResult.auth })
    const res = await admin.accountSummaries.list({})
    const summaries = res.data.accountSummaries ?? []
    for (const account of summaries) {
      ga4Count += (account.propertySummaries ?? []).length
    }
  } catch (err: unknown) {
    console.error('[google/status] GA4 Admin list error:', (err as Error).message)
    errors.push('ga4')
  }

  try {
    const sc = google.searchconsole({ version: 'v1', auth: authResult.auth })
    const res = await sc.sites.list({})
    gscCount = (res.data.siteEntry ?? []).length
  } catch (err: unknown) {
    console.error('[google/status] GSC sites list error:', (err as Error).message)
    errors.push('gsc')
  }

  return NextResponse.json({ loaded, email, ga4Count, gscCount, ...(errors.length > 0 ? { errors } : {}) })
}
