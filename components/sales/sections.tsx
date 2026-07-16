// The four report sections, rebuilt for urgency (C14 redesign). Server
// components; evidence is pre-curated by the loader — these only render what
// they are given. Open by default (leave-behind); progressive disclosure
// remains for methodology explainers and long lists.
import { Explainer, ExplainerNote, ExplainerSummary } from '@/components/ui/Explainer'
import type { CwvStatus } from '@/lib/ada-audit/lighthouse-types'
import type { ImpactLevel } from '@/lib/ada-audit/types'
import {
  ER_ADA_CTA, ISSUE_WHY, SCHEMA_IMPLICATIONS, SCORE_METHOD, SECTION_INTROS, WCAG_MEANING,
} from '@/lib/sales/copy'
import type { SalesReportData } from '@/lib/sales/sales-report-data'
import { SectionCard, gradeForScore } from './SectionCard'
import { UrgencyBar } from './UrgencyBar'

// Contextual card heading + trigger aria-label per area, so each ⓘ has a
// distinct accessible name (four render on one page) and the card names the
// area it explains.
const METHOD_TITLES: Record<keyof typeof SCORE_METHOD, string> = {
  overall: 'How the overall score is calculated',
  accessibility: 'How the accessibility score is calculated',
  seo: 'How the SEO score is calculated',
  performance: 'How the performance score is calculated',
  geo: 'How the structured-data score is calculated',
}

function MethodExplainer(props: { area: keyof typeof SCORE_METHOD }) {
  const m = SCORE_METHOD[props.area]
  const title = METHOD_TITLES[props.area]
  return (
    <div className="flex items-center gap-1">
      <span className="text-[12px] font-body text-navy/50 dark:text-white/50">
        How this score is calculated
      </span>
      <Explainer label={title} title={title}>
        <ExplainerSummary>{m.summary}</ExplainerSummary>
        <ExplainerNote>{m.note}</ExplainerNote>
      </Explainer>
    </div>
  )
}

/** Lead paragraph under a section header — sets the stakes (Kevin pass 2). */
function SectionLead(props: { children: React.ReactNode }) {
  return <p className="text-[14px] font-body text-navy/70 dark:text-white/70 leading-relaxed">{props.children}</p>
}

// ── Accessibility: counts only — no itemized rules ─────────────────────────

const SEVERITY_TILES = [
  { key: 'critical' as const, label: 'Critical', cls: 'text-red-600 dark:text-red-400' },
  { key: 'serious' as const, label: 'Serious', cls: 'text-red-500 dark:text-red-400/90' },
  { key: 'moderate' as const, label: 'Moderate', cls: 'text-amber-600 dark:text-amber-400' },
  { key: 'minor' as const, label: 'Minor', cls: 'text-amber-500 dark:text-amber-300' },
]

const IMPACT_CHIP: Record<ImpactLevel, string> = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  serious: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  moderate: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  minor: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
}
const IMPACT_LABEL: Record<ImpactLevel, string> = {
  critical: 'Critical', serious: 'Serious', moderate: 'Moderate', minor: 'Minor',
}

export function AccessibilitySalesSection(props: {
  data: SalesReportData['accessibility']
  standardTested: string
  archived: boolean
}) {
  const { counts, issueTypes = [] } = props.data
  return (
    <SectionCard
      title="Accessibility"
      grade={gradeForScore(props.data.score)}
      gradeLabel={props.data.score === null ? 'Not scored' : `${props.data.score}/100`}
      headline={`${counts.total} accessibility issues found across the scanned pages`}
      defaultOpen
    >
      <SectionLead>{SECTION_INTROS.accessibility}</SectionLead>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {SEVERITY_TILES.map((t) => (
          <div key={t.key} className="rounded-xl border border-gray-200 dark:border-navy-border p-4 sm:p-5 text-center">
            <div className={`text-3xl sm:text-4xl font-heading font-extrabold tabular-nums ${t.cls}`}>{counts[t.key]}</div>
            <div className="mt-1 text-[12px] font-body text-navy/50 dark:text-white/50">{t.label}</div>
          </div>
        ))}
      </div>
      {issueTypes.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[13px] font-heading font-semibold text-navy dark:text-white">
            The kinds of barriers we found
          </h3>
          <ul className="space-y-2">
            {issueTypes.map((it) => (
              <li
                key={it.ruleId}
                className="flex items-start gap-3 rounded-xl border border-gray-200 dark:border-navy-border p-3.5"
              >
                <span className={`mt-0.5 shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-heading font-semibold ${IMPACT_CHIP[it.impact]}`}>
                  {IMPACT_LABEL[it.impact]}
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-body text-navy/80 dark:text-white/80">{it.help}</p>
                  <p className="mt-0.5 text-[12px] font-body text-navy/45 dark:text-white/45">
                    Found on {it.affectedPages} {it.affectedPages === 1 ? 'page' : 'pages'}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-[12px] font-body text-navy/45 dark:text-white/45">
            These are the types of issues detected — the full element-by-element breakdown is part of the detailed audit we walk through together.
          </p>
        </div>
      )}
      <p className="text-[13px] font-body text-navy/60 dark:text-white/60">
        Tested against {props.standardTested}. {WCAG_MEANING}
      </p>
      {props.archived && (
        <p className="text-[12px] font-body text-amber-600 dark:text-amber-400">
          Detailed evidence for this scan has been archived — counts above come from the retained findings. Re-scan for fresh evidence.
        </p>
      )}
      <div className="rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 p-4">
        <p className="text-[13px] font-body text-navy/80 dark:text-white/80">{ER_ADA_CTA}</p>
      </div>
      <MethodExplainer area="accessibility" />
    </SectionCard>
  )
}

// ── SEO: urgency rows ───────────────────────────────────────────────────────

export function SeoSalesSection(props: { data: SalesReportData['seo']; pagesScanned: number; seoUnavailable?: boolean }) {
  const d = props.data
  const pages = Math.max(1, props.pagesScanned)
  const headline = props.seoUnavailable
    ? 'SEO analysis unavailable for this scan'
    : d.issueGroups.length
      ? d.issueGroups.slice(0, 2).map((g) => `${g.count} ${g.label.toLowerCase()}`).join(' · ')
      : 'No blocking SEO issues found on scanned pages'
  return (
    <SectionCard
      title="SEO"
      grade={gradeForScore(d.score)}
      gradeLabel={d.score === null ? 'Not scored' : `${d.score}/100`}
      headline={headline}
      defaultOpen
    >
      <SectionLead>{SECTION_INTROS.seo}</SectionLead>
      {props.seoUnavailable ? (
        <p className="text-sm text-gray-600 dark:text-white/60">
          SEO analysis is unavailable for this scan — the post-scan SEO verifier did not complete.
          Accessibility, performance, and structured-data results below are unaffected.
        </p>
      ) : (
        <>
          {d.issueGroups.length === 0 && (
            <p className="text-[13px] font-body text-green-700 dark:text-green-400">
              The scanned pages came back clean on links, titles, and content depth.
            </p>
          )}
          {d.issueGroups.map((g) => (
            <div key={g.type} className="rounded-xl border border-gray-200 dark:border-navy-border p-4 space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] font-heading font-semibold text-navy dark:text-white">{g.label}</span>
                <span className="text-[13px] font-heading font-bold text-red-600 dark:text-red-400">{g.count}</span>
              </div>
              <UrgencyBar
                value={g.affectedPages}
                max={pages}
                ariaLabel={`${g.label}: ${g.affectedComplete ? '' : 'at least '}${g.affectedPages} of ${props.pagesScanned} pages affected`}
              />
              <p className="text-[12px] font-body text-navy/50 dark:text-white/50">
                {g.affectedComplete ? `${g.affectedPages}` : `At least ${g.affectedPages}`} of {props.pagesScanned} pages affected
              </p>
              <p className="text-[12px] font-body text-navy/60 dark:text-white/60">{ISSUE_WHY[g.type]}</p>
            </div>
          ))}
          {((d.duplicateContentGroups ?? 0) > 0 || (d.sitemapMissRatePct ?? 0) > 0) && (
            <div className="rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 p-4 space-y-1">
              {d.duplicateContentGroups !== null && d.duplicateContentGroups > 0 && (
                <p className="text-[13px] font-body text-navy/70 dark:text-white/70">
                  {d.duplicateContentGroups} groups of pages share near-identical content — they compete with each other in search.
                </p>
              )}
              {d.sitemapMissRatePct !== null && d.sitemapMissRatePct > 0 && (
                <p className="text-[13px] font-body text-navy/70 dark:text-white/70">
                  {d.sitemapMissRatePct}% of reachable pages are missing from the sitemap — search engines may never find them.
                </p>
              )}
            </div>
          )}
        </>
      )}
      <MethodExplainer area="seo" />
    </SectionCard>
  )
}

// ── Performance: homepage card + slowest pages + roll-up ───────────────────

const STATUS_CLS: Record<CwvStatus, string> = {
  pass: 'text-green-700 dark:text-green-400',
  'needs-improvement': 'text-amber-600 dark:text-amber-400',
  fail: 'text-red-600 dark:text-red-400',
}
// Lighthouse lab thresholds (spec): LCP ≤2.5s good />4s poor; CLS ≤0.1/>0.25; TBT ≤200ms/>600ms.
const lcpCls = (ms: number) => (ms <= 2500 ? STATUS_CLS.pass : ms > 4000 ? STATUS_CLS.fail : STATUS_CLS['needs-improvement'])
const clsCls = (v: number) => (v <= 0.1 ? STATUS_CLS.pass : v > 0.25 ? STATUS_CLS.fail : STATUS_CLS['needs-improvement'])
const tbtCls = (ms: number) => (ms <= 200 ? STATUS_CLS.pass : ms > 600 ? STATUS_CLS.fail : STATUS_CLS['needs-improvement'])
const sec = (ms: number) => `${(ms / 1000).toFixed(1)}s`
// Layout shift is a small unitless ratio — pin to 3 decimals (Lighthouse
// convention) so raw float noise never leaks into the report.
const fmtCls = (v: number) => v.toFixed(3)

/** A single defined metric card for the homepage vitals row. */
function MetricCard(props: { label: string; value: string; valueCls: string; hint: string }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-navy-border bg-gray-50/60 dark:bg-white/[0.03] p-4 flex flex-col">
      <span className="text-[11px] font-body uppercase tracking-wide text-navy/45 dark:text-white/45">{props.label}</span>
      <span className={`mt-1.5 text-3xl font-heading font-extrabold tabular-nums ${props.valueCls}`}>{props.value}</span>
      <span className="mt-auto pt-1 text-[11px] font-body text-navy/40 dark:text-white/40">{props.hint}</span>
    </div>
  )
}

export function PerformanceSalesSection(props: { data: SalesReportData['performance'] }) {
  const { rollup, homepage } = props.data
  const grade = rollup ? gradeForScore(rollup.medianPerformance) : homepage ? gradeForScore(homepage.performance) : 'none'
  const gradeLabel = rollup ? `${rollup.medianPerformance}/100` : homepage ? `${homepage.performance}/100 (homepage)` : 'Not measured'
  const headline = rollup
    ? `Slowest pages take ${sec(rollup.p75LcpMs)} to show their main content (Lighthouse-measured, ${rollup.measuredPages} pages)`
    : 'Not enough pages were measured for a reliable site-wide roll-up'
  return (
    <SectionCard title="Performance" grade={grade} gradeLabel={gradeLabel} headline={headline} defaultOpen>
      <SectionLead>{SECTION_INTROS.performance}</SectionLead>
      {/* (a) Homepage CWV cards — independent of the roll-up (spec Codex fix 6) */}
      {homepage ? (
        <div>
          <h3 className="text-[13px] font-heading font-semibold text-navy dark:text-white mb-3">Your homepage</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard
              label="Lighthouse score"
              value={`${homepage.performance}`}
              valueCls={gradeForScore(homepage.performance) === 'good' ? STATUS_CLS.pass : gradeForScore(homepage.performance) === 'warn' ? STATUS_CLS['needs-improvement'] : STATUS_CLS.fail}
              hint="out of 100"
            />
            <MetricCard label="Largest paint" value={sec(homepage.lcpMs)} valueCls={STATUS_CLS[homepage.lcpStatus]} hint="main content shown" />
            <MetricCard label="Layout shift" value={fmtCls(homepage.cls)} valueCls={STATUS_CLS[homepage.clsStatus]} hint="lower is steadier" />
            <MetricCard label="Blocking time" value={`${Math.round(homepage.tbtMs)}ms`} valueCls={STATUS_CLS[homepage.tbtStatus]} hint="lab proxy" />
          </div>
        </div>
      ) : (
        <p className="text-[12px] font-body text-navy/45 dark:text-white/45">
          Not measured on the homepage — see site-wide numbers below.
        </p>
      )}
      {/* (b) 5 slowest pages */}
      {rollup && rollup.worstPages.length > 0 && (
        <div>
          <h3 className="text-[13px] font-heading font-semibold text-navy dark:text-white mb-2">Slowest pages</h3>
          <ul className="space-y-2">
            {rollup.worstPages.map((p) => (
              <li key={p.url} className="space-y-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[12px] font-body text-navy/60 dark:text-white/60 break-all">{p.url}</span>
                  <span className="shrink-0 text-[12px] font-heading font-semibold text-red-600 dark:text-red-400">{p.performance}/100</span>
                </div>
                <UrgencyBar value={100 - p.performance} max={100} ariaLabel={`${p.url}: Lighthouse score ${p.performance} out of 100`} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {/* (c) averaged roll-up */}
      {rollup ? (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div><dt className="text-[12px] font-body text-navy/50 dark:text-white/50">Largest paint (p75)</dt><dd className={`text-[15px] font-heading font-semibold ${lcpCls(rollup.p75LcpMs)}`}>{sec(rollup.p75LcpMs)}</dd></div>
          <div><dt className="text-[12px] font-body text-navy/50 dark:text-white/50">Layout shift (p75)</dt><dd className={`text-[15px] font-heading font-semibold ${clsCls(rollup.p75Cls)}`}>{fmtCls(rollup.p75Cls)}</dd></div>
          <div><dt className="text-[12px] font-body text-navy/50 dark:text-white/50">Blocking time (p75, lab proxy)</dt><dd className={`text-[15px] font-heading font-semibold ${tbtCls(rollup.p75TbtMs)}`}>{Math.round(rollup.p75TbtMs)}ms</dd></div>
          <div><dt className="text-[12px] font-body text-navy/50 dark:text-white/50">Pages passing all checks</dt><dd className="text-[15px] font-heading font-semibold text-navy dark:text-white">{rollup.pctPassing}%</dd></div>
        </dl>
      ) : (
        <p className="text-[12px] font-body text-navy/45 dark:text-white/45">Re-scan to collect site-wide Lighthouse measurements.</p>
      )}
      <MethodExplainer area="performance" />
    </SectionCard>
  )
}

// ── Structured data: 2×2 high-value grid, evidence-bounded ─────────────────

export function GeoSalesSection(props: { data: SalesReportData['geo']; pagesTotal: number | null }) {
  const d = props.data
  // Unified urgency bands (Kevin pass 2): coverage grades on the same scale.
  const grade = gradeForScore(d.coveragePct)
  const present = new Set(d.types.map((t) => t.type))
  const highValue = [...present].filter((t) => !d.missingHighValueTypes.includes(t))
  const cards = [...highValue, ...d.missingHighValueTypes]
    .filter((t, i, a) => a.indexOf(t) === i)
    .filter((t) => t in SCHEMA_IMPLICATIONS)
  const observationPartial = d.observedPages !== null && props.pagesTotal !== null && d.observedPages < props.pagesTotal
  const otherTypes = d.types.filter((t) => !(t.type in SCHEMA_IMPLICATIONS))
  return (
    <SectionCard
      title="Structured data & AI readiness"
      grade={grade}
      gradeLabel={d.coveragePct === null ? 'Not measured' : `${d.coveragePct}% coverage`}
      headline={
        d.missingHighValueTypes.length
          ? `${d.missingHighValueTypes.slice(0, 2).join(' and ')} structured data not observed on the pages we scanned`
          : 'High-value structured data types are present'
      }
      defaultOpen
    >
      <SectionLead>{SECTION_INTROS.geo}</SectionLead>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {cards.map((type) => {
          const found = present.has(type)
          return (
            <div key={type} className="rounded-xl border border-gray-200 dark:border-navy-border p-4 space-y-1">
              <div className="flex items-center gap-2">
                <span aria-hidden className={`text-lg font-bold ${found ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {found ? '✓' : '✗'}
                </span>
                <span className="text-[13px] font-heading font-semibold text-navy dark:text-white">{type}</span>
              </div>
              <p className="text-[12px] font-body text-navy/60 dark:text-white/60">
                {found
                  ? `In place — search engines and AI tools can read your ${type} details directly instead of guessing.`
                  : `Not observed on the ${d.observedPages ?? 0} pages we scanned${observationPartial ? ' (coverage may be partial)' : ''}. ${SCHEMA_IMPLICATIONS[type]}`}
              </p>
            </div>
          )
        })}
      </div>
      {d.observedPages !== null && (
        <p className="text-[13px] font-body text-navy/60 dark:text-white/60">
          {d.pagesWithSchema} of {d.observedPages} scanned pages carry structured data.
        </p>
      )}
      {otherTypes.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {otherTypes.map((t) => (
            <li key={t.type} className="rounded-full bg-gray-100 dark:bg-white/10 px-3 py-1 text-[12px] font-body text-navy/70 dark:text-white/70">
              {t.type} · {t.pages}
            </li>
          ))}
        </ul>
      )}
      {d.hreflangIssueCount > 0 && (
        <p className="text-[12px] font-body text-navy/50 dark:text-white/50">{d.hreflangIssueCount} language-annotation issues found.</p>
      )}
      <MethodExplainer area="geo" />
    </SectionCard>
  )
}
