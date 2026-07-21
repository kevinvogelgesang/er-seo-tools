// Welcome & Team (spec §8): per-client welcome note, global "why" story,
// team roster with photos, process explainer. Read-only; degrades to
// friendly placeholders when global content is absent.
import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { SectionShell } from './SectionShell'
import { SECTION_TITLES } from './section-titles'
import { publicAssetUrl } from './ThemeStyle'
import { SummaryStat, sectionStatusLabel } from './SummaryStat'
import type { SectionRenderMeta } from '@/lib/viewbook/section-status'

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

export function WelcomeSection({
  section,
  data,
  token,
  isOperator = false,
  meta,
}: {
  section: PublicSection
  data: ViewbookPublicData
  token: string
  isOperator?: boolean
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
      title={SECTION_TITLES[section.sectionKey]}
      heroUrl={hero ? publicAssetUrl(token, hero) : null}
      summary={
        <SummaryStat
          headline={data.welcomeNote?.trim() ? data.welcomeNote : sectionStatusLabel(section)}
        />
      }
      affordance={data.collapseAffordance}
      overlayStrength={data.heroOverlayStrength}
      isOperator={isOperator}
      viewbookId={data.viewbookId}
      token={token}
      meta={meta}
      viewerMode={data.viewerMode}
    >
      {blocks.why?.blocks?.length ? <Blocks blocks={blocks.why.blocks} /> : <Placeholder what="Our story" />}

      {csm && (
        <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-md">
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
        </div>
      )}

      <h3 className="text-xl font-bold" style={{ fontFamily: 'var(--vb-heading-font)' }}>
        Your team
      </h3>
      {ordinaryTeam.length ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
        <Placeholder what="Meet-the-team" />
      )}

      {blocks.process?.blocks?.length ? <Blocks blocks={blocks.process.blocks} /> : null}
    </SectionShell>
  )
}
