'use client'

// "In this stage" overview strip (spec §5.5): a compact index of the current
// stage's primary sections, each a click-to-scroll into the flow. Client leaf,
// serializable props only; LIGHT-ONLY.
import type { SectionKey } from '@/lib/viewbook/theme'
import type { SectionStatus } from '@/lib/viewbook/section-status'
import { navigateToAnchor } from './viewbook-navigate'
import { StatusPill } from './SectionSummaryPanel'

export function StageOverview({
  items,
}: {
  items: { sectionKey: SectionKey; label: string; status: SectionStatus; anchor: string }[]
}) {
  if (items.length === 0) return null
  return (
    <nav aria-label="In this stage" className="mx-auto w-full max-w-5xl px-6 py-6">
      <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--vb-secondary)' }}>
          In this stage
        </p>
        <ol className="mt-3 grid gap-2 sm:grid-cols-2">
          {items.map((item, i) => (
            <li key={`${item.sectionKey}-${item.anchor}`}>
              <button
                type="button"
                onClick={() => navigateToAnchor(item.sectionKey, item.anchor)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-black/5"
              >
                <span
                  aria-hidden
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                  style={{ background: 'color-mix(in srgb, var(--vb-secondary) 14%, transparent)', color: 'var(--vb-secondary)' }}
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-black/80">{item.label}</span>
                <StatusPill status={item.status} />
              </button>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  )
}
