'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Spinner } from '@/components/Spinner'

interface Props {
  url: string
  wcagLevel: string
  auditId: string
}

type State = 'idle' | 'loading' | 'error'

export default function ReScanButton({ url, wcagLevel, auditId }: Props) {
  const router = useRouter()
  const [state, setState] = useState<State>('idle')

  async function handleClick() {
    if (state === 'loading') return
    setState('loading')

    try {
      const res = await fetch('/api/ada-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, wcagLevel }),
      })
      const data = await res.json()

      if (!res.ok) {
        setState('error')
        setTimeout(() => setState('idle'), 3000)
        return
      }

      router.push(`/ada-audit/${data.id}?from=${auditId}`)
    } catch {
      setState('error')
      setTimeout(() => setState('idle'), 3000)
    }
  }

  const colorClass: Record<State, string> = {
    idle: 'bg-white dark:bg-navy-card border-gray-300 dark:border-navy-border text-navy dark:text-white hover:border-orange hover:text-orange',
    loading: 'bg-white dark:bg-navy-card border-gray-200 dark:border-navy-border text-navy/50 dark:text-white/50 cursor-not-allowed',
    error: 'bg-red-50 dark:bg-red-500/10 border-red-300 dark:border-red-500/30 text-red-700 dark:text-red-400',
  }

  const label: Record<State, string> = {
    idle: 'Re-scan',
    loading: 'Starting\u2026',
    error: 'Error',
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === 'loading'}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-body font-semibold border rounded-lg transition-colors disabled:cursor-not-allowed ${colorClass[state]}`}
    >
      {state === 'loading' ? (
        <Spinner className="w-3 h-3" />
      ) : (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      )}
      {label[state]}
    </button>
  )
}
