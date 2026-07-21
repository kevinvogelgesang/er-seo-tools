// components/site-audit/AnchorTextSection.tsx
//
// anchor-text: renders the 3 anchor findings (empty / non-descriptive /
// single-variation) from the live-scan CrawlRun. Reads the SAME run as
// OnPageSeoSection/BrokenLinksSection. `anchorSummaryJson` is the analyzed
// marker: null ⇒ this run predates anchor analysis (legacy) — never render a
// misleading "clean". Measurement-only; no score. Pure presentational.
import { ANCHOR_FINDING_LABELS, ANCHOR_FINDING_TYPE_SET } from '@/lib/findings/finding-type-sets'
import { Explainer, ExplainerSummary, ExplainerTags, ExplainerNote } from '@/components/ui/Explainer'

interface AnchorFindingLite {
  scope: string
  type: string
  count: number
  severity?: string | null
}
export interface AnchorRun {
  anchorSummaryJson: string | null
  findings: AnchorFindingLite[]
}

const SEVERITY_CLASS: Record<string, string> = {
  critical: 'text-red-700 dark:text-red-400',
  warning: 'text-amber-700 dark:text-amber-400',
  notice: 'text-navy/60 dark:text-white/60',
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-6">
      <div className="flex items-center gap-1 mb-3">
        <h2 className="text-[15px] font-heading font-semibold text-navy dark:text-white">Anchor text</h2>
        <Explainer label="What is anchor-text checking?" title="Anchor text">
          <ExplainerSummary>
            The visible text of internal links tells search engines (and readers) what the linked
            page is about. Empty, generic, or single-variation anchors waste that signal.
          </ExplainerSummary>
          <ExplainerTags tags={['Empty anchors', 'Non-descriptive', 'Single variation']} />
          <ExplainerNote>
            Read from the rendered internal links on each page. Non-descriptive means generic
            phrases like &ldquo;click here&rdquo; or &ldquo;read more&rdquo;. Single-variation flags
            destination pages that are only ever linked with one anchor phrase.
          </ExplainerNote>
        </Explainer>
      </div>
      {children}
    </section>
  )
}

export function AnchorTextSection({ run }: { run: AnchorRun | null }) {
  // null run OR no analyzed marker ⇒ not analyzed (never a misleading "clean").
  if (!run || run.anchorSummaryJson == null) {
    return (
      <Card>
        <p className="text-[13px] font-body text-navy/50 dark:text-white/50">
          Anchor text not analyzed — the live scan runs shortly after the audit completes, and
          audits that predate anchor analysis show nothing here until re-run.
        </p>
      </Card>
    )
  }
  const runScope = run.findings.filter((f) => f.scope === 'run' && f.count > 0 && ANCHOR_FINDING_TYPE_SET.has(f.type))
  if (runScope.length === 0) {
    return (
      <Card>
        <p className="text-[13px] font-body text-green-700 dark:text-green-400">
          No anchor-text issues found among the internal links analyzed.
        </p>
      </Card>
    )
  }
  return (
    <Card>
      <div className="space-y-2">
        {runScope.map((f) => (
          <p key={f.type} className="text-[13px] font-body font-semibold text-navy dark:text-white">
            {ANCHOR_FINDING_LABELS[f.type] ?? f.type}:{' '}
            <span className={SEVERITY_CLASS[f.severity ?? 'notice'] ?? SEVERITY_CLASS.notice}>{f.count}</span>
          </p>
        ))}
      </div>
    </Card>
  )
}
