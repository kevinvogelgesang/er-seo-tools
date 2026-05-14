'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import PaginatedSection from './PaginatedSection'
import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue'
import type { ClientAuditSummary, QueueStatusWithBatch } from '@/lib/ada-audit/types'
import BulkQueueModal from './BulkQueueModal'

type SortKey = 'name-asc' | 'name-desc' | 'date-asc' | 'date-desc' | 'score-asc' | 'score-desc'
const DEFAULT_SORT: SortKey = 'date-desc'

const SORT_KEYS: readonly SortKey[] = [
  'name-asc', 'name-desc', 'date-asc', 'date-desc', 'score-asc', 'score-desc',
] as const

/**
 * Coerce an arbitrary URL value into a valid SortKey. Anything not in the
 * known list (including null) returns DEFAULT_SORT. Without this guard,
 * `/ada-audit?clientsSort=bad` would let an invalid key reach sortClients,
 * which has no default branch — it returns undefined, and the consumer
 * (view.length / view.map) then throws.
 */
function parseSort(value: string | null): SortKey {
  return (SORT_KEYS as readonly string[]).includes(value ?? '')
    ? (value as SortKey)
    : DEFAULT_SORT
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-navy/25 dark:text-white/25">—</span>
  const color = score >= 80
    ? 'bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400'
    : score >= 50
      ? 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400'
      : 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400'
  return <span className={`text-[11px] font-body font-semibold px-2 py-0.5 rounded ${color}`}>{score}</span>
}

function ChipForStatus({ status }: { status: string | undefined }) {
  if (!status) return null
  const label = status === 'queued' ? 'Queued' : status === 'running' ? 'Running' : status === 'pdfs-running' ? 'Scanning PDFs' : status
  const color =
    status === 'queued'
      ? 'bg-gray-100 dark:bg-gray-500/15 text-gray-700 dark:text-gray-300'
      : 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400'
  return (
    <span className={`text-[11px] font-body font-semibold px-2 py-0.5 rounded ml-2 ${color}`}>
      {label}
    </span>
  )
}

function compareDateDesc(a: ClientAuditSummary, b: ClientAuditSummary): number {
  // Never-scanned always sort to bottom regardless of asc/desc
  if (!a.latestSiteAudit && !b.latestSiteAudit) return a.clientName.localeCompare(b.clientName)
  if (!a.latestSiteAudit) return 1
  if (!b.latestSiteAudit) return -1
  return b.latestSiteAudit.createdAt.localeCompare(a.latestSiteAudit.createdAt)
}

function compareDateAsc(a: ClientAuditSummary, b: ClientAuditSummary): number {
  if (!a.latestSiteAudit && !b.latestSiteAudit) return a.clientName.localeCompare(b.clientName)
  if (!a.latestSiteAudit) return 1
  if (!b.latestSiteAudit) return -1
  return a.latestSiteAudit.createdAt.localeCompare(b.latestSiteAudit.createdAt)
}

function compareScore(asc: boolean) {
  return (a: ClientAuditSummary, b: ClientAuditSummary): number => {
    const av = a.latestSiteAudit?.score
    const bv = b.latestSiteAudit?.score
    if (av == null && bv == null) return a.clientName.localeCompare(b.clientName)
    if (av == null) return 1
    if (bv == null) return -1
    return asc ? av - bv : bv - av
  }
}

function sortClients(rows: ClientAuditSummary[], sort: SortKey): ClientAuditSummary[] {
  const out = [...rows]
  switch (sort) {
    case 'name-asc':   return out.sort((a, b) => a.clientName.localeCompare(b.clientName))
    case 'name-desc':  return out.sort((a, b) => b.clientName.localeCompare(a.clientName))
    case 'date-asc':   return out.sort(compareDateAsc)
    case 'date-desc':  return out.sort(compareDateDesc)
    case 'score-asc':  return out.sort(compareScore(true))
    case 'score-desc': return out.sort(compareScore(false))
  }
}

export default function ClientsAuditSummary() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const [data, setData] = useState<ClientAuditSummary[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [queueingClientId, setQueueingClientId] = useState<number | null>(null)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [queueStatus, setQueueStatus] = useState<QueueStatusWithBatch | null>(null)
  const [bulkModalOpen, setBulkModalOpen] = useState(false)

  const queueClient = useCallback(async (client: ClientAuditSummary) => {
    if (!client.firstDomain) return  // disabled state covers this
    setQueueingClientId(client.clientId)
    try {
      const res = await fetch('/api/site-audit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain: client.firstDomain, clientId: client.clientId }),
      })
      if (res.status === 202) {
        setToast({ kind: 'success', message: `Queued audit for ${client.clientName}` })
      } else if (res.status === 409) {
        setToast({ kind: 'error', message: `${client.clientName} already queued` })
      } else {
        const body = await res.json().catch(() => ({})) as { error?: string }
        setToast({ kind: 'error', message: body.error ?? `Couldn't queue audit (HTTP ${res.status})` })
      }
    } catch (e) {
      setToast({ kind: 'error', message: `Couldn't queue audit: ${(e as Error).message}` })
    } finally {
      setQueueingClientId(null)
      setTimeout(() => setToast(null), 4000)
    }
  }, [])

  // Local search input (instant) + debounced URL sync
  const [searchInput, setSearchInput] = useState(searchParams.get('clientsSearch') ?? '')
  const debouncedSearch = useDebouncedValue(searchInput, 300)
  const sort: SortKey = parseSort(searchParams.get('clientsSort'))

  const fetchClients = useCallback(async (silent: boolean) => {
    if (!silent) setLoading(true)
    try {
      const res = await fetch('/api/clients/audit-summary')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: ClientAuditSummary[] = await res.json()
      setData(json)
      setError(null)
    } catch (e) {
      if (data === null) setError(e instanceof Error ? e.message : 'Failed to load clients')
      else console.warn('[ClientsAuditSummary] poll failed:', e)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [data])

  useEffect(() => { void fetchClients(false) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const id = setInterval(() => void fetchClients(true), 30_000)
    return () => clearInterval(id)
  }, [fetchClients])

  useEffect(() => {
    const fetchQueue = async () => {
      try {
        const res = await fetch('/api/site-audit/queue')
        if (res.ok) setQueueStatus(await res.json() as QueueStatusWithBatch)
      } catch { /* silent — polling is fail-tolerant */ }
    }
    void fetchQueue()
    const id = setInterval(fetchQueue, 30_000)
    return () => clearInterval(id)
  }, [])

  // Build a clientId -> status map for chip lookup. The active row carries the
  // literal SiteAudit.status (running | pdfs-running | pending) — the chip
  // renders the matching label.
  const inFlightByClient = useMemo(() => {
    const map = new Map<number, string>()
    if (queueStatus?.active && queueStatus.active.clientId != null) {
      map.set(queueStatus.active.clientId, queueStatus.active.status)
    }
    for (const q of queueStatus?.queued ?? []) {
      if (q.clientId != null) map.set(q.clientId, 'queued')
    }
    return map
  }, [queueStatus])

  // Debounced URL sync for search
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    if (debouncedSearch) params.set('clientsSearch', debouncedSearch)
    else params.delete('clientsSearch')
    router.replace(`?${params.toString()}`, { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch])

  const setSort = (next: SortKey) => {
    const params = new URLSearchParams(searchParams.toString())
    if (next === DEFAULT_SORT) params.delete('clientsSort')
    else params.set('clientsSort', next)
    router.replace(`?${params.toString()}`, { scroll: false })
  }

  const view = useMemo(() => {
    const rows = data ?? []
    const filtered = searchInput.trim()
      ? rows.filter((r) => r.clientName.toLowerCase().includes(searchInput.trim().toLowerCase()))
      : rows
    return sortClients(filtered, sort)
  }, [data, searchInput, sort])

  const filtered = !!searchInput.trim()
  const filterCount = `Filtered to ${view.length} of ${data?.length ?? 0} clients`

  const SortHeader = ({ label, ascKey, descKey, currentSort }: { label: string; ascKey: SortKey; descKey: SortKey; currentSort: SortKey }) => {
    const isActive = currentSort === ascKey || currentSort === descKey
    const isAsc = currentSort === ascKey
    return (
      <button
        type="button"
        onClick={() => setSort(isActive && !isAsc ? ascKey : descKey)}
        className={`text-[11px] uppercase tracking-wider font-body font-semibold flex items-center gap-1 ${isActive ? 'text-orange' : 'text-navy/50 dark:text-white/50'} hover:text-orange`}
      >
        {label}
        {isActive && <span aria-hidden>{isAsc ? '↑' : '↓'}</span>}
      </button>
    )
  }

  const clientsById = useMemo(() => {
    const m = new Map<number, string>()
    for (const c of data ?? []) m.set(c.clientId, c.clientName)
    return m
  }, [data])

  const eligibleCount = (data ?? []).filter((c) => c.firstDomain).length

  const trailing = (
    <div className="flex items-center gap-3">
      <input
        type="text"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        placeholder="Search clients by name"
        className="bg-white dark:bg-navy-deep border border-gray-200 dark:border-navy-border rounded-md px-3 py-1.5 text-[12px] font-body w-56"
      />
      <button
        type="button"
        onClick={() => setBulkModalOpen(true)}
        disabled={eligibleCount === 0}
        className="text-[12px] font-body font-semibold text-orange hover:underline disabled:opacity-50"
      >
        Queue all
      </button>
      <Link
        href="/ada-audit/queue"
        className="text-[12px] font-body font-semibold text-orange hover:underline"
      >
        View queue →
      </Link>
    </div>
  )

  return (
    <>
    <PaginatedSection
      title="Clients"
      icon={<svg className="w-4 h-4 text-orange" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-5.13a4 4 0 11-8 0 4 4 0 018 0zM21 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>}
      trailing={trailing}
      rowCount={view.length}
      loading={loading}
      error={error}
      onRetry={() => void fetchClients(false)}
      empty={data && data.length === 0
        ? <>No clients yet — add some at <Link href="/clients" className="text-orange hover:underline">/clients</Link>.</>
        : filtered ? `No clients match "${searchInput}".` : 'No clients.'}
    >
      {toast && (
        <div className={`px-6 py-2 text-[12px] font-body ${
          toast.kind === 'success'
            ? 'bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400'
            : 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400'
        }`}>
          {toast.message}
        </div>
      )}
      <table className="w-full">
        <thead className="sticky top-0 bg-gray-50 dark:bg-navy-deep">
          <tr className="border-b border-gray-100 dark:border-navy-border">
            <th className="text-left px-6 py-2"><SortHeader label="Client"     ascKey="name-asc" descKey="name-desc" currentSort={sort} /></th>
            <th className="text-left px-6 py-2"><SortHeader label="Last audit" ascKey="date-asc" descKey="date-desc" currentSort={sort} /></th>
            <th className="text-left px-6 py-2"><SortHeader label="Score"      ascKey="score-asc" descKey="score-desc" currentSort={sort} /></th>
            <th className="text-right px-6 py-2 text-[11px] uppercase tracking-wider font-body font-semibold text-navy/50 dark:text-white/50">Action</th>
          </tr>
          {filtered && (
            <tr>
              <td colSpan={4} className="px-6 py-1 text-[11px] font-body text-navy/40 dark:text-white/40">{filterCount}</td>
            </tr>
          )}
        </thead>
        <tbody>
          {view.map((c) => {
            const la = c.latestSiteAudit
            return (
              <tr key={c.clientId} className="border-b border-gray-50 dark:border-navy-border/50 hover:bg-gray-50/50 dark:hover:bg-navy-deep/30">
                <td className="px-6 py-3 font-body text-[13px] text-navy dark:text-white">
                  {la ? (
                    <Link href={`/ada-audit/site/${la.id}`} className="hover:text-orange">{c.clientName}</Link>
                  ) : (
                    <Link href="/clients" className="hover:text-orange">{c.clientName}</Link>
                  )}
                </td>
                <td className="px-6 py-3 font-body text-[12px] text-navy/60 dark:text-white/60">
                  {la ? new Date(la.createdAt).toLocaleDateString() : '—'}
                </td>
                <td className="px-6 py-3">
                  <ScoreBadge score={la?.score ?? null} />
                  <ChipForStatus status={inFlightByClient.get(c.clientId)} />
                </td>
                <td className="px-6 py-3 text-right whitespace-nowrap">
                  {la && (
                    <Link
                      href={`/ada-audit/site/${la.id}`}
                      className="text-[12px] text-orange hover:underline mr-3"
                    >
                      View →
                    </Link>
                  )}
                  {c.firstDomain ? (
                    <button
                      type="button"
                      onClick={() => queueClient(c)}
                      disabled={queueingClientId === c.clientId}
                      className="text-[12px] text-orange hover:underline disabled:opacity-50 disabled:cursor-wait"
                    >
                      {queueingClientId === c.clientId ? 'Queueing…' : (la ? 'Re-queue' : 'Queue audit')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled
                      title="Add a domain on the Clients page to enable audits."
                      className="text-[12px] text-navy/30 dark:text-white/30 cursor-not-allowed"
                    >
                      Queue audit
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </PaginatedSection>
    <BulkQueueModal
      open={bulkModalOpen}
      eligibleCount={eligibleCount}
      clientsById={clientsById}
      onClose={() => setBulkModalOpen(false)}
      onConfirmed={() => { void fetchClients(false) }}
    />
    </>
  )
}
