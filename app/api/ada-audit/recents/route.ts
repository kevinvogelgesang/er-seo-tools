import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { OPERATOR_NAME_COOKIE_NAME, sanitizeOperatorName } from '@/lib/auth'
import { fetchAllRecents } from '@/lib/ada-audit/recents-query'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const scope = url.searchParams.get('scope') === 'mine' ? 'mine' : 'all'
  const parsed = parseInt(url.searchParams.get('limit') ?? '', 10)
  const rawLimit = Number.isNaN(parsed) ? 100 : parsed
  const limit = Math.min(100, Math.max(1, rawLimit))

  if (scope === 'mine') {
    const operator = sanitizeOperatorName((await cookies()).get(OPERATOR_NAME_COOKIE_NAME)?.value)
    if (!operator) return NextResponse.json({ items: [] })
    return NextResponse.json({ items: await fetchAllRecents(limit, operator) })
  }
  return NextResponse.json({ items: await fetchAllRecents(limit, undefined) })
}
