// Slim sticky progress nav (spec §8): client logo + one anchor dot per
// visible section. Pure anchors — no client JS.
import type { PublicSection } from '@/lib/viewbook/public-types'
import { SECTION_TITLES } from './section-titles'

export function ProgressNav({
  clientName,
  logoUrl,
  sections,
}: {
  clientName: string
  logoUrl: string | null
  sections: PublicSection[]
}) {
  return (
    <nav
      aria-label="Sections"
      className="sticky top-0 z-40 border-b border-black/10 backdrop-blur"
      style={{ background: 'color-mix(in srgb, var(--vb-primary) 92%, transparent)' }}
    >
      <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-2">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={clientName} className="h-8 w-auto" />
        ) : (
          <span
            className="text-sm font-bold"
            style={{ color: 'var(--vb-on-primary)', fontFamily: 'var(--vb-heading-font)' }}
          >
            {clientName}
          </span>
        )}
        <ul className="ml-auto flex items-center gap-3">
          {sections.map((s) => (
            <li key={s.sectionKey}>
              <a
                href={`#${s.sectionKey}`}
                title={SECTION_TITLES[s.sectionKey]}
                className="block h-2.5 w-2.5 rounded-full transition-transform hover:scale-125"
                style={{
                  background: s.state === 'done' ? 'var(--vb-tertiary)' : 'var(--vb-on-primary)',
                  opacity: s.state === 'done' ? 1 : 0.7,
                }}
              >
                <span className="sr-only">{SECTION_TITLES[s.sectionKey]}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  )
}
