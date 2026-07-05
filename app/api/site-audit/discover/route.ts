import { NextRequest, NextResponse } from 'next/server'
import { discoverPages } from '@/lib/ada-audit/sitemap-crawler'

export const dynamic = 'force-dynamic'

/**
 * POST /api/site-audit/discover
 * Discovers pages for a domain and returns the count + URLs.
 * The client can then show a confirmation before starting the actual audit.
 */
export async function POST(request: NextRequest) {
  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const raw = body as Record<string, unknown>
  let domain = typeof raw?.domain === 'string' ? raw.domain.trim() : ''

  if (!domain) {
    return NextResponse.json({ error: 'domain is required' }, { status: 400 })
  }

  domain = domain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase()

  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    return NextResponse.json({ error: 'Invalid domain (e.g. example.edu)' }, { status: 400 })
  }

  try {
    const { urls } = await discoverPages(domain)
    return NextResponse.json({ domain, pageCount: urls.length, urls })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Discovery failed'
    return NextResponse.json({ error: message }, { status: 422 })
  }
}
