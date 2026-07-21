// "Previous stages" (spec §5.5): carried sections grouped by origin stage,
// each an expandable compact row that opens to its full content rendered
// through the SAME renderSection (heroSize:'none'). Replaces EarlierSteps in
// the continuous viewer. SERVER component (takes a function prop); LIGHT-ONLY.
// (No compact/expandable split — the shelved 'collapsed' state is retired on
// main, so every carried section is an expandable row.)
import type { ReactNode } from 'react'
import type { PublicSection } from '@/lib/viewbook/public-types'
import { carriedStatus, type SectionRenderMeta } from '@/lib/viewbook/section-status'
import { SECTION_TITLES } from './section-titles'
import { StatusPill } from './SectionSummaryPanel'
import { DotStack } from './SectionAccents'

function ExpandableRow({
  section,
  renderSection,
}: {
  section: PublicSection
  renderSection: (s: PublicSection, meta: SectionRenderMeta) => ReactNode
}) {
  return (
    <details className="vb-prev-step rounded-lg border border-black/10 bg-white transition-colors open:border-black/15">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-black/70 select-none hover:bg-black/[0.02]">
        {section.state === 'done' && (
          <span
            aria-hidden
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
            style={{ background: 'var(--vb-secondary)', color: 'var(--vb-on-secondary)' }}
          >
            ✓
          </span>
        )}
        <span className="min-w-0 truncate">{SECTION_TITLES[section.sectionKey]}</span>
        <StatusPill status={carriedStatus(section)} />
        <span aria-hidden className="vb-chevron ml-auto text-xs" style={{ color: 'var(--vb-tertiary)' }}>
          ▶
        </span>
      </summary>
      <div className="border-t border-black/5">
        {renderSection(section, { heroSize: 'none', chapterNumber: null, status: carriedStatus(section), isLead: false })}
      </div>
    </details>
  )
}

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
        @media (prefers-reduced-motion: reduce) { .vb-prev-step > summary .vb-chevron { transition: none; } }
      `}</style>
      <div className="flex items-center gap-3">
        <DotStack className="hidden shrink-0 sm:block" />
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide text-black/60" style={{ fontFamily: 'var(--vb-heading-font)' }}>
            Previous stages
          </h2>
          <p className="text-xs text-black/40">Everything we&apos;ve already worked through together.</p>
        </div>
      </div>
      <div className="mt-4 space-y-5">
        {groups.map((group) => (
          <div key={group.stageLabel}>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--vb-tertiary)' }}>
              {group.stageLabel}
            </h3>
            <div className="space-y-2">
              {group.sections.map((s) => (
                <ExpandableRow key={s.sectionKey} section={s} renderSection={renderSection} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
