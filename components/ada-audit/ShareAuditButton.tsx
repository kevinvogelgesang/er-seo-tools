'use client'

import { useState } from 'react'

interface Props {
  auditId: string
}

type State = 'idle' | 'loading' | 'copied' | 'error'

export default function ShareAuditButton({ auditId }: Props) {
  const [state, setState] = useState<State>('idle')

  async function handleClick() {
    if (state === 'loading') return
    setState('loading')

    try {
      const res = await fetch(`/api/ada-audit/${auditId}/share`, { method: 'POST' })
      const data = await res.json()

      if (!res.ok) {
        setState('error')
        setTimeout(() => setState('idle'), 3000)
        return
      }

      await navigator.clipboard.writeText(data.shareUrl)
      setState('copied')
      setTimeout(() => setState('idle'), 3000)
    } catch {
      setState('error')
      setTimeout(() => setState('idle'), 3000)
    }
  }

  const label: Record<State, string> = {
    idle: 'Share',
    loading: 'Sharing\u2026',
    copied: 'Copied!',
    error: 'Error',
  }

  const colorClass: Record<State, string> = {
    idle: 'bg-white border-gray-300 text-navy hover:border-orange hover:text-orange',
    loading: 'bg-white border-gray-200 text-navy/50 cursor-not-allowed',
    copied: 'bg-green-50 border-green-300 text-green-700',
    error: 'bg-red-50 border-red-300 text-red-700',
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === 'loading'}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-body font-semibold border rounded-lg transition-colors disabled:cursor-not-allowed ${colorClass[state]}`}
    >
      {state === 'loading' ? (
        <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : state === 'copied' ? (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
        </svg>
      )}
      {label[state]}
    </button>
  )
}
