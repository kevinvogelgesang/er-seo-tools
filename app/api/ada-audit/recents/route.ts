import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { AUTH_COOKIE_NAME, OPERATOR_NAME_COOKIE_NAME, getOperatorLabel } from '@/lib/auth'
import { fetchAllRecents, decodeRecentsCursor } from '@/lib/ada-audit/recents-query'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const scope = url.searchParams.get('scope') === 'mine' ? 'mine' : 'all'
  const parsed = parseInt(url.searchParams.get('limit') ?? '', 10)
  const rawLimit = Number.isNaN(parsed) ? 100 : parsed
  const limit = Math.min(100, Math.max(1, rawLimit))
  // C16: malformed cursors decode to null → first page (harmless, never a 500).
  const cursor = decodeRecentsCursor(url.searchParams.get('cursor'))
  const q = url.searchParams.get('q')?.trim() || undefined
  const rawClient = url.searchParams.get('clientId')
  const clientId = rawClient === 'unassigned' ? ('unassigned' as const)
    : rawClient && /^\d+$/.test(rawClient) ? parseInt(rawClient, 10)
    : null

  let operator: string | undefined
  if (scope === 'mine') {
    const c = await cookies()
    operator = (await getOperatorLabel(c.get(AUTH_COOKIE_NAME)?.value, c.get(OPERATOR_NAME_COOKIE_NAME)?.value)) ?? undefined
    if (!operator) return NextResponse.json({ items: [], nextCursor: null })
  }
  return NextResponse.json(await fetchAllRecents({ limit, operator, cursor, q, clientId }))
}
