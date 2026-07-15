// The four disclosure sections. Server components; evidence is pre-curated by
// the loader — these only render what they are given.
import { SECTION_INTROS } from '@/lib/sales/copy'
import type { SalesReportData } from '@/lib/sales/sales-report-data'
import { ExampleCard } from './ExampleCard'
import { SectionCard, gradeForScore } from './SectionCard'

export function AccessibilitySalesSection(props: { data: SalesReportData['accessibility']; token: string; archived: boolean }) {
  const { counts } = props.data
  return (
    <SectionCard
      title="Accessibility"
      grade={gradeForScore(props.data.score)}
      gradeLabel={props.data.score === null ? 'Not scored' : `${props.data.score}/100`}
      headline={`${counts.critical} critical · ${counts.serious} serious issues across the scanned pages`}
      intro={SECTION_INTROS.accessibility}
    >
      {props.archived && (
        <p className="text-[12px] font-body text-amber-600 dark:text-amber-400">
          Detailed evidence for this scan has been archived — examples below are a capped sample. Re-scan for fresh evidence.
        </p>
      )}
      {props.data.patterns.map((p) => (
        <details key={p.ruleId} className="rounded-xl border border-gray-200 dark:border-navy-border">
          <summary className="cursor-pointer list-none p-4">
            <span className="text-[13px] font-heading font-semibold text-navy dark:text-white">{p.help}</span>
            <span className="ml-2 text-[12px] font-body text-navy/50 dark:text-white/50">
              {p.affectedPagesCount} of {p.totalPagesScanned} pages
            </span>
          </summary>
          <div className="px-4 pb-4 space-y-3">
            <p className="text-[12px] font-body text-navy/60 dark:text-white/60">{p.description}</p>
            {p.examples.length === 0 ? (
              <p className="text-[12px] font-body text-navy/45 dark:text-white/45">Example elements unavailable for this pattern.</p>
            ) : (
              p.examples.map((e, i) => <ExampleCard key={i} example={e} token={props.token} alt={`${p.ruleId} example`} />)
            )}
          </div>
        </details>
      ))}
    </SectionCard>
  )
}

export function SeoSalesSection(props: { data: SalesReportData['seo'] }) {
  const d = props.data
  const headline = d.issueGroups.length
    ? d.issueGroups.slice(0, 2).map((g) => `${g.count} ${g.label.toLowerCase()}`).join(' · ')
    : 'No blocking SEO issues found on scanned pages'
  return (
    <SectionCard
      title="SEO"
      grade={gradeForScore(d.score)}
      gradeLabel={d.score === null ? 'Not scored' : `${d.score}/100`}
      headline={headline}
      intro={SECTION_INTROS.seo}
    >
      {d.issueGroups.length === 0 && (
        <p className="text-[13px] font-body text-green-700 dark:text-green-400">
          The scanned pages came back clean on links, titles, and content depth.
        </p>
      )}
      {d.issueGroups.map((g) => (
        <details key={g.type} className="rounded-xl border border-gray-200 dark:border-navy-border">
          <summary className="cursor-pointer list-none p-4 text-[13px] font-heading font-semibold text-navy dark:text-white">
            {g.label} <span className="ml-2 font-body font-normal text-navy/50 dark:text-white/50">{g.count}</span>
          </summary>
          {g.examplePages.length > 0 && (
            <ul className="px-4 pb-4 space-y-1">
              {g.examplePages.map((u) => (
                <li key={u} className="text-[12px] font-body text-navy/60 dark:text-white/60 break-all">{u}</li>
              ))}
            </ul>
          )}
        </details>
      ))}
      <div className="text-[12px] font-body text-navy/50 dark:text-white/50 space-y-1">
        {d.duplicateContentGroups !== null && d.duplicateContentGroups > 0 && (
          <p>{d.duplicateContentGroups} groups of pages share near-identical content.</p>
        )}
        {d.sitemapMissRatePct !== null && d.sitemapMissRatePct > 0 && (
          <p>{d.sitemapMissRatePct}% of reachable pages are missing from the sitemap.</p>
        )}
      </div>
    </SectionCard>
  )
}

export function PerformanceSalesSection(props: { data: SalesReportData['performance'] }) {
  const d = props.data.rollup
  if (!d) {
    return (
      <SectionCard title="Performance" grade="none" gradeLabel="Not measured"
        headline="Not enough pages were measured for a reliable roll-up"
        intro={SECTION_INTROS.performance}
      >
        <p className="text-[12px] font-body text-navy/45 dark:text-white/45">Re-scan to collect Lighthouse measurements.</p>
      </SectionCard>
    )
  }
  const s = (ms: number) => `${(ms / 1000).toFixed(1)}s`
  return (
    <SectionCard
      title="Performance"
      grade={gradeForScore(d.medianPerformance)}
      gradeLabel={`${d.medianPerformance}/100`}
      headline={`Slowest pages take ${s(d.p75LcpMs)} to show their main content (Lighthouse-measured, ${d.measuredPages} pages)`}
      intro={SECTION_INTROS.performance}
    >
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div><dt className="text-[12px] font-body text-navy/50 dark:text-white/50">Largest paint (p75)</dt><dd className="text-[15px] font-heading font-semibold text-navy dark:text-white">{s(d.p75LcpMs)}</dd></div>
        <div><dt className="text-[12px] font-body text-navy/50 dark:text-white/50">Layout shift (p75)</dt><dd className="text-[15px] font-heading font-semibold text-navy dark:text-white">{d.p75Cls}</dd></div>
        <div><dt className="text-[12px] font-body text-navy/50 dark:text-white/50">Blocking time (p75, lab proxy)</dt><dd className="text-[15px] font-heading font-semibold text-navy dark:text-white">{Math.round(d.p75TbtMs)}ms</dd></div>
        <div><dt className="text-[12px] font-body text-navy/50 dark:text-white/50">Pages passing all checks</dt><dd className="text-[15px] font-heading font-semibold text-navy dark:text-white">{d.pctPassing}%</dd></div>
      </dl>
      {d.worstPages.length > 0 && (
        <div>
          <h3 className="text-[13px] font-heading font-semibold text-navy dark:text-white mb-1">Slowest pages</h3>
          <ul className="space-y-1">
            {d.worstPages.map((p) => (
              <li key={p.url} className="text-[12px] font-body text-navy/60 dark:text-white/60 break-all">
                {p.url} — <span className="text-red-600 dark:text-red-400">{p.performance}/100</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  )
}

export function GeoSalesSection(props: { data: SalesReportData['geo'] }) {
  const d = props.data
  const grade = d.coveragePct === null ? 'none' : d.coveragePct >= 60 ? 'good' : d.coveragePct >= 30 ? 'warn' : 'bad'
  return (
    <SectionCard
      title="Structured data & AI readiness"
      grade={grade}
      gradeLabel={d.coveragePct === null ? 'Not measured' : `${d.coveragePct}% coverage`}
      headline={
        d.missingHighValueTypes.length
          ? `No ${d.missingHighValueTypes.slice(0, 2).join(' or ')} structured data found`
          : 'High-value structured data types are present'
      }
      intro={SECTION_INTROS.geo}
    >
      {d.observedPages !== null && (
        <p className="text-[13px] font-body text-navy/60 dark:text-white/60">
          {d.pagesWithSchema} of {d.observedPages} scanned pages carry structured data.
        </p>
      )}
      {d.types.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {d.types.map((t) => (
            <li key={t.type} className="rounded-full bg-gray-100 dark:bg-white/10 px-3 py-1 text-[12px] font-body text-navy/70 dark:text-white/70">
              {t.type} · {t.pages}
            </li>
          ))}
        </ul>
      )}
      {d.missingHighValueTypes.length > 0 && (
        <p className="text-[13px] font-body text-amber-600 dark:text-amber-400">
          Missing: {d.missingHighValueTypes.join(', ')} — AI search can’t confidently recommend your programs without these.
        </p>
      )}
      {d.hreflangIssueCount > 0 && (
        <p className="text-[12px] font-body text-navy/50 dark:text-white/50">{d.hreflangIssueCount} language-annotation issues found.</p>
      )}
    </SectionCard>
  )
}
