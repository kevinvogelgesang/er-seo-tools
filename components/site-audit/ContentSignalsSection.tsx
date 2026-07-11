// components/site-audit/ContentSignalsSection.tsx
// C12: read-time stale-date + readability signals. Reads the SAME live-scan CrawlRun
// as the sibling measurement sections, from contentSignalsJson. Measurement, NOT a finding.
interface StaleDateHit { kind: 'copyright' | 'term' | 'deadline'; year: number; excerpt: string }
interface StaleDatePage { url: string; hits: StaleDateHit[] }
interface ReadabilityPage { url: string; fleschReadingEase: number; gradeLevel: number }
interface SignalsData {
  observedPages?: number
  truncatedPages?: number
  staleDates?: { pagesWithHits: number; pages: StaleDatePage[] }
  readability?: {
    scoredPages: number
    medianFleschReadingEase: number | null
    medianGradeLevel: number | null
    pages: ReadabilityPage[]
  }
}

const KIND_LABEL: Record<string, string> = { copyright: 'Copyright', term: 'Term/semester', deadline: 'Deadline' }

const NOT_ANALYZED = 'Content signals were not analyzed for this audit.'

function NotAnalyzed() {
  return (
    <section className="mt-6 rounded-lg bg-white dark:bg-navy-card p-4 border border-gray-200 dark:border-navy-border">
      <h3 className="text-base font-semibold text-gray-900 dark:text-white">Content signals</h3>
      <p className="mt-2 text-sm text-gray-600 dark:text-white/60">{NOT_ANALYZED}</p>
    </section>
  )
}

function StaleDatePageItem({ page }: { page: StaleDatePage }) {
  return (
    <details className="rounded border border-gray-200 dark:border-navy-border p-2 text-sm">
      <summary className="cursor-pointer text-gray-700 dark:text-white/70">
        {page.url} <span className="text-gray-400 dark:text-white/40">({page.hits.length} {page.hits.length === 1 ? 'hit' : 'hits'})</span>
      </summary>
      <ul className="mt-2 space-y-1 pl-2">
        {page.hits.map((h, i) => (
          <li key={i} className="text-gray-600 dark:text-white/60">
            {KIND_LABEL[h.kind] ?? h.kind} · {h.year} — {h.excerpt}
          </li>
        ))}
      </ul>
    </details>
  )
}

export function ContentSignalsSection({ run }: { run: { contentSignalsJson: string | null } | null }) {
  if (!run?.contentSignalsJson) return <NotAnalyzed />

  let d: SignalsData
  try {
    d = JSON.parse(run.contentSignalsJson)
  } catch {
    return <NotAnalyzed />
  }

  const staleDates = d.staleDates ?? { pagesWithHits: 0, pages: [] }
  const readability = d.readability ?? { scoredPages: 0, medianFleschReadingEase: null, medianGradeLevel: null, pages: [] }
  const clean = staleDates.pagesWithHits === 0
  const staleCapped = staleDates.pagesWithHits > staleDates.pages.length
  const readabilityCapped = readability.scoredPages > readability.pages.length

  return (
    <section className="mt-6 rounded-lg bg-white dark:bg-navy-card p-4 border border-gray-200 dark:border-navy-border">
      <h3 className="text-base font-semibold text-gray-900 dark:text-white">Content signals</h3>

      {clean ? (
        <p className="mt-2 text-sm text-gray-600 dark:text-white/60">No stale date references detected.</p>
      ) : (
        <div className="mt-3">
          <h4 className="text-sm font-medium text-amber-600 dark:text-amber-400">
            Stale date references ({staleDates.pagesWithHits})
          </h4>
          <ul className="mt-1 space-y-2">
            {staleDates.pages.map((p, i) => (
              <li key={i}>
                <StaleDatePageItem page={p} />
              </li>
            ))}
          </ul>
          {staleCapped && (
            <p className="mt-1 text-xs text-gray-400 dark:text-white/40">
              Showing top {staleDates.pages.length} of {staleDates.pagesWithHits} pages with stale date references.
            </p>
          )}
        </div>
      )}

      {(d.truncatedPages ?? 0) > 0 && (
        <p className="mt-3 text-xs text-gray-500 dark:text-white/50">
          Some page text was truncated at 30k characters, so this is not a full-content guarantee.
        </p>
      )}

      <div className="mt-4 border-t border-gray-100 dark:border-navy-border pt-3">
        <h4 className="text-sm font-medium text-gray-700 dark:text-white/70">Readability — English-calibrated (Flesch)</h4>
        {readability.scoredPages === 0 ? (
          <p className="mt-1 text-sm text-gray-500 dark:text-white/50">Not enough page text to score readability.</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-gray-600 dark:text-white/60">
              Median reading ease {readability.medianFleschReadingEase ?? '—'} · median grade level {readability.medianGradeLevel ?? '—'} across {readability.scoredPages} scored pages.
            </p>
            {readability.pages.length > 0 && (
              <ul className="mt-2 space-y-1">
                {readability.pages.map((p, i) => (
                  <li key={i} className="text-sm text-gray-700 dark:text-white/70">
                    {p.url} — reading ease {p.fleschReadingEase}, grade {p.gradeLevel}
                  </li>
                ))}
              </ul>
            )}
            {readabilityCapped && (
              <p className="mt-1 text-xs text-gray-400 dark:text-white/40">
                Showing top {readability.pages.length} of {readability.scoredPages} scored pages.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  )
}
