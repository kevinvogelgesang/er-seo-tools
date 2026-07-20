// components/site-audit/DeadPagesSection.tsx
//
// Renders audited URLs that were advertised by the sitemap/crawl but returned
// 404 or 410 during the live scan. Pure presentational — the page loads the run.

import type { BrokenLinksRun } from './BrokenLinksSection'
import { DEAD_PAGE_FINDING_LABEL, DEAD_PAGE_FINDING_TYPE } from '@/lib/findings/finding-type-sets'
import { Explainer, ExplainerSummary, ExplainerTags, ExplainerNote } from '@/components/ui/Explainer'

function parseDetail(detail: string | null): Record<string, unknown> {
  if (!detail) return {}
  try {
    return JSON.parse(detail) as Record<string, unknown>
  } catch {
    return {}
  }
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-6">
      <div className="flex items-center gap-1 mb-3">
        <h2 className="text-[15px] font-heading font-semibold text-navy dark:text-white">
          {DEAD_PAGE_FINDING_LABEL}
        </h2>
        <Explainer title={DEAD_PAGE_FINDING_LABEL} label="What does the dead-page check measure?">
          <ExplainerSummary>
            A dead audited URL is advertised by the sitemap or crawl but returns a 404 or 410 when
            requested. These URLs waste crawl budget and can send visitors to a broken experience.
          </ExplainerSummary>
          <ExplainerTags tags={['Sitemap URLs', 'Crawl results', '404 / 410']} />
          <ExplainerNote>
            Restore the page when it still serves a purpose, redirect it to the closest replacement,
            or remove stale references from sitemaps and internal links.
          </ExplainerNote>
        </Explainer>
      </div>
      {children}
    </section>
  )
}

export function DeadPagesSection({ run }: { run: BrokenLinksRun | null }) {
  if (!run) {
    return (
      <Card>
        <p className="text-[13px] font-body text-navy/50 dark:text-white/50">
          Dead pages not yet scanned — the live scan runs shortly after the audit completes.
        </p>
      </Card>
    )
  }

  const deadPages = run.findings.flatMap((finding) => {
    if (finding.scope !== 'page' || finding.type !== DEAD_PAGE_FINDING_TYPE || !finding.url) return []
    const statusCode = parseDetail(finding.detail).statusCode
    return [{ url: finding.url, statusCode: typeof statusCode === 'number' ? statusCode : null }]
  })

  if (deadPages.length === 0) {
    return (
      <Card>
        <p className="text-[13px] font-body text-green-700 dark:text-green-400">
          No dead pages found among audited URLs.
        </p>
      </Card>
    )
  }

  return (
    <Card>
      <div className="space-y-2">
        <p className="text-[13px] font-body font-semibold text-red-600 dark:text-red-400">
          {DEAD_PAGE_FINDING_LABEL}: {deadPages.length}
        </p>
        <ul className="space-y-1">
          {deadPages.map((page) => (
            <li key={page.url} className="flex items-start gap-2 text-[12px] font-body text-navy/60 dark:text-white/60">
              <span className="break-all">{page.url}</span>
              {page.statusCode !== null && (
                <span className="shrink-0 rounded-full bg-red-100 dark:bg-red-500/15 px-2 py-0.5 text-[11px] font-body font-semibold text-red-700 dark:text-red-400">
                  {page.statusCode}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  )
}
