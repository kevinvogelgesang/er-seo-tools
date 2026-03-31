import { NextResponse } from 'next/server'
import { getQueueStatus } from '@/lib/ada-audit/queue-manager'

export const dynamic = 'force-dynamic'

/**
 * GET /api/site-audit/queue
 * Lightweight endpoint for polling queue status.
 * Returns the active audit (if any) and all queued audits with positions.
 */
export async function GET() {
  const status = await getQueueStatus()
  return NextResponse.json(status)
}
