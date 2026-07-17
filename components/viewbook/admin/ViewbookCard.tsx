'use client'

// Client-page card: create the client's viewbook, or open its editor / copy
// the public link.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { jsonFetch, publicViewbookUrl, type ViewbookListRow } from './viewbook-admin-shared'

export function ViewbookCard({ clientId, clientName }: { clientId: number; clientName: string }) {
  const [row, setRow] = useState<ViewbookListRow | null | undefined>(undefined)
  const [kind, setKind] = useState<'new-build' | 'upgrade'>('upgrade')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      const { viewbooks } = await jsonFetch<{ viewbooks: ViewbookListRow[] }>('/api/viewbooks')
      setRow(viewbooks.find((v) => v.clientName === clientName) ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load_failed')
      setRow(null)
    }
  }, [clientName])

  useEffect(() => {
    void load()
  }, [load])

  async function create() {
    setBusy(true)
    setError(null)
    try {
      await jsonFetch('/api/viewbooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, kind }),
      })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'create_failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-navy-border dark:bg-navy-card">
      <h2 className="mb-2 text-sm font-semibold text-gray-700 dark:text-white/80">Client Viewbook</h2>
      {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {row === undefined ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : row ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {row.revoked ? (
            <span className="font-medium text-gray-900 dark:text-white">{clientName}</span>
          ) : (
            <a
              href={publicViewbookUrl(row.token)}
              target="_blank"
              rel="noopener"
              className="font-medium text-gray-900 hover:underline dark:text-white"
            >
              {clientName}
            </a>
          )}
          <Link href={`/viewbooks/${row.id}`} className="font-medium text-teal-700 hover:underline dark:text-teal-400">
            Open editor →
          </Link>
          {row.revoked ? (
            <span className="text-xs text-red-600 dark:text-red-400">link revoked</span>
          ) : (
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(publicViewbookUrl(row.token))
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
              className="text-xs text-teal-700 underline dark:text-teal-400"
            >
              {copied ? 'Copied!' : 'Copy public link'}
            </button>
          )}
          <span className="text-xs text-gray-500 dark:text-white/50">
            {row.kind} · {row.currentMilestone ?? 'no current stage'}
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as 'new-build' | 'upgrade')}
            className="rounded border border-gray-300 bg-white px-2 py-1 dark:border-navy-border dark:bg-navy-card dark:text-white"
            aria-label="Viewbook kind"
          >
            <option value="upgrade">Upgrade</option>
            <option value="new-build">New build</option>
          </select>
          <button
            onClick={() => void create()}
            disabled={busy}
            className="rounded bg-teal-600 px-3 py-1.5 font-medium text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create viewbook'}
          </button>
        </div>
      )}
    </div>
  )
}
