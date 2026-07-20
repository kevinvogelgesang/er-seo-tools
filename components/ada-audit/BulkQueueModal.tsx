'use client'

import { useState } from 'react'
import Link from 'next/link'

interface Props {
  open: boolean
  eligibleCount: number
  onClose: () => void
  /** Called after a sweep is successfully started (parent may refresh its view). */
  onStarted?: () => void
}

type Phase =
  | { kind: 'confirm' }
  | { kind: 'running' }
  | { kind: 'started' }
  | { kind: 'already-running' }
  | { kind: 'error'; message: string }

export default function BulkQueueModal({ open, eligibleCount, onClose, onStarted }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'confirm' })

  if (!open) return null

  const submit = async () => {
    setPhase({ kind: 'running' })
    try {
      const res = await fetch('/api/site-audit/bulk-queue', { method: 'POST' })
      if (res.ok) {
        setPhase({ kind: 'started' })
        onStarted?.()
        return
      }
      if (res.status === 409) {
        setPhase({ kind: 'already-running' })
        return
      }
      setPhase({ kind: 'error', message: `Server error (HTTP ${res.status})` })
    } catch (e) {
      setPhase({ kind: 'error', message: (e as Error).message })
    }
  }

  const close = () => {
    setPhase({ kind: 'confirm' })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={close}>
      <div
        className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-xl max-w-lg w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-100 dark:border-navy-border">
          <h2 className="font-display font-bold text-[17px] text-navy dark:text-white">
            {phase.kind === 'confirm' && 'Scan all clients & refresh Issues'}
            {phase.kind === 'running' && 'Starting sweep…'}
            {phase.kind === 'started' && 'Sweep started'}
            {phase.kind === 'already-running' && 'Already running'}
            {phase.kind === 'error' && 'Something went wrong'}
          </h2>
        </div>

        <div className="p-6 space-y-3">
          {phase.kind === 'confirm' && (
            <>
              <p className="font-body text-[13px] text-navy dark:text-white">
                Run a full <strong>Accessibility + SEO</strong> scan of every registered domain across your{' '}
                <strong>{eligibleCount}</strong> clients, then refresh the{' '}
                <Link href="/issues" className="text-orange hover:underline">Issues</Link> page with the results.
              </p>
              <p className="font-body text-[12px] text-navy/60 dark:text-white/60">
                This is a full sweep — it can take a while, and it does <strong>not</strong> send an email. The Monday
                digest still reflects the Sunday scheduled sweep. Issues updates automatically once the scans finish.
              </p>
            </>
          )}

          {phase.kind === 'running' && (
            <p className="font-body text-[13px] text-navy/60 dark:text-white/60">Freezing the cohort and queueing audits…</p>
          )}

          {phase.kind === 'started' && (
            <p className="font-body text-[13px] text-navy dark:text-white">
              The sweep is running. The{' '}
              <Link href="/issues" className="text-orange hover:underline">Issues</Link> page will update automatically
              when the scans finish (typically within a few minutes to an hour, depending on fleet size).
            </p>
          )}

          {phase.kind === 'already-running' && (
            <p className="font-body text-[13px] text-navy dark:text-white">
              A manual refresh is already running. Wait for it to finish, then check the{' '}
              <Link href="/issues" className="text-orange hover:underline">Issues</Link> page.
            </p>
          )}

          {phase.kind === 'error' && (
            <p className="font-body text-[13px] text-red-600 dark:text-red-400">{phase.message}</p>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-100 dark:border-navy-border flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="text-[12px] font-body text-navy/70 dark:text-white/70 hover:text-orange"
          >
            {phase.kind === 'confirm' ? 'Cancel' : 'Close'}
          </button>
          {phase.kind === 'confirm' && (
            <button
              type="button"
              onClick={submit}
              disabled={eligibleCount === 0}
              className="text-[12px] font-body font-semibold text-white bg-orange hover:bg-orange/90 disabled:opacity-50 rounded-md px-3 py-1.5"
            >
              Start sweep
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
