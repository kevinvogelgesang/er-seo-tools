// components/quarter-grid/PushToTeamworkButton.tsx
'use client'

import { useState } from 'react'
import { composeQuarterPushPayload } from '@/lib/quarter-push-prompt'

type ButtonState = 'idle' | 'minting' | 'copied' | 'nothing-planned' | 'mint-failed' | 'service-error'

/**
 * Mints a qct_ token and copies the er-handoff-memo paste-in payload. The push
 * itself happens in Claude (Teamwork MCP); the receipt updates the DB, so the
 * "last pushed" line refreshes on the next page reload.
 */
export function PushToTeamworkButton() {
  const [state, setState] = useState<ButtonState>('idle')
  const webappUrl = process.env.NEXT_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '')

  const onClick = async () => {
    if (state === 'minting') return
    setState('minting')
    try {
      const res = await fetch('/api/quarter-plan/push/mint-token', { method: 'POST' })
      if (res.status === 409) { setState('nothing-planned'); setTimeout(() => setState('idle'), 3000); return }
      if (res.status === 500) { setState('service-error'); setTimeout(() => setState('idle'), 4000); return }
      if (!res.ok) { setState('mint-failed'); setTimeout(() => setState('idle'), 3000); return }
      const { token, planId } = (await res.json()) as { token: string; planId: number }
      const payload = composeQuarterPushPayload({ webappUrl, planId, token })
      try {
        await navigator.clipboard.writeText(payload)
        setState('copied')
        setTimeout(() => setState('idle'), 2000)
      } catch {
        window.prompt('Copy this prompt for the er-handoff-memo skill:', payload)
        setState('idle')
      }
    } catch {
      setState('mint-failed'); setTimeout(() => setState('idle'), 3000)
    }
  }

  const label = state === 'minting' ? 'Minting…'
    : state === 'copied' ? 'Copied!'
    : state === 'nothing-planned' ? 'Nothing to push'
    : state === 'mint-failed' ? 'Failed — retry'
    : state === 'service-error' ? 'Token service unavailable'
    : '⇪ Push to Teamwork'

  return (
    <button
      onClick={onClick}
      disabled={state === 'minting'}
      title="Copies a Claude prompt that creates the planned-week Teamwork tasks. Last-pushed updates after reload."
      style={{
        padding: '5px 12px', background: '#0f172a', color: '#38bdf8',
        border: '1px solid #38bdf8', borderRadius: 6, fontSize: 11,
        cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500,
        opacity: state === 'minting' ? 0.6 : 1,
      }}
    >
      {label}
    </button>
  )
}
