// Operator ack-reset route (v2 PR5 spec §4 / Task 5). Cookie-gated (default —
// NO middleware entry: `/api/viewbooks/…` is the admin namespace). Mirrors
// the `[id]/lock/route.ts` shell: requireOperatorEmail throws its own 401,
// parseId is the indistinguishable-404 id parse, and the sectionKey is
// checked against the SAME ACKABLE_SECTION_KEYS the client-ack route
// enforces before the core (resetSectionAck) re-validates it anyway.
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { HttpError } from '@/lib/api/errors'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { parseId } from '@/lib/viewbook/route-utils'
import { ACKABLE_SECTION_KEYS, resetSectionAck } from '@/lib/viewbook/ack'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string; sectionKey: string }> }

function isAckableSectionKey(key: string): boolean {
  return (ACKABLE_SECTION_KEYS as readonly string[]).includes(key)
}

export const DELETE = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const operatorEmail = await requireOperatorEmail(request)
  const { id: rawId, sectionKey } = await params
  const id = parseId(rawId)
  if (!isAckableSectionKey(sectionKey)) throw new HttpError(400, 'invalid_section')
  await resetSectionAck(id, sectionKey, operatorEmail)
  return NextResponse.json({ ok: true })
})
