// Stage-aware "Earlier steps" band (v2 spec §4/§8). Carried sections (prior
// stages' primary lineup, still visible per-section state) render collapsed
// below the current stage's primary flow — full v1 functionality inside via
// the SAME renderSection the page uses for primary sections (ONE rendering
// owner, Codex plan fix 7). Renders nothing when there is nothing carried.
// Server component: no client JS, plain <details>/<summary>. PR7 restyles.
import type { ReactNode } from 'react'
import type { PublicSection } from '@/lib/viewbook/public-types'
import { SECTION_TITLES } from './section-titles'

export function EarlierSteps({
  sections,
  renderSection,
}: {
  sections: PublicSection[]
  renderSection: (s: PublicSection) => ReactNode
}) {
  if (sections.length === 0) return null

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-6">
      <details className="rounded-xl border border-black/10 bg-white/60">
        <summary className="cursor-pointer px-5 py-4 text-sm font-bold text-black/60">
          Earlier steps
        </summary>
        <div className="space-y-4 px-5 pb-5">
          {sections.map((s) => (
            <details key={s.sectionKey} className="rounded-lg border border-black/10 bg-white">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-black/70">
                {SECTION_TITLES[s.sectionKey]}
              </summary>
              <div>{renderSection(s)}</div>
            </details>
          ))}
        </div>
      </details>
    </div>
  )
}
