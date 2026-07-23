'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { jsonFetch, publicViewbookUrl, type ViewbookListRow } from './viewbook-admin-shared'
import { isViewbookStage, STAGE_LABELS } from '@/lib/viewbook/stages'
import { StatusPill } from '@/components/ui/StatusPill'
import { editorInputClass, editorPrimaryBtnClass, editorSecondaryBtnClass } from '@/components/viewbook/editor'

function kindLabel(kind: string): string {
  return kind.split('-').map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ')
}

export function ViewbookCard({ clientId, clientName }: { clientId: number; clientName: string }) {
  const [row, setRow] = useState<ViewbookListRow | null | undefined>(undefined)
  const [kind, setKind] = useState<'new-build' | 'upgrade'>('upgrade')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      const { viewbooks } = await jsonFetch<{ viewbooks: ViewbookListRow[] }>('/api/viewbooks')
      setRow(viewbooks.find((viewbook) => viewbook.clientName === clientName) ?? null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'load_failed')
      setRow(null)
    }
  }, [clientName])

  useEffect(() => { void load() }, [load])

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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'create_failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-navy-border dark:bg-navy-card">
      <div>
        <h2 className="font-display text-base font-bold text-navy dark:text-white">Onboarding Viewbook</h2>
        <p className="mt-1 text-xs text-gray-500 dark:text-white/55">Manage the client-facing project workspace and public link.</p>
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
      {row === undefined ? (
        <p className="mt-4 text-sm text-gray-400 dark:text-white/40">Loading…</p>
      ) : row ? (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              {row.revoked ? (
                <span className="font-display font-semibold text-navy dark:text-white">{clientName}</span>
              ) : (
                <a href={publicViewbookUrl(row.token)} target="_blank" rel="noopener" className="font-display font-semibold text-navy hover:text-teal-700 hover:underline dark:text-white dark:hover:text-teal-300">{clientName}</a>
              )}
              <p className="mt-1 text-xs text-gray-500 dark:text-white/55">Current milestone: {row.currentMilestone ?? 'No current milestone'}</p>
            </div>
            {row.clientArchived && <StatusPill label="Archived client" tone="warning" />}
          </div>

          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-gray-50/70 p-2.5 dark:border-navy-border dark:bg-navy-deep/35">
              <dt className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-white/45">Kind</dt>
              <dd className="mt-1"><StatusPill label={kindLabel(row.kind)} tone="neutral" /></dd>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50/70 p-2.5 dark:border-navy-border dark:bg-navy-deep/35">
              <dt className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-white/45">Stage</dt>
              <dd className="mt-1"><StatusPill label={isViewbookStage(row.stage) ? STAGE_LABELS[row.stage] : row.stage} tone="running" /></dd>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50/70 p-2.5 dark:border-navy-border dark:bg-navy-deep/35">
              <dt className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-white/45">Data source</dt>
              <dd className="mt-1"><StatusPill label={row.dataLockedAt ? 'Data locked' : 'Data open'} tone={row.dataLockedAt ? 'warning' : 'success'} /></dd>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50/70 p-2.5 dark:border-navy-border dark:bg-navy-deep/35">
              <dt className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-white/45">Public link</dt>
              <dd className="mt-1"><StatusPill label={row.revoked ? 'Link revoked' : 'Link active'} tone={row.revoked ? 'error' : 'success'} /></dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-2">
            <Link href={`/viewbooks/${row.id}`} className={editorPrimaryBtnClass}>Open editor</Link>
            {!row.revoked && (
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(publicViewbookUrl(row.token))
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                }}
                className={editorSecondaryBtnClass}
              >
                {copied ? 'Copied!' : 'Copy public link'}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-gray-300 bg-gray-50/60 p-3 dark:border-navy-border dark:bg-navy-deep/30">
          <p className="text-sm font-medium text-navy dark:text-white">No viewbook created yet</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select value={kind} onChange={(event) => setKind(event.target.value as 'new-build' | 'upgrade')} className={`max-w-48 ${editorInputClass}`} aria-label="Viewbook kind">
              <option value="upgrade">Upgrade</option>
              <option value="new-build">New build</option>
            </select>
            <button type="button" onClick={() => void create()} disabled={busy} className={editorPrimaryBtnClass}>{busy ? 'Creating…' : 'Create viewbook'}</button>
          </div>
        </div>
      )}
    </section>
  )
}
