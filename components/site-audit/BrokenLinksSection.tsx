// components/site-audit/BrokenLinksSection.tsx
//
// C6: renders the out-of-band broken-link verifier's results for a site audit.
// Reads the live-scan CrawlRun's findings (run-scope counts + per-source-page
// lists). Three states: not-yet-verified (run null), verified-clean (run, zero
// broken findings), and findings present. Pure presentational — the page loads
// the run.

interface FindingLite {
  scope: string
  type: string
  count: number
  url: string | null
  detail: string | null
}

export interface BrokenLinksRun {
  status: string
  findings: FindingLite[]
}

const BROKEN_TYPES = new Set(['broken_internal_links', 'broken_images'])

const TYPE_LABEL: Record<string, string> = {
  broken_internal_links: 'Broken internal links',
  broken_images: 'Broken images',
}

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
      <h2 className="text-[15px] font-heading font-semibold text-navy dark:text-white mb-1">
        Broken links &amp; images
      </h2>
      {children}
    </section>
  )
}

export function BrokenLinksSection({ run }: { run: BrokenLinksRun | null }) {
  if (!run) {
    return (
      <Card>
        <p className="text-[13px] font-body text-navy/50 dark:text-white/50">
          Broken links not yet verified — the out-of-band check runs shortly after the audit completes.
        </p>
      </Card>
    )
  }

  const runScope = run.findings.filter((f) => f.scope === 'run' && f.count > 0 && BROKEN_TYPES.has(f.type))
  if (runScope.length === 0) {
    return (
      <Card>
        <p className="text-[13px] font-body text-green-700 dark:text-green-400">
          Verified — no broken links or images found.
        </p>
      </Card>
    )
  }

  // Confidence block lives on every run-scope finding's detail (same values).
  const conf = parseDetail(runScope[0].detail)
  const checked = typeof conf.checked === 'number' ? conf.checked : null
  const unconfirmed = typeof conf.unconfirmed === 'number' ? conf.unconfirmed : 0
  const partial = run.status === 'partial'

  // Group page-scope findings by type -> [{ sourceUrl, brokenTargets }].
  const pageByType = new Map<string, { url: string; targets: string[] }[]>()
  for (const f of run.findings) {
    if (f.scope !== 'page' || !f.url || !BROKEN_TYPES.has(f.type)) continue
    const targets = (parseDetail(f.detail).brokenTargetUrls as string[]) ?? []
    const list = pageByType.get(f.type) ?? []
    list.push({ url: f.url, targets })
    pageByType.set(f.type, list)
  }

  return (
    <Card>
      {(partial || unconfirmed > 0 || checked !== null) && (
        <p className="text-[12px] font-body text-navy/45 dark:text-white/45 mb-3">
          {checked !== null && <>Checked {checked} unique target{checked === 1 ? '' : 's'}. </>}
          {unconfirmed > 0 && <>{unconfirmed} could not be confirmed (timeout/blocked) and are excluded. </>}
          {partial && <>Results are partial (capped or harvest-truncated).</>}
        </p>
      )}
      <div className="space-y-4">
        {runScope.map((f) => {
          const pages = pageByType.get(f.type) ?? []
          return (
            <div key={f.type}>
              <p className="text-[13px] font-body font-semibold text-red-600 dark:text-red-400">
                {TYPE_LABEL[f.type] ?? f.type}: {f.count}
              </p>
              {pages.length > 0 && (
                <ul className="mt-1 space-y-1">
                  {pages.slice(0, 25).map((p, i) => (
                    <li key={i} className="text-[12px] font-body text-navy/60 dark:text-white/60">
                      <span className="break-all">{p.url}</span>
                      {p.targets.length > 0 && (
                        <span className="text-navy/40 dark:text-white/40">
                          {' '}
                          → {p.targets.slice(0, 5).join(', ')}
                          {p.targets.length > 5 ? ` (+${p.targets.length - 5} more)` : ''}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}
