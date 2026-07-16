'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function KickoffNextButton({ viewbookId }: { viewbookId: number }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function advance() {
    if (!window.confirm('Move this viewbook to Website Specifics?')) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/viewbooks/${viewbookId}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction: 'forward', expectedStage: 'kickoff' }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error || 'stage_update_failed')
      // PR2-rebase: call the live-sync refresh seam here when available.
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'stage_update_failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void advance()}
        disabled={busy}
        className="rounded-full px-5 py-2 text-sm font-semibold disabled:opacity-60"
        style={{ background: 'var(--vb-primary)', color: 'var(--vb-on-primary)' }}
      >
        {busy ? 'Moving…' : 'Move to Website Specifics'}
      </button>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  )
}
