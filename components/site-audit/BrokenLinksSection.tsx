// components/site-audit/BrokenLinksSection.tsx
//
// C6: renders the out-of-band broken-link verifier's results for a site audit.
// Reads the live-scan CrawlRun's findings (run-scope counts + per-source-page
// lists). Three states: not-yet-verified (run null), verified-clean (run, zero
// broken findings), and findings present. Pure presentational — the page loads
// the run.

import {
  BROKEN_INTERNAL_FINDING_TYPE_SET as BROKEN_TYPES,
  BROKEN_EXTERNAL_FINDING_TYPE as EXTERNAL_TYPE,
  BROKEN_FINDING_LABELS as TYPE_LABEL,
} from '@/lib/findings/finding-type-sets'
import { Explainer, ExplainerSummary } from '@/components/ui/Explainer'

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
      <Explainer label="What does this measure?" className="mb-3">
        <ExplainerSummary>
          After the audit completes, every same-domain link and image collected from the rendered
          pages is re-requested to confirm it still resolves (a lightweight request first, then a
          full one to avoid false positives). External links get a lighter probe and are reported
          as amber warnings, since many sites block automated requests. Targets that time out or
          refuse the check are excluded from the broken counts rather than guessed at.
        </ExplainerSummary>
      </Explainer>
      {children}
    </section>
  )
}

function pagesForTypes(run: BrokenLinksRun, allow: (t: string) => boolean) {
  const byType = new Map<string, { url: string; targets: string[] }[]>()
  for (const f of run.findings) {
    if (f.scope !== 'page' || !f.url || !allow(f.type)) continue
    const targets = (parseDetail(f.detail).brokenTargetUrls as string[]) ?? []
    const list = byType.get(f.type) ?? []
    list.push({ url: f.url, targets })
    byType.set(f.type, list)
  }
  return byType
}

// Per-tier partial (Codex plan-#6): derived from THIS finding's detail, not global run.status.
function CoverageLine({ detail }: { detail: string | null }) {
  const conf = parseDetail(detail)
  const checked = typeof conf.checked === 'number' ? conf.checked : null
  const unconfirmed = typeof conf.unconfirmed === 'number' ? conf.unconfirmed : 0
  const partial = conf.capped === true || conf.harvestTruncated === true
  if (checked === null && unconfirmed === 0 && !partial) return null
  return (
    <p className="text-[12px] font-body text-navy/45 dark:text-white/45 mb-3">
      {checked !== null && <>Checked {checked} unique target{checked === 1 ? '' : 's'}. </>}
      {unconfirmed > 0 && <>{unconfirmed} could not be confirmed (timeout/blocked) and are excluded. </>}
      {partial && <>Results are partial (capped or budget/harvest-truncated).</>}
    </p>
  )
}

function BrokenGroup({ label, color, findingCount, pages }: {
  label: string; color: string; findingCount: number; pages: { url: string; targets: string[] }[]
}) {
  return (
    <div>
      <p className={`text-[13px] font-body font-semibold ${color}`}>{label}: {findingCount}</p>
      {pages.length > 0 && (
        <ul className="mt-1 space-y-1">
          {pages.slice(0, 25).map((p, i) => (
            <li key={i} className="text-[12px] font-body text-navy/60 dark:text-white/60">
              <span className="break-all">{p.url}</span>
              {p.targets.length > 0 && (
                <span className="text-navy/40 dark:text-white/40">
                  {' '}→ {p.targets.slice(0, 5).join(', ')}
                  {p.targets.length > 5 ? ` (+${p.targets.length - 5} more)` : ''}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
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

  // We only ever emit run findings with count > 0 (no zero-count coverage findings), so
  // presence == "there are broken items of this type".
  const internalRunScope = run.findings.filter((f) => f.scope === 'run' && f.count > 0 && BROKEN_TYPES.has(f.type))
  const externalRun = run.findings.find((f) => f.scope === 'run' && f.count > 0 && f.type === EXTERNAL_TYPE)
  const hasInternal = internalRunScope.length > 0
  const hasExternal = !!externalRun

  if (!hasInternal && !hasExternal) {
    // Clean. The only coverage signal available here is the global run.status (there is no
    // finding to read a per-tier detail from), so surface partial from it.
    return (
      <Card>
        <p className="text-[13px] font-body text-green-700 dark:text-green-400">
          Verified — no broken links or images found.
          {run.status === 'partial' && (
            <span className="text-navy/45 dark:text-white/45">{' '}Some links could not be fully checked — results are partial.</span>
          )}
        </p>
      </Card>
    )
  }

  const internalPages = pagesForTypes(run, (t) => BROKEN_TYPES.has(t))
  const externalPages = pagesForTypes(run, (t) => t === EXTERNAL_TYPE)

  return (
    <Card>
      {hasInternal && (
        <div className="mb-4">
          <CoverageLine detail={internalRunScope[0].detail} />
          <div className="space-y-4">
            {internalRunScope.map((f) => (
              <BrokenGroup key={f.type} label={TYPE_LABEL[f.type] ?? f.type} color="text-red-600 dark:text-red-400"
                findingCount={f.count} pages={internalPages.get(f.type) ?? []} />
            ))}
          </div>
        </div>
      )}
      {hasExternal && (
        <div>
          <CoverageLine detail={externalRun!.detail} />
          <BrokenGroup label={TYPE_LABEL[EXTERNAL_TYPE]} color="text-amber-600 dark:text-amber-400"
            findingCount={externalRun!.count} pages={externalPages.get(EXTERNAL_TYPE) ?? []} />
        </div>
      )}
    </Card>
  )
}
