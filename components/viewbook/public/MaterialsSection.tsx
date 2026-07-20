// Materials & Links (spec §8): client-added share links + operator request
// placeholders. Read-only in PR2 — PR4's integration phase mounts
// MaterialLinkForm here (client add-a-link).
import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { materialAnchor } from '@/lib/viewbook/anchors'
import { SectionShell } from './SectionShell'
import { SECTION_TITLES } from './section-titles'
import { publicAssetUrl } from './ThemeStyle'
import { MaterialLinkForm } from './MaterialLinkForm'
import { SummaryStat } from './SummaryStat'

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  })
}

// Render-side scheme guard (security-review): the write side enforces
// https-only, but this public sink must not depend on a different lane's
// validation — a non-https URL renders as plain text, never an anchor.
export function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

export function MaterialsSection({
  section,
  data,
  token,
  isOperator = false,
}: {
  section: PublicSection
  data: ViewbookPublicData
  token: string
  isOperator?: boolean
}) {
  const hero = data.theme.sectionHeroes[section.sectionKey]
  const n = data.materials.length
  const requested = data.materials.filter((m) => m.status === 'requested').length
  return (
    <SectionShell
      section={section}
      stage={data.stage}
      title={SECTION_TITLES[section.sectionKey]}
      heroUrl={hero ? publicAssetUrl(token, hero) : null}
      summary={
        <SummaryStat
          headline={`${n} link${n === 1 ? '' : 's'}`}
          chip={requested > 0 ? `${requested} requested` : undefined}
        />
      }
      affordance={data.collapseAffordance}
      overlayStrength={data.heroOverlayStrength}
      isOperator={isOperator}
      viewbookId={data.viewbookId}
      token={token}
    >
      {data.materials.length === 0 ? (
        <p className="text-black/50">No materials yet — links you share with us will appear here.</p>
      ) : (
        <ul className="divide-y divide-black/10 rounded-xl border border-black/10 bg-white shadow-sm">
          {data.materials.map((m) => (
            <li key={m.id} id={materialAnchor(m.id).slice(1)} className="flex flex-wrap items-center gap-2 px-5 py-3">
              {m.status === 'provided' && m.url && isHttpsUrl(m.url) ? (
                <a
                  href={m.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium underline"
                  style={{ color: 'var(--vb-secondary)' }}
                >
                  {m.label}
                </a>
              ) : (
                <span className="font-medium text-black/70">{m.label}</span>
              )}
              {m.status === 'requested' && (
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-semibold"
                  style={{ background: 'var(--vb-tertiary)', color: 'var(--vb-on-tertiary)' }}
                >
                  requested — add a link
                </span>
              )}
              <span className="ml-auto text-xs text-black/40">
                {m.addedBy === 'client' ? 'added by you' : 'added by our team'}
                {m.providedAt ? ` · ${fmtDate(m.providedAt)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4">
        <MaterialLinkForm token={token} />
      </div>
    </SectionShell>
  )
}
