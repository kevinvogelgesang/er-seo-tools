// components/clients/QuarterContextCard.tsx
// "This quarter" card on the client dashboard (B5) — week/priority/status/note
// from the latest QuarterPlan, plus derived tool activity. Server-renderable.
import type { QuarterContext } from '@/lib/services/client-quarter'
import { ACTIVITY_LABELS } from '@/lib/quarter-grid/state'
import { PCOLORS, STATUS_COLORS, STATUS_LABELS } from '@/components/quarter-grid/theme'

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function QuarterContextCard({ context }: { context: QuarterContext | null }) {
  return (
    <div className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-white/40">Quarter Plan</h3>
        <a href="/quarter-grid" className="text-[11px] text-[#f5a623] hover:text-[#e09415] font-semibold">View grid →</a>
      </div>

      {context === null ? (
        <p className="mt-4 text-sm text-gray-400 dark:text-white/40">Not in the current quarter plan</p>
      ) : (
        <>
          <div className="mt-2 flex items-baseline gap-2 flex-wrap">
            {context.week == null ? (
              <span className="text-lg font-display font-bold text-gray-500 dark:text-white/60">In pool — not scheduled</span>
            ) : (
              <span className="text-2xl font-display font-bold text-[#1c2d4a] dark:text-white">
                Week {context.week}
                {context.weekRange && <span className="text-sm font-normal text-gray-400 dark:text-white/40"> ({context.weekRange})</span>}
              </span>
            )}
            {context.completed && (
              <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400">
                ✓ Done{context.completedAt ? ` ${fmtDate(context.completedAt)}` : ''}
              </span>
            )}
          </div>

          <div className="mt-3 flex items-center gap-2 flex-wrap text-[11px]">
            <span
              className="px-2 py-0.5 rounded-full font-semibold"
              style={{
                background: PCOLORS[context.priority]?.chip,
                border: `1px solid ${PCOLORS[context.priority]?.border}`,
                color: PCOLORS[context.priority]?.text,
              }}
            >
              {PCOLORS[context.priority]?.label ?? `P${context.priority}`}
            </span>
            <span className="inline-flex items-center gap-1.5 text-gray-600 dark:text-white/60">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: STATUS_COLORS[context.status] }}
              />
              {STATUS_LABELS[context.status]}
            </span>
          </div>

          {context.note && (
            <p className="mt-2 text-[12px] text-gray-500 dark:text-white/50 italic">“{context.note}”</p>
          )}

          <p className="mt-2 text-[11px] text-gray-400 dark:text-white/40">
            {context.latestActivity
              ? `This cycle: ${ACTIVITY_LABELS[context.latestActivity.kind] ?? context.latestActivity.kind} · ${fmtDate(context.latestActivity.at)}`
              : 'No tool activity this cycle yet'}
          </p>
        </>
      )}
    </div>
  )
}
