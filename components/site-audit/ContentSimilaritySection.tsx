// components/site-audit/ContentSimilaritySection.tsx
// C6 Phase 5: read-time content similarity. Reads the SAME live-scan CrawlRun as the
// sibling measurement sections, from contentSimilarityJson. Measurement, NOT a finding.
import { Explainer, ExplainerSummary, ExplainerTags, ExplainerNote } from '@/components/ui/Explainer'

interface ExactGroup { urls: string[]; count: number }
interface NearGroup { urls: string[]; similarity: number; exactSubgroups?: string[][] }
interface SimData {
  pagesEligible?: number; boilerplateShinglesDropped?: number; truncatedPages?: number; capped?: boolean
  exactDuplicateGroups?: ExactGroup[]; nearDuplicateGroups?: NearGroup[]
}

function GroupList({ groups, tone, label }: { groups: (NearGroup | ExactGroup)[]; tone: string; label: string }) {
  return (
    <div className="mt-3">
      <h4 className={`text-sm font-medium ${tone}`}>{label} ({groups.length})</h4>
      <ul className="mt-1 space-y-2">
        {groups.map((g, i) => (
          <li key={i} className="rounded border border-gray-200 dark:border-navy-border p-2 text-sm">
            {'similarity' in g && (
              <span className="mr-2 text-amber-600 dark:text-amber-400">{Math.round((g as NearGroup).similarity * 100)}% similar</span>
            )}
            <span className="text-gray-700 dark:text-white/70">
              {g.urls.slice(0, 8).join('  ·  ')}{g.urls.length > 8 ? `  · and ${g.urls.length - 8} more` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ContentSimilaritySection({ run }: { run: { contentSimilarityJson: string | null } | null }) {
  if (!run?.contentSimilarityJson) return null
  let d: SimData
  try { d = JSON.parse(run.contentSimilarityJson) } catch { return null }
  const exact = d.exactDuplicateGroups ?? []
  const near = d.nearDuplicateGroups ?? []
  const clean = exact.length === 0 && near.length === 0

  return (
    <section className="mt-6 rounded-lg bg-white dark:bg-navy-card p-4 border border-gray-200 dark:border-navy-border">
      <div className="flex items-center gap-1">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">Content similarity</h3>
        <Explainer label="How is content similarity measured?" title="Content similarity">
          <ExplainerSummary>
            Flags pages whose main text is identical after normalization, or nearly identical — at
            least 90% overlapping five-word phrases, with common boilerplate like navigation and
            footers filtered out first.
          </ExplainerSummary>
          <ExplainerTags tags={['Exact duplicates', 'Near-duplicates (90%)', 'Boilerplate filtered']} />
          <ExplainerNote>
            A lexical comparison of wording — pages covering the same topic in different words are the
            Topic overlap section&apos;s job. Measurement only: it never changes any score.
          </ExplainerNote>
        </Explainer>
      </div>
      {clean ? (
        <p className="mt-2 text-sm text-gray-600 dark:text-white/60">
          No duplicate or near-duplicate content detected across {d.pagesEligible ?? 0} analyzed pages.
        </p>
      ) : (
        <>
          {exact.length > 0 && <GroupList groups={exact} tone="text-red-600 dark:text-red-400" label="Exact duplicates" />}
          {near.length > 0 && <GroupList groups={near} tone="text-amber-600 dark:text-amber-400" label="Near duplicates" />}
        </>
      )}
      <p className="mt-3 text-xs text-gray-400 dark:text-white/40">
        {d.pagesEligible ?? 0} pages analyzed · {d.boilerplateShinglesDropped ?? 0} boilerplate fragments excluded
        {d.truncatedPages ? ` · ${d.truncatedPages} truncated` : ''}{d.capped ? ' · results capped' : ''}
      </p>
    </section>
  )
}
