// Welcome & Team (spec §8): per-client welcome note, global "why" story,
// team roster with photos, process explainer. Read-only; degrades to
// friendly placeholders when global content is absent.
import type { ReactNode } from 'react'
import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import type { SectionRenderMeta } from '@/lib/viewbook/section-status'
import { SectionShell } from './SectionShell'
import { SECTION_TITLES } from './section-titles'
import { publicAssetUrl } from './ThemeStyle'
import { SummaryStat, sectionStatusLabel } from './SummaryStat'

const ER_CREDENTIALS =
  'Enrollment Resources brings enrollment strategy, conversion-focused web design, and measurable digital marketing together for schools that want sustainable growth.'

function Placeholder({ what }: { what: string }) {
  return <p className="text-black/50">{what} is coming soon.</p>
}

function Blocks({ blocks }: { blocks: { heading: string; body: string }[] }) {
  return (
    <>
      {blocks.map((b, i) => (
        <div key={i}>
          {b.heading && (
            <h3 className="text-xl font-bold" style={{ fontFamily: 'var(--vb-heading-font)' }}>
              {b.heading}
            </h3>
          )}
          <p className="mt-1 whitespace-pre-line text-black/80">{b.body}</p>
        </div>
      ))}
    </>
  )
}

function EditorialCard({
  card,
  label,
  children,
}: {
  card: 'philosophy' | 'credentials' | 'contact' | 'team' | 'process'
  label: string
  children: ReactNode
}) {
  const headingId = `vb-welcome-${card}`
  return (
    <section
      data-vb-welcome-card={card}
      aria-labelledby={headingId}
      className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm"
    >
      <h3
        id={headingId}
        className="mb-4 text-xs font-semibold uppercase tracking-[0.16em]"
        style={{ color: 'var(--vb-secondary)' }}
      >
        {label}
      </h3>
      {children}
    </section>
  )
}

export function WelcomeSection({
  section,
  data,
  token,
  meta,
}: {
  section: PublicSection
  data: ViewbookPublicData
  token: string
  meta: SectionRenderMeta
}) {
  const hero = data.theme.sectionHeroes[section.sectionKey]
  const { team, blocks } = data.global
  const csm = team?.find((member) => member.isCsm === true && member.name === data.csmName) ?? null
  const ordinaryTeam = team?.filter((member) => member.isCsm !== true) ?? []
  return (
    <SectionShell
      section={section}
      stage={data.stage}
      meta={meta}
      title={SECTION_TITLES[section.sectionKey]}
      heroUrl={hero ? publicAssetUrl(token, hero) : null}
      summary={
        <SummaryStat
          eyebrow={SECTION_TITLES[section.sectionKey]}
          headline={data.welcomeNote?.trim() ? data.welcomeNote : sectionStatusLabel(section)}
        />
      }
    >
      <EditorialCard card="philosophy" label="Philosophy">
        {blocks.why?.blocks?.length ? (
          <Blocks blocks={blocks.why.blocks} />
        ) : (
          <Placeholder what="Our philosophy" />
        )}
      </EditorialCard>

      <EditorialCard card="credentials" label="Credentials">
        <p className="text-black/80">{ER_CREDENTIALS}</p>
      </EditorialCard>

      <EditorialCard card="contact" label="Contact">
        {csm ? (
          <>
            <h3 className="text-xl font-bold" style={{ fontFamily: 'var(--vb-heading-font)' }}>
              Your ER contact
            </h3>
            <div className="mt-4 flex flex-wrap items-center gap-4">
              {csm.photo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={publicAssetUrl(token, csm.photo)}
                  alt={csm.name}
                  className="h-24 w-24 rounded-full object-cover"
                />
              )}
              <div>
                <p className="text-lg font-bold">{csm.name}</p>
                <p className="text-sm" style={{ color: 'var(--vb-secondary)' }}>{csm.role}</p>
                {csm.email && (
                  <a className="mt-2 inline-block text-sm underline" href={`mailto:${csm.email}`}>
                    {csm.email}
                  </a>
                )}
              </div>
            </div>
          </>
        ) : (
          <Placeholder what="Your ER contact" />
        )}
      </EditorialCard>

      <EditorialCard card="team" label="Team">
        <h3 className="text-xl font-bold" style={{ fontFamily: 'var(--vb-heading-font)' }}>
          Your team
        </h3>
        {ordinaryTeam.length ? (
          <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {ordinaryTeam.map((m) => (
              <div key={m.name} className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
                {m.photo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={publicAssetUrl(token, m.photo)}
                    alt={m.name}
                    className="mb-3 h-20 w-20 rounded-full object-cover"
                  />
                )}
                <p className="font-bold">{m.name}</p>
                <p className="text-sm" style={{ color: 'var(--vb-secondary)' }}>
                  {m.role}
                </p>
                {m.blurb && <p className="mt-2 text-sm text-black/70">{m.blurb}</p>}
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4"><Placeholder what="Meet-the-team" /></div>
        )}
      </EditorialCard>

      <EditorialCard card="process" label="Process">
        {blocks.process?.blocks?.length ? (
          <Blocks blocks={blocks.process.blocks} />
        ) : (
          <Placeholder what="Our process" />
        )}
      </EditorialCard>
    </SectionShell>
  )
}
