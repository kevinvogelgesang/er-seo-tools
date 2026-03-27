import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url')
  if (!url) {
    return NextResponse.json({ error: 'url parameter required' }, { status: 400 })
  }

  // Validate it's a real http/https URL
  let parsed: URL
  try {
    parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return NextResponse.json({ error: 'Only http/https URLs allowed' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }

  try {
    const response = await fetch(parsed.toString(), {
      headers: { 'User-Agent': 'ER-SEO-Tools/1.0 robots-validator' },
      signal: AbortSignal.timeout(10000),
    })
    const text = await response.text()
    return NextResponse.json({
      content: text,
      status: response.status,
      url: parsed.toString(),
      contentType: response.headers.get('content-type') ?? '',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Fetch failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
