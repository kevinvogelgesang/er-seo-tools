// app/api/issues/route.ts
//
// Task 12 (D8 weekly client sweep): GET /api/issues — cookie-gated by the
// default middleware allowlist (no isPublicPath entry added for this route).
import { withRoute } from '@/lib/api/with-route'
import { loadIssuesPayload } from '@/lib/sweep/read'

export const dynamic = 'force-dynamic'

export const GET = withRoute(async () => {
  return Response.json(await loadIssuesPayload())
})
