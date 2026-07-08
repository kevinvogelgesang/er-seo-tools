// components/widgets/LiveNowWidget.tsx
'use client'
import Link from 'next/link'
import { useQueueStatus } from '@/lib/widgets/queue-poll'
import { computeActivePhaseSummary } from '@/lib/ada-audit/queue-ui-helpers'
import { StatusPill } from '@/components/ui/StatusPill'
import { IntentChip } from '@/components/ada-audit/IntentChip'
import type { WidgetSize } from '@/lib/widgets/types'

export function LiveNowWidget({ size }: { size: WidgetSize }) {
  const { data, error } = useQueueStatus()

  if (error && !data) {
    return <p className="text-[13px] font-body text-gray-400 dark:text-white/40">Live queue unavailable.</p>
  }
  if (!data) {
    return <p className="text-[13px] font-body text-gray-400 dark:text-white/40">Loading…</p>
  }

  const { active, queued } = data
  const detailed = size !== 'sm'

  if (!active && queued.length === 0) {
    return (
      <div className="flex h-full flex-col items-start justify-center gap-2">
        <p className="text-[14px] font-body text-gray-500 dark:text-white/60">No scans running.</p>
        <Link href="/ada-audit" className="text-[13px] font-body font-semibold text-orange hover:underline">
          Start a site audit →
        </Link>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {active && (() => {
        const p = computeActivePhaseSummary(active)
        // C11: a seoOnly audit has no ADA results — route to /seo-audits
        // (the ADA site page redirects it away) and flag it as an SEO scan.
        const href = active.seoOnly ? '/seo-audits' : `/ada-audit/site/${active.id}`
        return (
          <Link href={href} className="block rounded-lg border border-gray-100 p-2 hover:border-orange/50 dark:border-navy-border">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="truncate font-display text-[14px] font-bold text-navy dark:text-white inline-flex items-center gap-1">
                <IntentChip seoOnly={active.seoOnly} />
                {active.domain}
              </span>
              <StatusPill label={active.status} tone="running" />
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
              <div className="h-full rounded-full bg-orange transition-all" style={{ width: `${p.pct}%` }} />
            </div>
            <p className="mt-1 text-[11px] font-body text-gray-400 dark:text-white/40">
              {p.label}: {p.complete}/{p.total} {p.unit}
            </p>
          </Link>
        )
      })()}

      <p className="text-[12px] font-body text-gray-500 dark:text-white/50">{queued.length} queued</p>

      {detailed && queued.length > 0 && (
        <ul className="space-y-1 overflow-auto">
          {queued.slice(0, 6).map((q) => (
            <li key={q.id} className="flex items-center justify-between gap-2 text-[12px] font-body">
              <span className="truncate text-gray-600 dark:text-white/60 inline-flex items-center gap-1">
                <IntentChip seoOnly={q.seoOnly} />
                {q.domain}
              </span>
              <span className="shrink-0 text-gray-400 dark:text-white/30">#{q.position}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
