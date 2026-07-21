'use client'
// Lane D — "In this stage" overview. A compact, glanceable map of the current
// stage's primary sections, rendered between the lead hero and the remaining
// chapters (ViewbookShell). Each entry is a click-through that force-opens and
// scrolls to the section via the shared navigateToAnchor primitive. Client
// leaf: serializable props only (spec §5, Codex fix #3). LIGHT-ONLY — color via
// --vb-* tokens; no `dark:` classes.
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
    <nav
      aria-label="In this stage"
      className="mx-auto w-full max-w-5xl px-6 py-6"
    >
      <div
        className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm"
      >
        <p
          className="mb-3 text-xs font-semibold uppercase tracking-wide"
          style={{ color: 'var(--vb-secondary)' }}
        >
          In this stage
        </p>
        <ol className="grid gap-2 sm:grid-cols-2">
          {items.map((item, i) => (
            <li key={`${item.sectionKey}-${item.anchor}`}>
              <button
                type="button"
                onClick={() => navigateToAnchor(item.sectionKey, item.anchor)}
                className="flex w-full items-center gap-3 rounded-xl border border-black/10 bg-white px-3 py-2.5 text-left transition-colors hover:bg-black/[0.02]"
              >
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                  style={{
                    background: 'color-mix(in srgb, var(--vb-secondary) 14%, transparent)',
                    color: 'var(--vb-secondary)',
                  }}
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-black/75">
                  {item.label}
                </span>
                <StatusPill status={item.status} />
              </button>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  )
}
