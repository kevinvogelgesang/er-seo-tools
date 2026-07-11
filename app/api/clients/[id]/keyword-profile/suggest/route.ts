import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { suggestPrograms } from '@/lib/services/keyword-profile'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

// Route files export only handlers + config, so the strict id parse is
// duplicated here rather than exported from the sibling route (plan-Codex #4).
function parseClientId(id: string): number | null {
  const n = parseInt(id, 10)
  return Number.isInteger(n) && n > 0 && String(n) === id.trim() ? n : null
}

/**
 * POST /api/clients/:id/keyword-profile/suggest
 * No body. Derives program suggestions from the client's NEWEST live-scan run
 * (KS-3 spec §4), persists them (replacing prior suggestions, preserving
 * dismissedNames), returns { suggestions }. Writes ONLY
 * programSuggestionsJson — never the roster. Archived clients 409.
 * Cookie-gated by global middleware.
 */
export const POST = withRoute(async (_request: NextRequest, { params }: RouteParams) => {
  const { id } = await params
  const clientId = parseClientId(id)
  if (clientId === null) {
    return NextResponse.json({ error: 'invalid_client_id' }, { status: 400 })
  }
  const result = await suggestPrograms(clientId)
  if (!result.ok) {
    const status = result.error === 'client_not_found' ? 404 : 409
    return NextResponse.json({ error: result.error }, { status })
  }
  return NextResponse.json({ suggestions: result.suggestions })
})
