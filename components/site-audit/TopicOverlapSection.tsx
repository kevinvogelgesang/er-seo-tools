// components/site-audit/TopicOverlapSection.tsx
// C12 Tier-1: read-time semantic topic-overlap networks. Reads the SAME live-scan
// CrawlRun as the sibling measurement sections, from topicOverlapJson. Measurement,
// NOT a finding, NO score effect. Results page only (share view unchanged).
import { Explainer, ExplainerSummary, ExplainerTags, ExplainerNote } from '@/components/ui/Explainer'

interface OverlapCluster {
  urls: string[]
  size: number
  membersTruncated: boolean
  minEdgeSimilarity: number
}
interface OverlapData {
  observedPages?: number
  clusteredCandidates?: number
  clustersCapped?: boolean
  bodyPrefixTruncatedPages?: number
  clusters?: OverlapCluster[]
}

const NOT_ANALYZED = 'Topic overlap was not analyzed for this audit.'

function tierLabel(sim: number): string {
  if (sim >= 0.9) return 'strong'
  if (sim >= 0.83) return 'moderate'
  return 'weak'
}

function OverlapHeader() {
  return (
    <div className="flex items-center gap-1">
      <h3 className="text-base font-semibold text-gray-900 dark:text-white">Topic overlap</h3>
      <Explainer label="How is topic overlap detected?" title="Topic overlap">
        <ExplainerSummary>
          Pages that appear to target the same topic — related pages that may compete for the same
          searches, worth reviewing for consolidation or differentiation.
        </ExplainerSummary>
        <ExplainerSummary>
          Titles, H1s, meta descriptions and body introductions are embedded locally and compared
          for semantic meaning; pages joined by strong pairwise links form an overlap network,
          graded strong / moderate / weak by the weakest direct link.
        </ExplainerSummary>
        <ExplainerTags tags={['Titles', 'H1s', 'Meta descriptions', 'Body intro']} />
        <ExplainerNote>
          Complements Content similarity, which compares exact wording. Measurement only — no score
          impact.
        </ExplainerNote>
      </Explainer>
    </div>
  )
}

function NotAnalyzed() {
  return (
    <section className="mt-6 rounded-lg bg-white dark:bg-navy-card p-4 border border-gray-200 dark:border-navy-border">
      <OverlapHeader />
      <p className="mt-2 text-sm text-gray-600 dark:text-white/60">{NOT_ANALYZED}</p>
    </section>
  )
}

export function TopicOverlapSection({ run }: { run: { topicOverlapJson: string | null } | null }) {
  if (!run?.topicOverlapJson) return <NotAnalyzed />

  let d: OverlapData
  try {
    d = JSON.parse(run.topicOverlapJson)
  } catch {
    return <NotAnalyzed />
  }

  const clusters = d.clusters ?? []

  return (
    <section className="mt-6 rounded-lg bg-white dark:bg-navy-card p-4 border border-gray-200 dark:border-navy-border">
      <OverlapHeader />

      {clusters.length === 0 ? (
        <p className="mt-2 text-sm text-gray-600 dark:text-white/60">
          No topic-overlap networks detected across {d.clusteredCandidates ?? 0} analyzed pages.
        </p>
      ) : (
        <>
          <ul className="mt-3 space-y-2">
            {clusters.map((c, i) => (
              <li key={i} className="rounded border border-gray-200 dark:border-navy-border p-2 text-sm">
                <span className="mr-2 text-amber-600 dark:text-amber-400">
                  {tierLabel(c.minEdgeSimilarity)} overlap ({c.size} pages)
                </span>
                <span className="text-gray-700 dark:text-white/70">
                  {c.urls.map((u, j) => (
                    <span key={j}>
                      {j > 0 ? '  ·  ' : ''}
                      <a href={u} className="underline hover:text-navy dark:hover:text-white">{u}</a>
                    </span>
                  ))}
                  {c.membersTruncated ? `  · and ${c.size - c.urls.length} more` : ''}
                </span>
              </li>
            ))}
          </ul>
          {d.clustersCapped && (
            <p className="mt-1 text-xs text-gray-400 dark:text-white/40">
              Showing the largest {clusters.length} networks; more were detected.
            </p>
          )}
        </>
      )}
    </section>
  )
}
