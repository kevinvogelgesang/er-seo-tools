'use client'

// Shared client ack island (PR5 Task 7 spec §4/§8): used by pc-setup,
// pc-invite, and DataSourceSection — the three ackable sections. POSTs
// `/api/viewbook/[token]/ack` (lib/viewbook/ack.ts's `acknowledgeSection`),
// then `requestRefresh()` (PR2 Task 6's single-refresher seam) on success —
// the refresh is what picks up the SectionShell collapse (Task 7's
// acknowledgedAt extension) + a possible pc-thanks reveal. Registers with
// `useEditorActivity` while the request is in flight so the sync poller
// never clobbers a pending ack (KickoffNextButton precedent).
import { useState } from 'react'
import { requestRefresh, useEditorActivity } from './useViewbookSync'

// Client-safe local union — mirrors lib/viewbook/ack.ts's server-only
// AckableSectionKey without importing that (prisma-touching) module here.
export type AckableSectionKey = 'pc-setup' | 'pc-invite' | 'data-source'

export function AckButton({
  token,
  sectionKey,
  acknowledgedAt,
}: {
  token: string
  sectionKey: AckableSectionKey
  acknowledgedAt: string | null
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEditorActivity(`ack-${sectionKey}`, busy)

  async function ack() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/viewbook/${encodeURIComponent(token)}/ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sectionKey, clientMutationId: crypto.randomUUID() }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error || 'ack_failed')
      requestRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ack_failed')
    } finally {
      setBusy(false)
    }
  }

  if (acknowledgedAt != null) {
    return (
      <p className="text-sm font-semibold" style={{ color: 'var(--vb-primary)' }}>
        Marked complete
      </p>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void ack()}
        disabled={busy}
        className="rounded-full px-5 py-2 text-sm font-semibold disabled:opacity-60"
        style={{ background: 'var(--vb-primary)', color: 'var(--vb-on-primary)' }}
      >
        {busy ? 'Saving…' : 'This looks good'}
      </button>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  )
}
