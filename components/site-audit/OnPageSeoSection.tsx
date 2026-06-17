// components/site-audit/OnPageSeoSection.tsx
//
// C6 Phase 2: renders on-page SEO findings (duplicate/missing/thin) from the
// live-scan CrawlRun. Reads the SAME run as BrokenLinksSection; filters to the
// on-page types only. "Clean" means no on-page findings among the successfully
// audited HTML pages — NOT whole-site clean (error/redirect/non-HTML pages are
// not evaluated this phase).
import type { BrokenLinksRun } from './BrokenLinksSection'

const ONPAGE_LABEL: Record<string, string> = {
  missing_title: 'Missing title',
  duplicate_title: 'Duplicate title',
  missing_meta_description: 'Missing meta description',
  duplicate_meta_description: 'Duplicate meta description',
  missing_h1: 'Missing H1',
  duplicate_h1: 'Duplicate H1',
  thin_content: 'Thin content (< 300 words)',
}
const ONPAGE_TYPES = new Set(Object.keys(ONPAGE_LABEL))

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-6">
      <h2 className="text-[15px] font-heading font-semibold text-navy dark:text-white mb-1">On-page SEO</h2>
      {children}
    </section>
  )
}

// `analyzed` distinguishes a Phase-2 run (on-page extraction ran — at least one
// CrawlPage has a populated statusCode) from a pre-Phase-2 live-scan run that
// only carries broken-link findings. Without it, an old run would render a
// misleading "clean" (Codex fix #4). The page computes it from the run's pages.
export function OnPageSeoSection({ run, analyzed }: { run: BrokenLinksRun | null; analyzed: boolean }) {
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
      <p className="text-[12px] font-body text-navy/45 dark:text-white/45 mb-3">
        Rendered-DOM, sitemap-bounded — among successfully audited HTML pages only. Not Screaming Frog crawl parity.
      </p>
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
