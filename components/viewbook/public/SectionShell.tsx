// One shared section frame (spec §8): FULL-VIEWPORT spread — bold header band
// in the brand primary (heading font, derived on-primary text, optional hero
// image), anchor id for the ProgressNav, operator intro note, and an optional
// CEO-skimmable SUMMARY band (one line + big number/status) above the detail
// (Codex plan-fix 5 — the summary prop is the stable API sections and PR5
// build on). 'done' collapses to a celebratory slim <details> header — data
// always retained. PR5 owns the polish pass (animation, richer hero
// rendering) — keep this props surface stable.
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
  if (section.state === 'done') {
    return (
      <section id={section.sectionKey} className="mx-auto w-full max-w-5xl px-6 py-4">
        <details className="rounded-xl border border-black/10 bg-white shadow-sm">
          <summary className="flex cursor-pointer items-center gap-3 px-5 py-4">
            <span
              aria-hidden
              className="flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold"
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
          <div className="space-y-6 px-5 pb-6">{children}</div>
        </details>
      </section>
    )
  }

  return (
    <section id={section.sectionKey} className="flex min-h-screen w-full flex-col">
      <div
        className="relative flex min-h-[30vh] items-end overflow-hidden"
        style={{ background: 'var(--vb-primary)' }}
      >
        {heroUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={heroUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30" />
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
