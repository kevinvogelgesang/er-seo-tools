'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import PaginatedSection from './PaginatedSection'
import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue'
import type { ClientAuditSummary } from '@/lib/ada-audit/types'

type SortKey = 'name-asc' | 'name-desc' | 'date-asc' | 'date-desc' | 'score-asc' | 'score-desc'
const DEFAULT_SORT: SortKey = 'date-desc'

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-navy/25 dark:text-white/25">—</span>
  const color = score >= 80
    ? 'bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400'
    : score >= 50
      ? 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400'
      : 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400'
  return <span className={`text-[11px] font-body font-semibold px-2 py-0.5 rounded ${color}`}>{score}</span>
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

  // Local search input (instant) + debounced URL sync
  const [searchInput, setSearchInput] = useState(searchParams.get('clientsSearch') ?? '')
  const debouncedSearch = useDebouncedValue(searchInput, 300)
  const sort: SortKey = (searchParams.get('clientsSort') as SortKey) || DEFAULT_SORT

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

  const trailing = (
    <input
      type="text"
      value={searchInput}
      onChange={(e) => setSearchInput(e.target.value)}
      placeholder="Search clients by name"
      className="bg-white dark:bg-navy-deep border border-gray-200 dark:border-navy-border rounded-md px-3 py-1.5 text-[12px] font-body w-56"
    />
  )

  return (
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
                <td className="px-6 py-3"><ScoreBadge score={la?.score ?? null} /></td>
                <td className="px-6 py-3 text-right">
                  {la ? (
                    <Link href={`/ada-audit/site/${la.id}`} className="text-[12px] text-orange hover:underline">View →</Link>
                  ) : c.firstDomain ? (
                    // Include auditTab=site so AuditIndexTabs opens on the
                    // Full Site tab (its default state is 'single'). Without
                    // this param the prefilled domain would be invisible to
                    // the user until they manually click Full Site.
                    <Link href={`/ada-audit/?auditTab=site&prefillDomain=${encodeURIComponent(c.firstDomain)}`} className="text-[12px] text-orange hover:underline">Run audit</Link>
                  ) : (
                    <button
                      type="button"
                      disabled
                      title="Add a domain on the Clients page to enable audits."
                      className="text-[12px] text-navy/30 dark:text-white/30 cursor-not-allowed"
                    >
                      Run audit
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </PaginatedSection>
  )
}
