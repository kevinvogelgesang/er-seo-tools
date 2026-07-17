// Stage-aware "Earlier steps" band (v2 spec §4/§8). Carried sections (prior
// stages' primary lineup, still visible per-section state) render collapsed
// below the current stage's primary flow — full v1 functionality inside via
// the SAME renderSection the page uses for primary sections (ONE rendering
// owner, Codex plan fix 7). Renders nothing when there is nothing carried.
// Server component: no client JS, plain <details>/<summary>. PR7 restyles.
import type { ReactNode } from 'react'
import type { PublicSection } from '@/lib/viewbook/public-types'
import { SECTION_TITLES } from './section-titles'
import { DotStack } from './SectionAccents'

export function EarlierSteps({
  sections,
  renderSection,
}: {
  sections: PublicSection[]
  renderSection: (s: PublicSection) => ReactNode
}) {
  if (sections.length === 0) return null

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <details
        className="vb-earlier-steps overflow-hidden rounded-2xl border shadow-sm transition-shadow open:shadow-md"
        style={{ borderColor: 'color-mix(in srgb, var(--vb-primary) 16%, transparent)', background: '#fff' }}
      >
        {/* Hairline accent bar that only shows once the archive is open — a
            quiet echo of the brand-primary section header bands above,
            without competing with them while collapsed. */}
        <style>{`
          .vb-earlier-steps[open] > summary { border-bottom: 1px solid color-mix(in srgb, var(--vb-primary) 12%, transparent); }
          .vb-earlier-steps summary::-webkit-details-marker,
          .vb-earlier-step summary::-webkit-details-marker { display: none; }
          .vb-earlier-steps > summary .vb-chevron { transition: transform 160ms ease; }
          .vb-earlier-steps[open] > summary .vb-chevron { transform: rotate(90deg); }
          @media (prefers-reduced-motion: reduce) {
            .vb-earlier-steps > summary .vb-chevron { transition: none; }
          }
        `}</style>
        {/* Decorative-only stacked-dot column (Task 10) — a quiet visual
            marker for the collapsed archive, never load-bearing. Rendered
            INSIDE <summary> (not a sibling <div> wrapper): the UA stylesheet
            keys off the direct-child selector `details > summary:first-of-
            type` to make summary the visible toggle label, and hides every
            OTHER direct child (`details > *:not(summary) { display: none }`)
            until [open] — a wrapper div containing both would itself become
            that hidden non-summary child, taking the toggle label down with
            it. Nesting the SVG inside <summary> keeps it visible whenever
            the label is, in both collapsed and expanded states. */}
        <summary className="relative flex cursor-pointer list-none items-center gap-3 px-5 py-4 select-none hover:bg-black/[0.02]">
          <DotStack className="hidden shrink-0 sm:block" />
          <span
            className="text-sm font-bold uppercase tracking-wide text-black/60"
            style={{ fontFamily: 'var(--vb-heading-font)' }}
          >
            Earlier steps
          </span>
          <span className="text-xs font-normal normal-case text-black/35">
            {sections.length} {sections.length === 1 ? 'section' : 'sections'} archived
          </span>
          <span
            aria-hidden
            className="vb-chevron ml-auto text-xs text-black/40"
            style={{ color: 'var(--vb-tertiary)' }}
          >
            ▶
          </span>
        </summary>
        <div className="space-y-3 bg-black/[0.015] px-5 py-5">
          {sections.map((s) => (
            <details
              key={s.sectionKey}
              className="vb-earlier-step rounded-lg border border-black/10 bg-white transition-colors open:border-black/15"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-black/70 select-none hover:bg-black/[0.02]">
                <span className="flex min-w-0 items-center gap-2">
                  {s.state === 'done' && (
                    <span
                      aria-hidden
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                      style={{ background: 'var(--vb-secondary)', color: 'var(--vb-on-secondary)' }}
                    >
                      ✓
                    </span>
                  )}
                  <span className="truncate">{SECTION_TITLES[s.sectionKey]}</span>
                </span>
                <span aria-hidden className="shrink-0 text-xs text-black/30">
                  view
                </span>
              </summary>
              <div className="border-t border-black/5">{renderSection(s)}</div>
            </details>
          ))}
        </div>
      </details>
    </div>
  )
}
