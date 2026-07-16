'use client'

// PR2 Task 6: the public page's ONE mounted refresher — polls the
// token-scoped version endpoint via useViewbookSync and calls router.refresh()
// when the registry is idle and a change (or a requestRefresh()) is pending.
// A terminal 404 (revoked/rotated token, deleted viewbook) also refreshes —
// the server re-render resolves to notFound(). Renders nothing.
import { useRouter } from 'next/navigation'
import { useViewbookSync } from './useViewbookSync'

export function ViewbookSyncClient({
  token,
  initialVersion,
}: {
  token: string
  initialVersion: number
}) {
  const router = useRouter()
  useViewbookSync({
    url: `/api/viewbook/${encodeURIComponent(token)}/sync`,
    initialVersion,
    onChange: () => router.refresh(),
  })
  return null
}
