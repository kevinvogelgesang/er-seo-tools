'use client'

import { useState } from 'react'
import { usePresentationMode } from './PresentationToggle'
import { requestRefresh } from './useViewbookSync'
import { KickoffQuestionsOutro } from './KickoffQuestionsOutro'

// Operator kickoff content, presentation-aware (Codex PR8 review, P2): during a
// screen-share (presentation mode ON) the operator-only "Move to Website
// Specifics" mutation CTA must NOT show — fall back to the anonymous outro so
// the client sees the same thing they would. usePresentationMode has a safe
// default outside a provider, so this can never crash the anonymous branch.
export function KickoffNextCta({ viewbookId, csmName }: { viewbookId: number; csmName: string | null }) {
  const { presenting } = usePresentationMode()
  if (presenting) return <KickoffQuestionsOutro csmName={csmName} />
  return (
    <div className="space-y-3">
      <h2 className="text-2xl font-bold" style={{ fontFamily: 'var(--vb-heading-font)' }}>
        Ready for the next step?
      </h2>
      <p className="text-black/70">Advance the client when the kickoff conversation is complete.</p>
      <KickoffNextButton viewbookId={viewbookId} />
    </div>
  )
}

export function KickoffNextButton({ viewbookId }: { viewbookId: number }) {
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
      requestRefresh()
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
