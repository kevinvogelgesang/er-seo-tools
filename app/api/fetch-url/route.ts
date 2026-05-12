import { NextRequest, NextResponse } from 'next/server'
import {
  SafeUrlError,
  parseSafeHttpUrl,
  readResponseTextWithLimit,
  safeFetch,
} from '@/lib/security/safe-url'

export const dynamic = 'force-dynamic'

const MAX_RESPONSE_BYTES = 1_000_000

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url')
  if (!url) {
    return NextResponse.json({ error: 'url parameter required' }, { status: 400 })
  }

  let parsed: URL
  try {
    parsed = parseSafeHttpUrl(url)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid URL'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  try {
    const { response, url: finalUrl } = await safeFetch(parsed, {
      headers: { 'User-Agent': 'ER-SEO-Tools/1.0 robots-validator' },
      signal: AbortSignal.timeout(10000),
    })
    const { text, truncated } = await readResponseTextWithLimit(response, MAX_RESPONSE_BYTES)
    return NextResponse.json({
      content: text,
      truncated,
      status: response.status,
      url: finalUrl,
      contentType: response.headers.get('content-type') ?? '',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Fetch failed'
    if (err instanceof SafeUrlError) {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
