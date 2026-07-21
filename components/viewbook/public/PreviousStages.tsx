// Lane D — "Previous stages": carried sections (prior stages' primary lineup,
// still visible per-section state) grouped by their ORIGIN stage and rendered
// below the current stage's flow. Replaces EarlierSteps. ONE rendering owner:
// non-collapsed carried sections expand to the SAME renderSection the page uses
// for primary sections; a section the operator COLLAPSED renders as a compact,
// non-expandable row (no toggle, no body) so it reads as "handled, prior stage"
// without inviting a click into an intentionally-minimized section (spec §5
// item 7 / §7 fix #8). Server component (takes a function prop) — no client JS,
// plain <details>/<summary>. LIGHT-ONLY.
import type { ReactNode } from 'react'
import type { PublicSection } from '@/lib/viewbook/public-types'
import { carriedStatus, type SectionRenderMeta } from '@/lib/viewbook/section-status'
import { SECTION_TITLES } from './section-titles'
import { StatusPill } from './SectionSummaryPanel'
import { DotStack } from './SectionAccents'

export function PreviousStages({
  groups,
  renderSection,
}: {
  groups: { stageLabel: string; sections: PublicSection[] }[]
  renderSection: (s: PublicSection, meta: SectionRenderMeta) => ReactNode
}) {
  if (groups.length === 0) return null

  return (
    <section aria-label="Previous stages" className="mx-auto w-full max-w-5xl px-6 py-8">
      <style>{`
        .vb-prev-step summary::-webkit-details-marker { display: none; }
        .vb-prev-step > summary .vb-chevron { transition: transform 160ms ease; }
        .vb-prev-step[open] > summary .vb-chevron { transform: rotate(90deg); }
        @media (prefers-reduced-motion: reduce) {
          .vb-prev-step > summary .vb-chevron { transition: none; }
        }
      `}</style>

      <div className="mb-4 flex items-center gap-3">
        <DotStack className="hidden shrink-0 sm:block" />
        <div>
          <h2
            className="text-sm font-bold uppercase tracking-wide text-black/60"
            style={{ fontFamily: 'var(--vb-heading-font)' }}
          >
            Previous stages
          </h2>
          <p className="text-xs text-black/40">Everything we&rsquo;ve already worked through together.</p>
        </div>
      </div>

      <div className="space-y-6">
        {groups.map((group) => (
          <div key={group.stageLabel}>
            <h3
              className="mb-2 text-xs font-semibold uppercase tracking-wide"
              style={{ color: 'var(--vb-tertiary)' }}
            >
              {group.stageLabel}
            </h3>
            <div className="space-y-2">
              {group.sections.map((s) =>
                s.state === 'collapsed' ? (
                  <CompactRow key={s.sectionKey} section={s} />
                ) : (
                  <ExpandableRow key={s.sectionKey} section={s} renderSection={renderSection} />
                ),
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

// A carried section the operator collapsed: named, statused, NOT expandable.
function CompactRow({ section }: { section: PublicSection }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-black/10 bg-black/[0.015] px-4 py-3">
      <span className="min-w-0 truncate text-sm font-semibold text-black/55">
        {SECTION_TITLES[section.sectionKey]}
      </span>
      <StatusPill status={carriedStatus(section)} />
    </div>
  )
}

// A carried section still worth reading: expands to the full section body.
function ExpandableRow({
  section,
  renderSection,
}: {
  section: PublicSection
  renderSection: (s: PublicSection, meta: SectionRenderMeta) => ReactNode
}) {
  return (
    <details className="vb-prev-step rounded-lg border border-black/10 bg-white transition-colors open:border-black/15">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 select-none hover:bg-black/[0.02]">
        <span className="flex min-w-0 items-center gap-2">
          {section.state === 'done' && (
            <span
              aria-hidden="true"
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
              style={{ background: 'var(--vb-secondary)', color: 'var(--vb-on-secondary)' }}
            >
              ✓
            </span>
          )}
          <span className="truncate text-sm font-semibold text-black/70">
            {SECTION_TITLES[section.sectionKey]}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <StatusPill status={carriedStatus(section)} />
          <span aria-hidden="true" className="vb-chevron text-xs" style={{ color: 'var(--vb-tertiary)' }}>
            ▶
          </span>
        </span>
      </summary>
      <div className="border-t border-black/5">
        {renderSection(section, {
          heroSize: 'none',
          chapterNumber: null,
          status: carriedStatus(section),
          isLead: false,
        })}
      </div>
    </details>
  )
}
