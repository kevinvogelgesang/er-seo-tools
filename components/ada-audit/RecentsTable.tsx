'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { RecentItem, RecentType } from '@/lib/ada-audit/recents-query'
import type { RecentStatusItem } from '@/lib/ada-audit/recents-status-shared'
import { ClientDate } from '@/components/ClientDate'
import { formatDuration, formatDurationHover } from '@/lib/ada-audit/duration'
import { useRecentsLivePoll } from './useRecentsLivePoll'

type Scope = 'all' | 'mine'
interface Props {
  initialItems: RecentItem[]
  initialNextCursor: string | null
  initialScope: Scope
  operator: string | null
  variant: 'home' | 'full'
}

const HOME_LIMIT = 10
const PAGE_LIMIT = 50
const SEARCH_DEBOUNCE_MS = 300

// C16 unified feed badges — one per source type.
const TYPE_BADGES: Record<RecentType, { label: string; className: string }> = {
  'site-ada': { label: 'Site ADA', className: 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300' },
  'site-seo': { label: 'Site SEO', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' },
  page: { label: 'Single Page', className: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' },
  'sf-upload': { label: 'SF Upload', className: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/60' },
}

export default function RecentsTable({ initialItems, initialNextCursor, initialScope, operator, variant }: Props) {
  const [items, setItems] = useState(initialItems)
  const [nextCursor, setNextCursor] = useState(initialNextCursor)
  const [scope, setScope] = useState<Scope>(initialScope)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  // Full-variant filters (C16 — HistoryList parity: search + client filter).
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [clientFilter, setClientFilter] = useState('')
  const [clients, setClients] = useState<{ id: number; name: string }[]>([])
  // Two-step session delete (C16 — HistoryList parity).
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const seqRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  const limit = variant === 'home' ? HOME_LIMIT : PAGE_LIMIT

  const buildParams = useCallback((s: Scope, cursor?: string | null) => {
    const p = new URLSearchParams({ scope: s, limit: String(limit) })
    if (q) p.set('q', q)
    if (clientFilter) p.set('clientId', clientFilter)
    if (cursor) p.set('cursor', cursor)
    return p
  }, [limit, q, clientFilter])

  // Debounce the search input into the applied q.
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [qInput])

  // Client list for the filter dropdown — full variant only.
  useEffect(() => {
    if (variant !== 'full') return
    const controller = new AbortController()
    fetch('/api/clients', { signal: controller.signal })
      .then((r) => r.json())
      .then((data: { id: number; name: string }[]) => {
        if (Array.isArray(data)) setClients(data)
      })
      .catch(() => { /* dropdown stays clients-less */ })
    return () => controller.abort()
  }, [variant])

  const refetch = useCallback(async (s: Scope) => {
    setLoading(true)
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    const seq = ++seqRef.current
    try {
      const res = await fetch(`/api/ada-audit/recents?${buildParams(s)}`, { signal: ac.signal })
      const json = await res.json() as { items: RecentItem[]; nextCursor: string | null }
      if (seq === seqRef.current) { setItems(json.items); setNextCursor(json.nextCursor) }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') console.warn('[RecentsTable] fetch failed:', e)
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }, [buildParams])

  const changeScope = useCallback(async (next: Scope) => {
    if (next === scope) return
    setScope(next)
    await refetch(next)
  }, [scope, refetch])

  // Refetch when the applied filters change (skip the initial mount — the
  // server already seeded initialItems for the empty-filter state).
  const firstFilterRun = useRef(true)
  useEffect(() => {
    if (firstFilterRun.current) { firstFilterRun.current = false; return }
    void refetch(scope)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, clientFilter])

  useEffect(() => () => { mountedRef.current = false }, [])

  const loadMore = useCallback(async () => {
    if (!nextCursor) return
    setLoadingMore(true)
    try {
      const res = await fetch(`/api/ada-audit/recents?${buildParams(scope, nextCursor)}`)
      const json = await res.json() as { items: RecentItem[]; nextCursor: string | null }
      if (!mountedRef.current) return
      setItems((prev) => [...prev, ...json.items])
      setNextCursor(json.nextCursor)
    } catch (e) {
      console.warn('[RecentsTable] load more failed:', e)
    } finally {
      if (mountedRef.current) setLoadingMore(false)
    }
  }, [nextCursor, buildParams, scope])

  const doDelete = useCallback(async (id: string) => {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/parse/${id}`, { method: 'DELETE' })
      if (res.ok) setItems((prev) => prev.filter((i) => !(i.type === 'sf-upload' && i.id === id)))
    } catch (e) {
      console.warn('[RecentsTable] delete failed:', e)
    } finally {
      setDeletingId(null)
      setConfirmDeleteId(null)
    }
  }, [])

  // C17 (plan Codex fix #2): per-row live progress detail from the compact
  // endpoint, keyed `type:id`. Kept OUTSIDE RecentItem — the merged query
  // stays cheap; this map only ever holds currently-polled rows.
  const [liveMeta, setLiveMeta] = useState<Record<string, RecentStatusItem>>({})

  const rows = variant === 'home' ? items.slice(0, HOME_LIMIT) : items
  const mineDisabled = !operator

  // C17: live-update the visible in-flight rows via the compact status
  // endpoint; refetch the merged list once when one settles. Stops when
  // nothing visible is in flight.
  useRecentsLivePoll({
    items: rows,
    onUpdate: (updates) => {
      setLiveMeta((prev) => {
        const next = { ...prev }
        for (const u of updates) next[`${u.type}:${u.id}`] = u
        return next
      })
      setItems((prev) =>
        prev.map((it) => {
          const u = updates.find((x) => x.type === it.type && x.id === it.id)
          return u
            ? { ...it, status: u.status, score: u.score, href: u.href, startedAt: u.startedAt, completedAt: u.completedAt, inFlight: u.inFlight }
            : it
        }),
      )
    },
    onSettled: () => void refetch(scope),
  })

  return (
    <section className={variant === 'home' ? 'rounded-2xl border border-gray-200 dark:border-navy-border bg-white dark:bg-navy-card p-5' : ''}>
      <div className="flex items-center justify-between mb-3">
        <div className="inline-flex rounded-lg border border-gray-200 dark:border-navy-border overflow-hidden text-[12px] font-body">
          <button type="button" onClick={() => void changeScope('all')}
            className={`px-3 py-1 ${scope === 'all' ? 'bg-orange text-white' : 'text-navy/60 dark:text-white/60'}`}>All</button>
          <button type="button" disabled={mineDisabled} onClick={() => void changeScope('mine')}
            title={mineDisabled ? 'Set your operator on the dashboard' : undefined}
            className={`px-3 py-1 ${scope === 'mine' ? 'bg-orange text-white' : 'text-navy/60 dark:text-white/60'} ${mineDisabled ? 'opacity-40 cursor-not-allowed' : ''}`}>Mine</button>
        </div>
        {variant === 'home' && (
          <Link href="/ada-audit/recents" className="text-[12px] font-body text-orange hover:underline">See all recents →</Link>
        )}
      </div>
      {variant === 'full' && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input
            type="search" value={qInput} onChange={(e) => setQInput(e.target.value)}
            placeholder="Search domain, URL or file…"
            className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-navy-border bg-white dark:bg-navy-card text-[12px] font-body text-navy dark:text-white placeholder:text-navy/40 dark:placeholder:text-white/40 w-64"
          />
          <select
            value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}
            aria-label="Filter by client"
            className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-navy-border bg-white dark:bg-navy-card text-[12px] font-body text-navy dark:text-white"
          >
            <option value="">All clients</option>
            <option value="unassigned">Unassigned</option>
            {clients.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
          </select>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="text-[12px] font-body text-navy/50 dark:text-white/50">{loading ? 'Loading…' : 'No recents yet.'}</p>
      ) : (
        <table className="w-full text-[13px] font-body">
          <thead>
            <tr className="border-b border-gray-200 dark:border-navy-border text-left text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">
              <th className="pb-2 pr-4">Type</th><th className="pb-2 pr-4">URL / Domain</th>
              <th className="pb-2 pr-4">Client</th><th className="pb-2 pr-4">Operator</th>
              <th className="pb-2 pr-4">Status</th><th className="pb-2 pr-4">Score</th>
              <th className="pb-2 pr-4">Duration</th><th className="pb-2 pr-4">Date</th>
              {variant === 'full' && <th className="pb-2 pr-0" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((it) => {
              const badge = TYPE_BADGES[it.type]
              return (
                <tr key={`${it.type}-${it.id}`} className="border-b border-gray-100 dark:border-navy-border">
                  <td className="py-2.5 pr-4 whitespace-nowrap">
                    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${badge.className}`}>{badge.label}</span>
                    {it.prospectLinked && (
                      <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-heading font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                        Prospect
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 max-w-[280px] truncate"><Link href={it.href} className="text-orange hover:underline">{it.label}</Link></td>
                  <td className="py-2.5 pr-4 text-navy/60 dark:text-white/60">{it.clientName ?? '—'}</td>
                  <td className="py-2.5 pr-4 text-navy/60 dark:text-white/60">{it.requestedBy ?? '—'}</td>
                  <td className="py-2.5 pr-4 text-navy/60 dark:text-white/60">
                    {(() => {
                      const meta = it.inFlight ? liveMeta[`${it.type}:${it.id}`] : undefined
                      const pct = meta
                        ? meta.progressPct ?? (meta.pagesTotal ? Math.round(((meta.pagesDone ?? 0) / meta.pagesTotal) * 100) : null)
                        : null
                      const label = meta
                        ? meta.pagesTotal ? `${meta.pagesDone ?? 0}/${meta.pagesTotal} pages` : meta.phaseLabel
                        : null
                      return (
                        <>
                          <span className="inline-flex items-center gap-1.5">
                            {it.inFlight && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 dark:bg-blue-400 animate-pulse" aria-hidden />}
                            {it.status}
                          </span>
                          {label && <span className="block text-[10px] text-navy/40 dark:text-white/40 mt-0.5 truncate max-w-[160px]">{label}</span>}
                          {pct != null && (
                            <span className="block w-24 h-1 mt-1 rounded-full bg-gray-100 dark:bg-navy-light overflow-hidden">
                              <span className="block h-1 rounded-full bg-blue-500 dark:bg-blue-400 transition-all duration-500" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
                            </span>
                          )}
                        </>
                      )
                    })()}
                  </td>
                  <td className="py-2.5 pr-4 text-navy/60 dark:text-white/60">{it.score ?? '—'}</td>
                  <td className="py-2.5 pr-4 text-navy/40 dark:text-white/40 whitespace-nowrap" title={formatDurationHover(it.startedAt, it.completedAt) ?? ''}>{formatDuration(it.startedAt, it.completedAt) ?? '—'}</td>
                  <td className="py-2.5 pr-4 text-navy/40 dark:text-white/40 whitespace-nowrap"><ClientDate iso={it.createdAt} variant="date" /></td>
                  {variant === 'full' && (
                    <td className="py-2.5 pr-0 text-right whitespace-nowrap">
                      {it.deletable && (confirmDeleteId === it.id ? (
                        <span className="inline-flex gap-1">
                          <button type="button" onClick={() => void doDelete(it.id)} disabled={deletingId === it.id}
                            className="px-2 py-0.5 rounded text-[11px] font-semibold bg-red-600 text-white disabled:opacity-50">
                            {deletingId === it.id ? '…' : 'Confirm'}
                          </button>
                          <button type="button" onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-0.5 rounded text-[11px] text-navy/60 dark:text-white/60 border border-gray-200 dark:border-navy-border">Cancel</button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => setConfirmDeleteId(it.id)} aria-label={`Delete ${it.label}`}
                          className="px-2 py-0.5 rounded text-[11px] text-red-600 dark:text-red-400 hover:underline">Delete</button>
                      ))}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {variant === 'full' && nextCursor && (
        <div className="mt-3 text-center">
          <button type="button" onClick={() => void loadMore()} disabled={loadingMore}
            className="px-4 py-1.5 rounded-lg border border-gray-200 dark:border-navy-border text-[12px] font-body text-navy/70 dark:text-white/70 disabled:opacity-50">
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </section>
  )
}
