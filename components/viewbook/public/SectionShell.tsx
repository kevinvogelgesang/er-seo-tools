// One shared section frame (spec §8): FULL-VIEWPORT spread — bold header band
// in the brand primary (heading font, derived on-primary text, optional hero
// image), anchor id for the ProgressNav, operator intro note, and an optional
// CEO-skimmable SUMMARY band (one line + big number/status) above the detail
// (Codex plan-fix 5 — the summary prop is the stable API sections and PR5
// build on). 'done' collapses to a celebratory slim <details> header — data
// always retained. PR5 landed the polish pass (done-state pop/fade keyed to
// details[open] with a prefers-reduced-motion override, hero legibility
// gradient, sticky-nav scroll offset) — props surface unchanged.
import type { ReactNode } from 'react'
import type { PublicSection } from '@/lib/viewbook/public-types'

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  })
}

export function SectionShell({
  section,
  title,
  heroUrl,
  summary,
  children,
}: {
  section: PublicSection
  title: string
  heroUrl: string | null
  summary?: ReactNode
  children: ReactNode
}) {
  // PR5 Task 7 (Codex fix 10, spec §4 "collapses the section for everyone"):
  // an acknowledged ackable section (pc-setup/pc-invite/data-source) collapses
  // exactly like a 'done' section — same slim <details> face, body retained.
  // Reset-ack (operator) clears acknowledgedAt and re-expands.
  if (section.state === 'done' || section.acknowledgedAt != null) {
    return (
      <section id={section.sectionKey} className="mx-auto w-full max-w-5xl scroll-mt-14 px-6 py-4">
        <style>{`
          @keyframes vb-pop { 0% { transform: scale(0); } 70% { transform: scale(1.18); } 100% { transform: scale(1); } }
          @keyframes vb-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
          .vb-done-badge { animation: vb-pop 400ms ease-out both; }
          details[open] .vb-done-body { animation: vb-fade 250ms ease-out both; }
          @media (prefers-reduced-motion: reduce) {
            .vb-done-badge, details[open] .vb-done-body { animation: none; }
          }
        `}</style>
        <details className="rounded-xl border border-black/10 bg-white shadow-sm">
          <summary className="flex cursor-pointer items-center gap-3 px-5 py-4">
            <span
              aria-hidden
              className="vb-done-badge flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold"
              style={{ background: 'var(--vb-secondary)', color: 'var(--vb-on-secondary)' }}
            >
              ✓
            </span>
            <span className="text-lg font-bold" style={{ fontFamily: 'var(--vb-heading-font)' }}>
              {title}
            </span>
            {section.doneAt && (
              <span className="ml-auto text-sm text-black/50">Completed {fmtDate(section.doneAt)}</span>
            )}
          </summary>
          <div className="vb-done-body space-y-6 px-5 pb-6">{children}</div>
        </details>
      </section>
    )
  }

  return (
    <section id={section.sectionKey} className="flex min-h-screen w-full scroll-mt-14 flex-col">
      <div
        className={`relative flex ${heroUrl ? 'min-h-[38vh]' : 'min-h-[30vh]'} items-end overflow-hidden`}
        style={{ background: 'var(--vb-primary)' }}
      >
        {heroUrl && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={heroUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />
            {/* brand-primary bottom fade keeps the on-primary headline on
                effectively-primary pixels — preserves the theme's luminance
                contract over any photo */}
            <div
              aria-hidden
              className="absolute inset-0"
              style={{ background: 'linear-gradient(to top, var(--vb-primary) 15%, transparent 70%)' }}
            />
          </>
        )}
        <h2
          className="relative mx-auto w-full max-w-5xl px-6 pb-6 text-3xl font-extrabold tracking-tight sm:text-5xl"
          style={{ color: 'var(--vb-on-primary)', fontFamily: 'var(--vb-heading-font)' }}
        >
          {title}
        </h2>
      </div>
      {summary && (
        <div
          className="border-b border-black/10"
          style={{ background: 'color-mix(in srgb, var(--vb-secondary) 10%, white)' }}
        >
          <div className="mx-auto w-full max-w-5xl px-6 py-5 text-lg">{summary}</div>
        </div>
      )}
      <div className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-6 py-10">
        {section.introNote && (
          <p className="border-l-4 pl-4 text-lg text-black/70" style={{ borderColor: 'var(--vb-tertiary)' }}>
            {section.introNote}
          </p>
        )}
        {children}
      </div>
    </section>
  )
}
