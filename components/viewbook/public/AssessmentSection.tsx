// Current-Site Assessment (spec §8, PR5): async server component that loads
// its own audit snapshot (loadAssessmentData — fault-soft, null → coming-soon
// state) so the frozen ViewbookPublicData contract stays untouched. Same
// props as the retired AssessmentPlaceholder — the page swap was one import.
// Honest labels only: Lighthouse LAB data, no compliance or CWV-pass claims.
import type { ReactNode } from 'react'
import type { PublicSection, ViewbookPublicData, PublicAssessmentNotes } from '@/lib/viewbook/public-types'
import { loadAssessmentData } from '@/lib/viewbook/assessment'
import type { AssessmentData } from '@/lib/viewbook/assessment'
import { getOperatorEmailForPublicPage } from '@/lib/viewbook/public-session'
import { RichTextRenderer } from '@/components/richtext/RichTextRenderer'
import { isBlankRichText } from '@/lib/richtext/sanitize'
import { SectionShell } from './SectionShell'
import { SECTION_TITLES } from './section-titles'
import { publicAssetUrl } from './ThemeStyle'
import { Tooltip } from './Tooltip'
import { SummaryStat, sectionStatusLabel } from './SummaryStat'
import { AssessmentNotesEditors } from './AssessmentNotesEditors'

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  })
}

function seconds(ms: number): string {
  return `${Math.round(ms / 100) / 10} s`
}

// D12: Cumulative Layout Shift is a small unitless ratio — always show two
// decimals so 0.2 doesn't read as a coarser number than 0.02. Scores stay
// `/100` and LCP stays 1-decimal seconds (unchanged).
function cls(x: number): string {
  return Number(x).toFixed(2)
}

// codex-review P2: a cleared contentEditable region can sanitize to
// break-only markup (`<br />`, `<p><br /></p>`) — `.trim().length > 0`
// treats that as "populated" and leaks an empty "General notes"/"User
// Behaviour" heading with nothing under it. `isBlankRichText` strips tags
// (and `&nbsp;`) before checking for real text, so this also protects
// legacy/already-stored rows written before `setAssessmentNote` started
// normalizing break-only input to `''` at write time. Does not affect the
// User Behaviour image-gallery check below, which is a separate `images`
// array, not this text-body check.
function hasHtml(html: string | null | undefined): boolean {
  return typeof html === 'string' && !isBlankRichText(html)
}

function ScoreTile({ label, score, note }: { label: string; score: number | null; note?: string }) {
  return (
    <div className="rounded-xl border border-black/10 bg-white p-5 shadow-sm">
      <p className="text-sm font-semibold text-black/60">{label}</p>
      {score == null ? (
        <p className="mt-1 text-black/50">{label} details unavailable for this scan</p>
      ) : (
        <p className="text-4xl font-extrabold" style={{ fontFamily: 'var(--vb-heading-font)' }}>
          {score}
          <span className="text-lg font-semibold text-black/40">/100</span>
        </p>
      )}
      {note && <p className="mt-1 text-xs text-black/45">{note}</p>}
    </div>
  )
}

function AssessmentBody({
  assessment,
  narrative,
  notesSlot,
}: {
  assessment: AssessmentData
  narrative: string | null
  notesSlot: ReactNode
}) {
  const impactWord: Record<string, string> = {
    critical: 'critical', serious: 'serious', moderate: 'moderate', minor: 'minor',
  }
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <ScoreTile label="Accessibility" score={assessment.adaScore} note={`Measured against ${assessment.standardTested}`} />
        {/* null score renders the tile's own "details unavailable" line — no extra note */}
        <ScoreTile label="SEO" score={assessment.seoScore} />
      </div>

      <div>
        <h3 className="text-xl font-bold" style={{ fontFamily: 'var(--vb-heading-font)' }}>
          Accessibility patterns we found
        </h3>
        {assessment.adaPatterns.length === 0 ? (
          <p className="mt-2 text-black/50">No site-wide patterns detected in this scan.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {assessment.adaPatterns.map((p, i) => (
              <li key={i} className="rounded-lg border border-black/10 bg-white px-4 py-3 shadow-sm">
                <p className="font-medium">{p.help}</p>
                <p className="text-sm text-black/50">
                  {p.affectedPagesCount} of {p.totalPagesScanned} pages · {impactWord[p.impact] ?? p.impact} impact
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {assessment.seoIssues.length > 0 && (
        <div>
          <h3 className="text-xl font-bold" style={{ fontFamily: 'var(--vb-heading-font)' }}>
            SEO issues
          </h3>
          <ul className="mt-3 space-y-2">
            {assessment.seoIssues.map((i) => (
              <li key={i.label} className="flex items-baseline justify-between rounded-lg border border-black/10 bg-white px-4 py-3 shadow-sm">
                <span className="font-medium">{i.label}</span>
                <span className="text-sm text-black/50">
                  {i.count} {i.unit}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(assessment.homepage || assessment.performance) && (
        <div>
          <h3 className="flex items-center gap-2 text-xl font-bold" style={{ fontFamily: 'var(--vb-heading-font)' }}>
            Performance (Lighthouse lab test)
            <Tooltip
              id="assessment-lab-tip"
              label="Lab measurements from Google Lighthouse under fixed test conditions — directional, not field data from real visitors."
            />
          </h3>
          {assessment.homepage && (
            <div className="mt-3 rounded-lg border border-black/10 bg-white px-4 py-3 shadow-sm">
              <p className="text-sm font-semibold text-black/60">Homepage</p>
              <p className="mt-1">
                Performance {assessment.homepage.performance}/100 · Largest paint {seconds(assessment.homepage.lcpMs)} ·
                Layout shift {cls(assessment.homepage.cls)} · Blocking time {assessment.homepage.tbtMs} ms
              </p>
            </div>
          )}
          {assessment.performance && (
            <div className="mt-3 rounded-lg border border-black/10 bg-white px-4 py-3 shadow-sm">
              <p className="text-sm font-semibold text-black/60">
                Site-wide · {assessment.performance.measuredPages} pages measured
              </p>
              <p className="mt-1">
                Median performance {assessment.performance.medianPerformance}/100 · p75 largest paint{' '}
                {seconds(assessment.performance.p75LcpMs)} · p75 layout shift {cls(assessment.performance.p75Cls)} · p75
                blocking time {assessment.performance.p75TbtMs} ms
              </p>
            </div>
          )}
        </div>
      )}

      {narrative && (
        <div>
          <h3 className="text-xl font-bold" style={{ fontFamily: 'var(--vb-heading-font)' }}>
            What this means
          </h3>
          <p className="mt-2 whitespace-pre-line text-black/70">{narrative}</p>
        </div>
      )}

      {notesSlot}

      {assessment.completedAt && (
        <p className="text-sm text-black/40">Scanned {fmtDate(assessment.completedAt)}</p>
      )}
    </>
  )
}

// The two operator-authored blocks (General notes + User Behaviour). For a
// public viewer they render read-only sanitized HTML (via RichTextRenderer,
// which re-sanitizes) plus the user-behaviour image gallery served through
// the token'd public assets route (images are NEVER embedded in the HTML).
// For a signed-in operator the whole block is the autosaving editor leaf. An
// empty note-set for a public viewer renders NOTHING — no bare headers leak.
function AssessmentNotesBlocks({
  notes,
  operatorEmail,
  viewbookId,
  token,
}: {
  notes: PublicAssessmentNotes | null
  operatorEmail: string | null
  viewbookId: number
  token: string
}) {
  const generalHtml = notes?.generalNotesHtml ?? null
  const userBehaviourHtml = notes?.userBehaviourHtml ?? null
  const images = notes?.userBehaviourImages ?? []

  if (operatorEmail != null) {
    return (
      <AssessmentNotesEditors
        viewbookId={viewbookId}
        token={token}
        generalHtml={generalHtml ?? ''}
        userBehaviourHtml={userBehaviourHtml ?? ''}
        images={images}
      />
    )
  }

  const showGeneral = hasHtml(generalHtml)
  const showBehaviour = hasHtml(userBehaviourHtml) || images.length > 0
  if (!showGeneral && !showBehaviour) return null

  return (
    <>
      {showGeneral && (
        <div>
          <h3 className="text-xl font-bold" style={{ fontFamily: 'var(--vb-heading-font)' }}>
            General notes
          </h3>
          <div className="mt-2">
            <RichTextRenderer html={generalHtml as string} />
          </div>
        </div>
      )}
      {showBehaviour && (
        <div>
          <h3 className="text-xl font-bold" style={{ fontFamily: 'var(--vb-heading-font)' }}>
            User Behaviour
          </h3>
          {hasHtml(userBehaviourHtml) && (
            <div className="mt-2">
              <RichTextRenderer html={userBehaviourHtml as string} />
            </div>
          )}
          {images.length > 0 && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {images.map((img) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={img.id}
                  src={publicAssetUrl(token, img.filename)}
                  alt=""
                  className="w-full rounded-lg border border-black/10"
                />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}

export async function AssessmentSection({
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
  const [load, operatorEmail] = await Promise.all([
    loadAssessmentData(token),
    getOperatorEmailForPublicPage(),
  ])
  const assessment = load?.assessment ?? null
  const notes = load?.notes ?? null
  const viewbookId = load?.viewbookId ?? null

  // Notes render even without a reportable audit; they need the viewbook id
  // (from the same single token validation) to address the operator routes.
  const notesSlot =
    viewbookId != null ? (
      <AssessmentNotesBlocks
        notes={notes}
        operatorEmail={operatorEmail}
        viewbookId={viewbookId}
        token={token}
      />
    ) : null

  const hero = data.theme.sectionHeroes[section.sectionKey]
  const summaryHeadline = assessment
    ? `Snapshot of ${assessment.domain} · ${assessment.pagesAudited} pages audited`
    : sectionStatusLabel(section)
  return (
    <SectionShell
      section={section}
      stage={data.stage}
      title={SECTION_TITLES[section.sectionKey]}
      heroUrl={hero ? publicAssetUrl(token, hero) : null}
      summary={<SummaryStat eyebrow={SECTION_TITLES[section.sectionKey]} headline={summaryHeadline} />}
      affordance={data.collapseAffordance}
      overlayStrength={data.heroOverlayStrength}
      isOperator={isOperator}
      viewbookId={data.viewbookId}
      token={token}
    >
      {assessment ? (
        <AssessmentBody assessment={assessment} narrative={section.narrative} notesSlot={notesSlot} />
      ) : (
        <>
          <p className="text-black/60">
            Your first site scan is coming soon — we&apos;ll publish your current-site assessment here.
          </p>
          {notesSlot}
        </>
      )}
    </SectionShell>
  )
}
