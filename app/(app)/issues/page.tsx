// app/(app)/issues/page.tsx
//
// Task 13 (D8 weekly client sweep) — the /issues "Current Scan Issues" page.
// Server component: calls loadIssuesPayload() DIRECTLY (no client fetch, no
// polling) and hands the frozen snapshot to the client IssuesView for
// filtering. force-dynamic so a freshly published sweep is served on reload.

import { loadIssuesPayload } from '@/lib/sweep/read'
import { IssuesView } from '@/components/issues/IssuesView'

export const dynamic = 'force-dynamic'

export default async function IssuesPage() {
  const payload = await loadIssuesPayload()
  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <IssuesView payload={payload} />
    </div>
  )
}
