// Process & Milestones (spec §8): horizontal timeline with the current stage
// spotlighted, review-link cards per stage. PR4 mounted FeedbackThread under
// each review-link card.
import type { PublicMilestone, PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { milestoneProgress } from '@/lib/viewbook/summary-metrics'
import { milestoneAnchor } from '@/lib/viewbook/anchors'
import { SectionShell } from './SectionShell'
import { SECTION_TITLES } from './section-titles'
import { publicAssetUrl } from './ThemeStyle'
import { isHttpsUrl } from './MaterialsSection'
import { FeedbackThread } from './FeedbackThread'
import { SummaryStat } from './SummaryStat'

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  })
}

function StageDot({ status }: { status: string }) {
  if (status === 'done') {
    return (
      <span
        aria-hidden
        className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold"
        style={{ background: 'var(--vb-tertiary)', color: 'var(--vb-on-tertiary)' }}
      >
        ✓
      </span>
    )
  }
  if (status === 'current') {
    return (
      <span
        aria-hidden
        className="h-6 w-6 rounded-full ring-4 ring-offset-2"
        style={{ background: 'var(--vb-secondary)', ['--tw-ring-color' as string]: 'var(--vb-secondary)', opacity: 0.95 }}
      />
    )
  }
  return <span aria-hidden className="h-6 w-6 rounded-full border-2 border-black/20 bg-white" />
}

function StageCard({ m }: { m: PublicMilestone }) {
  return (
    <div
      id={milestoneAnchor(m.id).slice(1)}
      className={`min-w-56 flex-1 rounded-xl border bg-white p-4 shadow-sm ${
        m.status === 'current' ? 'border-2' : 'border-black/10'
      }`}
      style={m.status === 'current' ? { borderColor: 'var(--vb-secondary)' } : undefined}
    >
      <div className="flex items-center gap-2">
        <StageDot status={m.status} />
        <p className="font-bold" style={{ fontFamily: 'var(--vb-heading-font)' }}>
          {m.title}
        </p>
      </div>
      {m.status === 'current' && (
        <span
          className="mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-semibold"
          style={{ background: 'var(--vb-secondary)', color: 'var(--vb-on-secondary)' }}
        >
          Current stage
        </span>
      )}
      {m.blurb && <p className="mt-2 text-sm text-black/70">{m.blurb}</p>}
      {m.targetDate && m.status !== 'done' && (
        <p className="mt-2 text-xs text-black/50">Target: {fmtDate(m.targetDate)}</p>
      )}
      {m.doneAt && m.status === 'done' && (
        <p className="mt-2 text-xs text-black/50">Completed {fmtDate(m.doneAt)}</p>
      )}
    </div>
  )
}

export function MilestonesSection({
  section,
  data,
  token,
}: {
  section: PublicSection
  data: ViewbookPublicData
  token: string
}) {
  const hero = data.theme.sectionHeroes[section.sectionKey]
  const withLinks = data.milestones.filter((m) => m.reviewLinks.length > 0)
  const current = data.milestones.find((m) => m.status === 'current')
  const { done, total } = milestoneProgress(data.milestones)
  return (
    <SectionShell
      section={section}
      stage={data.stage}
      title={SECTION_TITLES[section.sectionKey]}
      heroUrl={hero ? publicAssetUrl(token, hero) : null}
      summary={
        <SummaryStat
          eyebrow="Milestones"
          headline={`${done} of ${total} complete`}
          chip={current ? current.title : undefined}
        />
      }
    >
      <div className="flex gap-4 overflow-x-auto pb-2">
        {data.milestones.map((m) => (
          <StageCard key={m.id} m={m} />
        ))}
      </div>

      {withLinks.length === 0 ? (
        <p className="text-black/50">Reviews will appear here at each touchpoint.</p>
      ) : (
        withLinks.map((m) => (
          <div key={m.id} className="space-y-3">
            <h3 className="text-xl font-bold" style={{ fontFamily: 'var(--vb-heading-font)' }}>
              {m.title} — reviews
            </h3>
            {m.reviewLinks.map((l) => (
              <div key={l.id} className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  {isHttpsUrl(l.url) ? (
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium underline"
                      style={{ color: 'var(--vb-secondary)' }}
                    >
                      {l.label}
                    </a>
                  ) : (
                    <span className="font-medium text-black/70">{l.label}</span>
                  )}
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-semibold uppercase"
                    style={{ background: 'var(--vb-primary)', color: 'var(--vb-on-primary)' }}
                  >
                    {l.kind}
                  </span>
                  {l.feedback.length > 0 && (
                    <span className="ml-auto text-xs text-black/50">
                      {l.feedback.length} comment{l.feedback.length === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                <div className="mt-3">
                  <FeedbackThread token={token} reviewLinkId={l.id} initialFeedback={l.feedback} />
                </div>
              </div>
            ))}
          </div>
        ))
      )}
    </SectionShell>
  )
}
