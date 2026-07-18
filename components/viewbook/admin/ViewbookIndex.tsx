'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { jsonFetch, publicViewbookUrl, type ViewbookListRow } from './viewbook-admin-shared'
import { isViewbookStage, STAGE_LABELS } from '@/lib/viewbook/stages'
import { StatusPill } from '@/components/ui/StatusPill'
import { editorInputClass, editorPrimaryBtnClass, editorSecondaryBtnClass } from '@/components/viewbook/editor'

interface ClientRow {
  id: number
  name: string
  archivedAt: string | null
}

function kindLabel(kind: string): string {
  return kind.split('-').map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ')
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
      setClients((list ?? []).filter((client) => !client.archivedAt))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'load_failed')
    }
  }, [])

  useEffect(() => { void load() }, [load])

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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'create_failed')
    } finally {
      setBusy(false)
    }
  }

  async function copyLink(row: ViewbookListRow) {
    await navigator.clipboard.writeText(publicViewbookUrl(row.token))
    setCopiedId(row.id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  const existing = new Set((rows ?? []).map((row) => row.clientName))

  return (
    <div className="space-y-6 font-body">
      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-navy-border dark:bg-navy-card">
        <div>
          <h2 className="font-display text-base font-bold text-navy dark:text-white">Create a viewbook</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-white/55">Start a client workspace using the appropriate project type.</p>
        </div>
        {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(140px,auto)_auto]">
          <select value={clientId} onChange={(event) => setClientId(event.target.value)} className={editorInputClass} aria-label="Client">
            <option value="">Select client…</option>
            {clients.filter((client) => !existing.has(client.name)).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
          <select value={kind} onChange={(event) => setKind(event.target.value as 'new-build' | 'upgrade')} className={editorInputClass} aria-label="Kind">
            <option value="new-build">New build</option>
            <option value="upgrade">Upgrade</option>
          </select>
          <button type="button" onClick={() => void create()} disabled={busy || !clientId} className={editorPrimaryBtnClass}>{busy ? 'Creating…' : 'Create viewbook'}</button>
        </div>
      </section>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm dark:border-navy-border dark:bg-navy-card">
        <table className="min-w-[980px] w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/80 text-left text-xs uppercase tracking-wide text-gray-500 dark:border-navy-border dark:bg-navy-deep/40 dark:text-white/50">
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Kind</th>
              <th className="px-4 py-3">Project stage</th>
              <th className="px-4 py-3">Current milestone</th>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">Public link</th>
              <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400 dark:text-white/40">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500 dark:text-white/55">No viewbooks yet.</td></tr>
            ) : rows.map((row) => (
              <tr
                key={row.id}
                className={`border-b border-gray-100 transition-colors last:border-0 hover:bg-gray-50 dark:border-navy-border/50 dark:hover:bg-navy-light/55 ${row.revoked ? 'bg-red-50/30 dark:bg-red-500/5' : row.clientArchived ? 'bg-amber-50/30 dark:bg-amber-500/5' : ''}`}
              >
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {row.revoked ? (
                      <span className="font-semibold text-navy dark:text-white">{row.clientName}</span>
                    ) : (
                      <a href={publicViewbookUrl(row.token)} target="_blank" rel="noopener" className="font-semibold text-navy hover:text-teal-700 hover:underline dark:text-white dark:hover:text-teal-300">{row.clientName}</a>
                    )}
                    {row.clientArchived && <StatusPill label="Archived client" tone="warning" />}
                  </div>
                </td>
                <td className="px-4 py-3"><StatusPill label={kindLabel(row.kind)} tone="neutral" /></td>
                <td className="px-4 py-3"><StatusPill label={isViewbookStage(row.stage) ? STAGE_LABELS[row.stage] : row.stage} tone="running" /></td>
                <td className="px-4 py-3 text-gray-600 dark:text-white/70">{row.currentMilestone ?? '—'}</td>
                <td className="px-4 py-3"><StatusPill label={row.dataLockedAt ? 'Locked' : 'Open'} tone={row.dataLockedAt ? 'warning' : 'success'} /></td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill label={row.revoked ? 'Link revoked' : 'Link active'} tone={row.revoked ? 'error' : 'success'} />
                    {!row.revoked && (
                      <button type="button" onClick={() => void copyLink(row)} className="text-xs font-semibold text-teal-700 hover:underline dark:text-teal-300">
                        {copiedId === row.id ? 'Copied!' : 'Copy link'}
                      </button>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/viewbooks/${row.id}`} className={`${editorPrimaryBtnClass} min-h-8 whitespace-nowrap px-2.5 py-1 text-xs`}>Open editor</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
