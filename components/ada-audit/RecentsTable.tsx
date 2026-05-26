'use client'
import { useCallback, useRef, useState } from 'react'
import Link from 'next/link'
import type { RecentItem } from '@/lib/ada-audit/recents-query'
import { ClientDate } from '@/components/ClientDate'
import { formatDuration, formatDurationHover } from '@/lib/ada-audit/duration'

type Scope = 'all' | 'mine'
interface Props {
  initialItems: RecentItem[]
  initialScope: Scope
  operator: string | null
  variant: 'home' | 'full'
}

const HOME_LIMIT = 10

export default function RecentsTable({ initialItems, initialScope, operator, variant }: Props) {
  const [items, setItems] = useState(initialItems)
  const [scope, setScope] = useState<Scope>(initialScope)
  const [loading, setLoading] = useState(false)
  const seqRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const changeScope = useCallback(async (next: Scope) => {
    if (next === scope) return
    setScope(next)
    setLoading(true)
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    const seq = ++seqRef.current
    const limit = variant === 'home' ? HOME_LIMIT : 100
    try {
      const res = await fetch(`/api/ada-audit/recents?scope=${next}&limit=${limit}`, { signal: ac.signal })
      const json = await res.json() as { items: RecentItem[] }
      if (seq === seqRef.current) setItems(json.items)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') console.warn('[RecentsTable] fetch failed:', e)
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }, [scope, variant])

  const rows = variant === 'home' ? items.slice(0, HOME_LIMIT) : items
  const mineDisabled = !operator

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
            </tr>
          </thead>
          <tbody>
            {rows.map((it) => {
              const href = it.type === 'page' ? `/ada-audit/${it.id}` : `/ada-audit/site/${it.id}`
              const label = it.type === 'page' ? it.url : it.domain
              return (
                <tr key={`${it.type}-${it.id}`} className="border-b border-gray-100 dark:border-navy-border">
                  <td className="py-2.5 pr-4">
                    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${it.type === 'page' ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' : 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300'}`}>{it.type}</span>
                  </td>
                  <td className="py-2.5 pr-4 max-w-[280px] truncate"><Link href={href} className="text-orange hover:underline">{label}</Link></td>
                  <td className="py-2.5 pr-4 text-navy/60 dark:text-white/60">{it.clientName ?? '—'}</td>
                  <td className="py-2.5 pr-4 text-navy/60 dark:text-white/60">{it.requestedBy ?? '—'}</td>
                  <td className="py-2.5 pr-4 text-navy/60 dark:text-white/60">{it.status}</td>
                  <td className="py-2.5 pr-4 text-navy/60 dark:text-white/60">{it.score ?? '—'}</td>
                  <td className="py-2.5 pr-4 text-navy/40 dark:text-white/40 whitespace-nowrap" title={formatDurationHover(it.startedAt, it.completedAt) ?? ''}>{formatDuration(it.startedAt, it.completedAt) ?? '—'}</td>
                  <td className="py-2.5 pr-4 text-navy/40 dark:text-white/40 whitespace-nowrap"><ClientDate iso={it.createdAt} variant="date" /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}
