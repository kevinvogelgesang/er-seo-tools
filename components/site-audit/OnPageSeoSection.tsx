// components/site-audit/OnPageSeoSection.tsx
//
// C6 Phase 2: renders on-page SEO findings (duplicate/missing/thin) from the
// live-scan CrawlRun. Reads the SAME run as BrokenLinksSection; filters to the
// on-page types only. "Clean" means no on-page findings among the successfully
// audited HTML pages — NOT whole-site clean (error/redirect/non-HTML pages are
// not evaluated this phase).
import type { BrokenLinksRun } from './BrokenLinksSection'
import { ScoreExplanation } from '@/components/scoring/ScoreExplanation'
import { ONPAGE_FINDING_LABELS as ONPAGE_LABEL, ONPAGE_FINDING_TYPE_SET as ONPAGE_TYPES } from '@/lib/findings/finding-type-sets'
import { Explainer, ExplainerSummary, ExplainerTags, ExplainerColumns, ExplainerNote } from '@/components/ui/Explainer'

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-6">
      <div className="flex items-center gap-1 mb-3">
        <h2 className="text-[15px] font-heading font-semibold text-navy dark:text-white">On-page SEO</h2>
        <Explainer label="What is on-page SEO checking?" title="On-page SEO">
          <ExplainerSummary>
            On-page fundamentals read from the fully rendered pages — the title, meta description,
            H1 and body content that tell search engines what each page is about.
          </ExplainerSummary>
          <ExplainerTags tags={['Titles', 'Meta descriptions', 'H1 headings', 'Thin content', 'Duplicates']} />
          <ExplainerColumns
            good={{ label: 'Do', items: ['One unique, descriptive title per page', 'A distinct meta description', 'Exactly one H1', 'Enough substantive content'] }}
            bad={{ label: 'Avoid', items: ['Reusing a title or meta across pages', 'Missing or empty H1s', 'Thin, near-empty pages'] }}
          />
          <ExplainerNote>
            Evaluated over indexable HTML pages only — redirects, errors, noindex and login-style
            pages are skipped. Duplicate counts are groups of pages sharing a value, matching
            Screaming Frog semantics.
          </ExplainerNote>
        </Explainer>
      </div>
      {children}
    </section>
  )
}

function ScoreLine({ score, observed, indexable, attempted }:
  { score: number | null; observed: number; indexable: number; attempted: number }) {
  return (
    <div className="mb-3">
      <p className="text-[13px] font-body text-navy dark:text-white">
        Live SEO score:{' '}
        {score === null ? (
          <span className="text-navy/50 dark:text-white/50">not enough coverage to score</span>
        ) : (
          <span className="font-heading font-semibold">{score}/100</span>
        )}
      </p>
      <p className="text-[12px] font-body text-navy/45 dark:text-white/45">
        {observed} of {attempted} page{attempted === 1 ? '' : 's'} analyzed · {indexable} indexable · rendered, sitemap-bounded (not Screaming Frog parity)
      </p>
    </div>
  )
}

// `analyzed` distinguishes a Phase-2 run (on-page extraction ran — at least one
// CrawlPage has a populated statusCode) from a pre-Phase-2 live-scan run that
// only carries broken-link findings. Without it, an old run would render a
// misleading "clean" (Codex fix #4). The page computes it from the run's pages.
export function OnPageSeoSection({
  run, analyzed, score, observed, indexable, attempted, breakdown,
}: {
  run: BrokenLinksRun | null
  analyzed: boolean
  score: number | null
  observed: number
  indexable: number
  attempted: number
  breakdown: string | null
}) {
  if (!run) {
    return (
      <Card>
        <p className="text-[13px] font-body text-navy/50 dark:text-white/50">
          On-page SEO not yet analyzed — the live scan runs shortly after the audit completes.
        </p>
      </Card>
    )
  }
  if (!analyzed) {
    return (
      <Card>
        <p className="text-[13px] font-body text-navy/50 dark:text-white/50">
          This audit predates on-page SEO analysis — re-run the audit to populate it.
        </p>
      </Card>
    )
  }
  const runScope = run.findings.filter((f) => f.scope === 'run' && f.count > 0 && ONPAGE_TYPES.has(f.type))
  if (runScope.length === 0) {
    return (
      <Card>
        <ScoreLine score={score} observed={observed} indexable={indexable} attempted={attempted} />
        <ScoreExplanation breakdown={breakdown} />
        <p className="text-[13px] font-body text-green-700 dark:text-green-400">
          No on-page issues found among the successfully audited HTML pages.
        </p>
      </Card>
    )
  }
  const pageByType = new Map<string, string[]>()
  for (const f of run.findings) {
    if (f.scope !== 'page' || !f.url || !ONPAGE_TYPES.has(f.type)) continue
    const list = pageByType.get(f.type) ?? []
    list.push(f.url)
    pageByType.set(f.type, list)
  }
  return (
    <Card>
      <ScoreLine score={score} observed={observed} indexable={indexable} attempted={attempted} />
      <ScoreExplanation breakdown={breakdown} />
      <div className="space-y-4">
        {runScope.map((f) => {
          const pages = pageByType.get(f.type) ?? []
          return (
            <div key={f.type}>
              <p className="text-[13px] font-body font-semibold text-navy dark:text-white">
                {ONPAGE_LABEL[f.type] ?? f.type}: {f.count}
              </p>
              {pages.length > 0 && (
                <ul className="mt-1 space-y-1">
                  {pages.slice(0, 25).map((u, i) => (
                    <li key={i} className="text-[12px] font-body text-navy/60 dark:text-white/60 break-all">{u}</li>
                  ))}
                  {pages.length > 25 && (
                    <li className="text-[12px] font-body text-navy/40 dark:text-white/40">+{pages.length - 25} more</li>
                  )}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}
