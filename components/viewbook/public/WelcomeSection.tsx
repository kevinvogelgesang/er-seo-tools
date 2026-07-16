// Welcome & Team (spec §8): per-client welcome note, global "why" story,
// team roster with photos, process explainer. Read-only; degrades to
// friendly placeholders when global content is absent.
import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { SectionShell } from './SectionShell'
import { SECTION_TITLES } from './section-titles'
import { publicAssetUrl } from './ThemeStyle'

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
}: {
  section: PublicSection
  data: ViewbookPublicData
  token: string
}) {
  const hero = data.theme.sectionHeroes[section.sectionKey]
  const { team, blocks } = data.global
  return (
    <SectionShell
      section={section}
      title={SECTION_TITLES[section.sectionKey]}
      heroUrl={hero ? publicAssetUrl(token, hero) : null}
      summary={data.welcomeNote ? <p className="text-xl">{data.welcomeNote}</p> : undefined}
    >
      {blocks.why?.blocks?.length ? <Blocks blocks={blocks.why.blocks} /> : <Placeholder what="Our story" />}

      <h3 className="text-xl font-bold" style={{ fontFamily: 'var(--vb-heading-font)' }}>
        Your team
      </h3>
      {team?.length ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {team.map((m) => (
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
