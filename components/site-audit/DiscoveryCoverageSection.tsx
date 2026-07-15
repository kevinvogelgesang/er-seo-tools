// components/site-audit/DiscoveryCoverageSection.tsx
//
// C6 hybrid-discovery Increment 1: read-time sitemap miss-rate. Reads the SAME
// live-scan CrawlRun as BrokenLinksSection/OnPageSeoSection, from the
// discoveryCoverageJson column. Measurement, NOT a finding — never feeds
// priority scoring. Copy says "URLs" not "pages" (internal-link may be assets).
import React from 'react'
import { Explainer, ExplainerSummary, ExplainerTags, ExplainerNote } from '@/components/ui/Explainer'

// Local Card wrapper — matches BrokenLinksSection/OnPageSeoSection exactly
// (there is no shared components/ui/Card in this repo). Owns the heading +
// methodology Explainer so every state renders both.
function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-6">
      <div className="flex items-center gap-1">
        <h2 className="text-[15px] font-heading font-semibold text-navy dark:text-white">
          Discovery coverage
        </h2>
        <Explainer label="What is discovery coverage measuring?" title="Discovery coverage">
          <ExplainerSummary>
            Compares two lists the audit already produced: the URLs the sitemap advertised, and the
            same-domain URLs actually linked from the audited pages. Anything linked internally but
            absent from the sitemap is &ldquo;off-sitemap&rdquo; — content search engines can only
            find by crawling.
          </ExplainerSummary>
          <ExplainerTags tags={['Sitemap URLs', 'Internal links', 'Off-sitemap']} />
          <ExplainerNote>
            Computed entirely from data already collected — nothing extra is fetched. Reported as
            &ldquo;URLs&rdquo; not &ldquo;pages&rdquo;, since an internal link may point at an asset.
          </ExplainerNote>
        </Explainer>
      </div>
      {children}
    </section>
  )
}

interface CoverageData {
  mode: 'sitemap' | 'shallow-crawl' | 'pre-discovered' | 'hybrid' | null
  capped: boolean
  applicable: boolean
  discoveredCount: number
  linkedInternalCount: number
  offBaselineCount: number
  missRate: number | null
  sample: Array<{ targetUrl: string; sourcePageUrls: string[] }>
  sitemapMissRate?: number | null
  sitemapApplicable?: boolean
  residualMissRate?: number | null
  residualApplicable?: boolean
  hybridCapped?: boolean
}

export function DiscoveryCoverageSection({
  run,
}: {
  run: { discoveryCoverageJson: string | null } | null
}) {
  if (!run?.discoveryCoverageJson) return null
  let data: CoverageData
  try {
    data = JSON.parse(run.discoveryCoverageJson)
  } catch {
    return null
  }

  if (data.mode === 'hybrid') {
    const sPct = data.sitemapMissRate != null ? Math.round(data.sitemapMissRate * 100) : null
    const rPct = data.residualMissRate != null ? Math.round(data.residualMissRate * 100) : null
    return (
      <Card>
        <p className="mt-1 text-[13px] font-body text-navy/70 dark:text-white/70">
          {sPct != null ? (
            <>The sitemap omitted{' '}
              <span className="font-semibold text-navy dark:text-white">{sPct}% of internally-reachable URLs</span>.{' '}</>
          ) : (
            <>The sitemap miss-rate was not measurable for this run.{' '}</>
          )}
          {rPct != null
            ? <>Hybrid discovery crawled linked pages; {rPct}% remained undiscovered.</>
            : <>Hybrid discovery expanded the crawl beyond the sitemap.</>}
        </p>
        {data.sample.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[13px] font-body text-navy/60 dark:text-white/60">
              Show {data.sample.length} URL{data.sample.length === 1 ? '' : 's'} still off-baseline
            </summary>
            <ul className="mt-1 space-y-1">
              {data.sample.map((s) => (
                <li key={s.targetUrl} className="text-[12px] font-mono text-navy/70 dark:text-white/70 break-all">
                  {s.targetUrl}
                  {s.sourcePageUrls.length > 0 && (
                    <span className="text-navy/40 dark:text-white/40">
                      {' '}← {s.sourcePageUrls[0]}
                      {s.sourcePageUrls.length > 1 ? ` (+${s.sourcePageUrls.length - 1})` : ''}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>
    )
  }

  if (!data.applicable) {
    return (
      <Card>
        <p className="mt-1 text-[13px] font-body text-navy/50 dark:text-white/50">
          Discovery coverage not measured (no sitemap was used, or the sitemap exceeded the
          1,000-URL cap).
        </p>
      </Card>
    )
  }

  if (data.offBaselineCount === 0) {
    return (
      <Card>
        <p className="mt-1 text-[13px] font-body text-navy/70 dark:text-white/70">
          No off-sitemap URLs found — every internally-linked URL was in the sitemap
          ({data.discoveredCount} listed).
        </p>
      </Card>
    )
  }

  const pct = data.missRate != null ? Math.round(data.missRate * 100) : 0
  return (
    <Card>
      <p className="mt-1 text-[13px] font-body text-navy/70 dark:text-white/70">
        Sitemap listed {data.discoveredCount} same-domain URLs.{' '}
        <span className="font-semibold text-navy dark:text-white">
          {data.offBaselineCount} additional same-domain URLs
        </span>{' '}
        were linked from audited pages but absent from the sitemap ({pct}% off-sitemap).
      </p>
      {data.sample.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[13px] font-body text-navy/60 dark:text-white/60">
            Show {data.sample.length} example URL{data.sample.length === 1 ? '' : 's'}
          </summary>
          <ul className="mt-1 space-y-1">
            {data.sample.map((s) => (
              <li key={s.targetUrl} className="text-[12px] font-mono text-navy/70 dark:text-white/70 break-all">
                {s.targetUrl}
                {s.sourcePageUrls.length > 0 && (
                  <span className="text-navy/40 dark:text-white/40">
                    {' '}← {s.sourcePageUrls[0]}
                    {s.sourcePageUrls.length > 1 ? ` (+${s.sourcePageUrls.length - 1})` : ''}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  )
}
