'use client'

import { useState } from 'react'
import Link from 'next/link'

interface ClientWithoutDomain {
  id: number
  name: string
}

interface QueuedEntry {
  clientId: number
  auditId: string
}

interface SkippedEntry {
  clientId: number
  reason: string
}

interface Props {
  open: boolean
  eligibleCount: number
  clientsById: Map<number, string>  // clientId → name, for skip-list display
  onClose: () => void
  onConfirmed: (queued: QueuedEntry[], skipped: SkippedEntry[]) => void
}

type Phase =
  | { kind: 'confirm' }
  | { kind: 'missing'; clients: ClientWithoutDomain[] }
  | { kind: 'running' }
  | { kind: 'done'; queued: QueuedEntry[]; skipped: SkippedEntry[] }

export default function BulkQueueModal({ open, eligibleCount, clientsById, onClose, onConfirmed }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'confirm' })

  if (!open) return null

  const submit = async () => {
    setPhase({ kind: 'running' })
    try {
      const res = await fetch('/api/site-audit/bulk-queue', { method: 'POST' })
      if (res.status === 400) {
        const body = await res.json() as { clientsWithoutDomains?: ClientWithoutDomain[] }
        setPhase({ kind: 'missing', clients: body.clientsWithoutDomains ?? [] })
        return
      }
      if (res.ok) {
        const body = await res.json() as { queued: QueuedEntry[]; skipped: SkippedEntry[] }
        setPhase({ kind: 'done', queued: body.queued, skipped: body.skipped })
        onConfirmed(body.queued, body.skipped)
        return
      }
      setPhase({ kind: 'done', queued: [], skipped: [{ clientId: -1, reason: `Server error (HTTP ${res.status})` }] })
    } catch (e) {
      setPhase({ kind: 'done', queued: [], skipped: [{ clientId: -1, reason: (e as Error).message }] })
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
            {phase.kind === 'confirm' && 'Queue all clients'}
            {phase.kind === 'missing' && 'Missing domains'}
            {phase.kind === 'running' && 'Queueing…'}
            {phase.kind === 'done' && 'Queue results'}
          </h2>
        </div>

        <div className="p-6 space-y-3">
          {phase.kind === 'confirm' && (
            <p className="font-body text-[13px] text-navy dark:text-white">
              Queue audits for <strong>{eligibleCount}</strong> clients? Each audit runs with wcag21aa.
            </p>
          )}

          {phase.kind === 'missing' && (
            <>
              <p className="font-body text-[13px] text-navy dark:text-white">
                These clients have no domain configured. Add a domain for each, then try again.
              </p>
              <ul className="space-y-1">
                {phase.clients.map((c) => (
                  <li key={c.id} className="text-[13px] font-body text-navy dark:text-white">
                    <Link href="/clients/manage" className="text-orange hover:underline">{c.name}</Link>
                  </li>
                ))}
              </ul>
            </>
          )}

          {phase.kind === 'running' && (
            <p className="font-body text-[13px] text-navy/60 dark:text-white/60">
              Queueing audits sequentially…
            </p>
          )}

          {phase.kind === 'done' && (
            <>
              <p className="font-body text-[13px] text-navy dark:text-white">
                Queued <strong>{phase.queued.length}</strong>, skipped <strong>{phase.skipped.length}</strong>.
              </p>
              {phase.skipped.length > 0 && (
                <ul className="space-y-1 text-[12px] font-body text-navy/70 dark:text-white/70">
                  {phase.skipped.map((s, i) => (
                    <li key={i}>
                      <span className="font-semibold">{clientsById.get(s.clientId) ?? `client #${s.clientId}`}:</span> {s.reason}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-100 dark:border-navy-border flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="text-[12px] font-body text-navy/70 dark:text-white/70 hover:text-orange"
          >
            {phase.kind === 'done' || phase.kind === 'missing' ? 'Close' : 'Cancel'}
          </button>
          {phase.kind === 'confirm' && (
            <button
              type="button"
              onClick={submit}
              className="text-[12px] font-body font-semibold text-white bg-orange hover:bg-orange/90 rounded-md px-3 py-1.5"
            >
              Queue {eligibleCount} audits
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
