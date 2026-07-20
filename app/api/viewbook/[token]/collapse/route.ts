// DORMANT (2026-07-19): collapse is client-local now; this endpoint is
// intentionally 410 — see docs/superpowers/specs/2026-07-19-viewbook-
// collapse-local-revision.md. `POST /api/viewbook/[token]/collapse` used to
// be the shared-collapse write path (spec §6, v2 PR2); the viewer-facing
// collapse-to-hero control now writes ONLY to localStorage (see
// components/viewbook/public/useCollapseState.ts) and never calls this
// route.
//
// Fix 3 (post-review, same date): this surface is STILL a live anonymous
// write path (mutates SQLite + bumps `Viewbook.syncVersion`, triggering
// refetch churn on every connected client) even though nothing calls it —
// that's a dormant liability, not a harmless no-op. The handler now
// short-circuits to 410 `collapse_local_only` BEFORE resolving the token,
// parsing the body, or calling `setSectionCollapsedShared`
// (lib/viewbook/collapse.ts, itself DORMANT): no read, no write, no
// syncVersion bump, for any caller/body/token — mirrors the retired-route
// precedent in app/api/clients/[id]/schedules/route.ts (`schedule_retired`).
//
// The route + lib/viewbook/collapse.ts + the middleware matcher are kept
// FUNCTIONAL-BUT-UNREACHABLE (not deleted) in case a future "shared
// collapse" mode revives them — this comment and the linked spec are the
// breadcrumb.
import { withRoute } from '@/lib/api/with-route'
import { HttpError } from '@/lib/api/errors'

export const dynamic = 'force-dynamic'

export const POST = withRoute(async () => {
  throw new HttpError(410, 'collapse_local_only')
})
