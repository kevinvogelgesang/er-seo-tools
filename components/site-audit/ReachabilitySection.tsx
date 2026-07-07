// components/site-audit/ReachabilitySection.tsx
//
// roadmap 3b: read-time internal-link reachability. Reads the SAME live-scan
// CrawlRun as DiscoveryCoverageSection, from reachabilityJson. Measurement, NOT
// a finding — never feeds priority scoring.
import React from 'react'

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-6">
      {children}
    </section>
  )
}

interface ReachData {
  v: number
  nodeCount: number; indexableNodeCount: number; edgeCount: number
  homepageResolved: boolean
  orphanCount: number; orphanSample: string[]
  unreachableCount: number; unreachableSample: string[]
  depthHistogram: Record<string, number>
  maxDepth: number | null
  deepSample: Array<{ url: string; depth: number }>
}

function SampleList({ label, urls }: { label: string; urls: string[] }) {
  if (urls.length === 0) return null
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-[13px] font-body text-navy/60 dark:text-white/60">
        {label} ({urls.length})
      </summary>
      <ul className="mt-1 space-y-1">
        {urls.map((u) => (
          <li key={u} className="text-[12px] font-mono text-navy/70 dark:text-white/70 break-all">{u}</li>
        ))}
      </ul>
    </details>
  )
}

export function ReachabilitySection({
  run,
}: {
  run: { reachabilityJson: string | null } | null
}) {
  if (!run?.reachabilityJson) return null
  let data: ReachData
  try { data = JSON.parse(run.reachabilityJson) } catch { return null }

  return (
    <Card>
      <h2 className="text-[15px] font-heading font-semibold text-navy dark:text-white">
        Internal reachability
      </h2>
      <p className="mt-1 text-[13px] font-body text-navy/70 dark:text-white/70">
        {data.homepageResolved ? (
          <>
            <span className="font-semibold text-navy dark:text-white">{data.orphanCount}</span> orphaned{' '}
            {data.orphanCount === 1 ? 'page' : 'pages'} (no internal links in),{' '}
            <span className="font-semibold text-navy dark:text-white">{data.unreachableCount}</span> unreachable
            from the homepage
            {data.maxDepth != null && <> · deepest page is {data.maxDepth} click{data.maxDepth === 1 ? '' : 's'} from home</>}.
          </>
        ) : (
          <>Reachability measured over {data.indexableNodeCount} indexable pages; homepage not found, so
          clicks-from-home could not be computed.</>
        )}
      </p>
      <p className="mt-1 text-[12px] font-body text-navy/40 dark:text-white/40">
        Measurement only — not part of the score.
      </p>
      <SampleList label="Orphaned pages" urls={data.orphanSample ?? []} />
      <SampleList label="Unreachable pages" urls={data.unreachableSample ?? []} />
      {(data.deepSample ?? []).length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[13px] font-body text-navy/60 dark:text-white/60">
            Deep pages ({(data.deepSample ?? []).length})
          </summary>
          <ul className="mt-1 space-y-1">
            {(data.deepSample ?? []).map((d) => (
              <li key={d.url} className="text-[12px] font-mono text-navy/70 dark:text-white/70 break-all">
                {d.url} <span className="text-navy/40 dark:text-white/40">({d.depth} clicks)</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  )
}
