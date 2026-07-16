'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { jsonFetch, publicViewbookUrl, type ViewbookListRow } from './viewbook-admin-shared'
import { isViewbookStage, STAGE_LABELS } from '@/lib/viewbook/stages'

interface ClientRow {
  id: number
  name: string
  archivedAt: string | null
}

export function ViewbookIndex() {
  const [rows, setRows] = useState<ViewbookListRow[] | null>(null)
  const [clients, setClients] = useState<ClientRow[]>([])
  const [clientId, setClientId] = useState('')
  const [kind, setKind] = useState<'new-build' | 'upgrade'>('new-build')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copiedId, setCopiedId] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const [{ viewbooks }, clientsRes] = await Promise.all([
        jsonFetch<{ viewbooks: ViewbookListRow[] }>('/api/viewbooks'),
        jsonFetch<ClientRow[] | { clients: ClientRow[] }>('/api/clients'),
      ])
      setRows(viewbooks)
      const list = Array.isArray(clientsRes) ? clientsRes : clientsRes.clients
      setClients((list ?? []).filter((c) => !c.archivedAt))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load_failed')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function create() {
    if (!clientId) return
    setBusy(true)
    setError(null)
    try {
      await jsonFetch('/api/viewbooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: Number(clientId), kind }),
      })
      setClientId('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'create_failed')
    } finally {
      setBusy(false)
    }
  }

  async function copyLink(row: ViewbookListRow) {
    await navigator.clipboard.writeText(publicViewbookUrl(row.token))
    setCopiedId(row.id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  const existing = new Set((rows ?? []).map((r) => r.clientName))

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-navy-border dark:bg-navy-card">
        <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-white/80">Create a viewbook</h2>
        {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-navy-border dark:bg-navy-card dark:text-white"
            aria-label="Client"
          >
            <option value="">Select client…</option>
            {clients
              .filter((c) => !existing.has(c.name))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as 'new-build' | 'upgrade')}
            className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-navy-border dark:bg-navy-card dark:text-white"
            aria-label="Kind"
          >
            <option value="new-build">New build</option>
            <option value="upgrade">Upgrade</option>
          </select>
          <button
            onClick={() => void create()}
            disabled={busy || !clientId}
            className="rounded bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create viewbook'}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-navy-border dark:bg-navy-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500 dark:border-navy-border dark:text-white/50">
              <th className="px-4 py-2">Client</th>
              <th className="px-4 py-2">Kind</th>
              <th className="px-4 py-2">Project stage</th>
              <th className="px-4 py-2">Current milestone</th>
              <th className="px-4 py-2">Data lock</th>
              <th className="px-4 py-2">Link</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-gray-400">Loading…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-gray-400">No viewbooks yet.</td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-gray-100 last:border-0 dark:border-navy-border/50">
                  <td className="px-4 py-2 font-medium text-gray-900 dark:text-white">
                    {r.clientName}
                    {r.clientArchived && <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">archived</span>}
                  </td>
                  <td className="px-4 py-2 text-gray-600 dark:text-white/70">{r.kind}</td>
                  <td className="px-4 py-2">
                    <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-800 dark:bg-teal-500/10 dark:text-teal-400">
                      {isViewbookStage(r.stage) ? STAGE_LABELS[r.stage] : r.stage}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-600 dark:text-white/70">{r.currentMilestone ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-600 dark:text-white/70">{r.dataLockedAt ? 'Locked' : 'Open'}</td>
                  <td className="px-4 py-2">
                    {r.revoked ? (
                      <span className="text-xs text-red-600 dark:text-red-400">revoked</span>
                    ) : (
                      <button
                        onClick={() => void copyLink(r)}
                        className="text-xs text-teal-700 underline hover:text-teal-900 dark:text-teal-400"
                      >
                        {copiedId === r.id ? 'Copied!' : 'Copy link'}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link href={`/viewbooks/${r.id}`} className="text-xs font-medium text-teal-700 hover:underline dark:text-teal-400">
                      Open editor →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
