import { NextResponse } from 'next/server'
import { fetchRecentsStatus } from '@/lib/ada-audit/recents-status'
import { parseStatusRefs } from '@/lib/ada-audit/recents-status-shared'

export const dynamic = 'force-dynamic'

// C17: compact live-status poll for visible in-flight recents rows — never
// re-runs the expensive 5-source merged history query.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const refs = parseStatusRefs(url.searchParams.get('ids'))
  if (refs.length === 0) return NextResponse.json({ items: [] })
  return NextResponse.json({ items: await fetchRecentsStatus(refs) })
}
