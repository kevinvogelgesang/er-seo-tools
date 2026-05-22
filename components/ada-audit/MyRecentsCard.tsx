import Link from 'next/link'
import type { RecentItem } from '@/lib/ada-audit/recents-query'
import { formatDuration } from '@/lib/ada-audit/duration'

interface Props {
  items: RecentItem[]
  operator: string | null
}

export default function MyRecentsCard({ items, operator }: Props) {
  return (
    <section className="rounded-2xl border border-gray-200 dark:border-navy-border bg-white dark:bg-navy-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display font-bold text-[14px] text-navy dark:text-white">
          My recents
        </h2>
        <Link href="/ada-audit/recents" className="text-[12px] font-body text-orange hover:underline">
          View all →
        </Link>
      </div>
      {!operator ? (
        <p className="text-[12px] font-body text-navy/50 dark:text-white/50">Set your name above to see your recents.</p>
      ) : items.length === 0 ? (
        <p className="text-[12px] font-body text-navy/50 dark:text-white/50">No recents yet.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => {
            const href = it.type === 'page' ? `/ada-audit/${it.id}` : `/ada-audit/site/${it.id}`
            const label = it.type === 'page' ? it.url : it.domain
            return (
              <li key={`${it.type}-${it.id}`} className="flex items-center gap-2 text-[12px] font-body">
                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase shrink-0 ${it.type === 'page' ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' : 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300'}`}>
                  {it.type === 'page' ? 'Page' : 'Site'}
                </span>
                <Link href={href} className="text-navy dark:text-white hover:text-orange truncate flex-1">{label}</Link>
                <span className="text-navy/40 dark:text-white/40 shrink-0">{formatDuration(it.startedAt, it.completedAt) ?? '—'}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
