// components/clients/ActivityTimeline.tsx
//
// Reverse-chron activity list for one client. Server-renderable; RelativeTime
// is the only client leaf. Local item interface (repo convention).

import { RelativeTime } from '@/app/pillar-analysis/[id]/components/RelativeTime'

export interface ActivityTimelineItem {
  type: 'seo-parse' | 'keyword-research' | 'site-audit' | 'ada-audit' | 'pillar-analysis' | 'seo-roadmap'
  id: string
  title: string
  status: string
  date: string
  href: string
  stat: string | null
}

const TYPE_LABELS: Record<ActivityTimelineItem['type'], string> = {
  'seo-parse': 'SEO Parse',
  'keyword-research': 'Keywords',
  'site-audit': 'Site Audit',
  'ada-audit': 'ADA Page',
  'pillar-analysis': 'Pillar',
  'seo-roadmap': 'Roadmap',
}

const TYPE_CLASSES: Record<ActivityTimelineItem['type'], string> = {
  'seo-parse': 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  'keyword-research': 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300',
  'site-audit': 'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300',
  'ada-audit': 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300',
  'pillar-analysis': 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300',
  'seo-roadmap': 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
}

function statusClasses(status: string): string {
  if (status === 'complete') return 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300'
  if (status === 'error') return 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300'
  if (status === 'cancelled') return 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/60'
  return 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' // in-flight
}

export function ActivityTimeline({ items }: { items: ActivityTimelineItem[] }) {
  if (items.length === 0) {
    return (
      <div className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border p-10 text-center">
        <p className="text-sm text-gray-500 dark:text-white/60">No activity yet for this client.</p>
      </div>
    )
  }
  return (
    <div className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border overflow-hidden">
      <ul className="divide-y divide-gray-50 dark:divide-navy-border/50">
        {items.map((it) => (
          <li key={`${it.type}-${it.id}`} className="px-5 py-3 flex flex-wrap items-center gap-x-3 gap-y-1 hover:bg-gray-50 dark:hover:bg-navy-light/40 transition-colors">
            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase whitespace-nowrap ${TYPE_CLASSES[it.type]}`}>
              {TYPE_LABELS[it.type]}
            </span>
            <a href={it.href} className="font-semibold text-sm text-[#1c2d4a] dark:text-white hover:text-[#f5a623] dark:hover:text-[#f5a623] transition-colors truncate max-w-[280px]">
              {it.title}
            </a>
            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${statusClasses(it.status)}`}>{it.status}</span>
            {it.stat && <span className="text-xs text-gray-500 dark:text-white/60 tabular-nums">{it.stat}</span>}
            <span className="ml-auto text-xs text-gray-400 dark:text-white/40 whitespace-nowrap">
              <RelativeTime value={it.date} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
