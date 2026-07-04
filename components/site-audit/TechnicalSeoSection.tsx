// components/site-audit/TechnicalSeoSection.tsx
//
// C6 Phase 4: renders canonical/redirect/hreflang validation findings from the
// SAME live-scan CrawlRun as BrokenLinksSection/OnPageSeoSection, scoped to the
// validation type-set (disjoint from broken_* and on-page types). Clean = no
// validation findings among the audited pages.
import type { BrokenLinksRun } from './BrokenLinksSection'

const TECH_LABEL: Record<string, string> = {
  canonical_broken: 'Canonical broken',
  canonical_redirect: 'Canonical is a redirect',
  redirect_chain: 'Redirect chain (internal link)',
  redirect_loop: 'Redirect loop (internal link)',
  hreflang_broken: 'Hreflang alternate broken',
  hreflang_no_return: 'Hreflang missing return link',
  hreflang_missing_self: 'Hreflang missing self-reference',
  hreflang_missing_x_default: 'Hreflang missing x-default',
  hreflang_invalid_code: 'Hreflang invalid code',
  canonical_external_unverified: 'Canonical (external, not verified)',
  hreflang_external_unverified: 'Hreflang (external, not verified)',
}
const TECH_TYPES = new Set(Object.keys(TECH_LABEL))

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-6">
      <h2 className="text-[15px] font-heading font-semibold text-navy dark:text-white mb-1">Technical SEO validation</h2>
      {children}
    </section>
  )
}

export function TechnicalSeoSection({ run, analyzed }: { run: BrokenLinksRun | null; analyzed: boolean }) {
  if (!run) {
    return (
      <Card>
        <p className="text-[13px] font-body text-navy/50 dark:text-white/50">
          Technical SEO not yet analyzed — the live scan runs shortly after the audit completes.
        </p>
      </Card>
    )
  }
  if (!analyzed) {
    return (
      <Card>
        <p className="text-[13px] font-body text-navy/50 dark:text-white/50">
          This audit predates technical SEO validation — re-run the audit to populate it.
        </p>
      </Card>
    )
  }
  const runScope = run.findings.filter((f) => f.scope === 'run' && f.count > 0 && TECH_TYPES.has(f.type))
  if (runScope.length === 0) {
    return (
      <Card>
        <p className="text-[13px] font-body text-green-700 dark:text-green-400">
          No canonical, redirect, or hreflang issues found among the audited pages.
        </p>
      </Card>
    )
  }
  const pageByType = new Map<string, string[]>()
  for (const f of run.findings) {
    if (f.scope !== 'page' || !f.url || !TECH_TYPES.has(f.type)) continue
    const list = pageByType.get(f.type) ?? []
    list.push(f.url)
    pageByType.set(f.type, list)
  }
  return (
    <Card>
      <div className="space-y-4">
        {runScope.map((f) => {
          const pages = pageByType.get(f.type) ?? []
          return (
            <div key={f.type}>
              <p className="text-[13px] font-body font-semibold text-navy dark:text-white">
                {TECH_LABEL[f.type] ?? f.type}: {f.count}
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
