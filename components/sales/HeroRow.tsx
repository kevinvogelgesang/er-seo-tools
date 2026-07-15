// C14 redesign hero row: homepage screenshot in faux-browser chrome (left)
// + the animated overall-score gauge (right). Older scans without a captured
// hero hide the slot entirely — the gauge takes the full width (Kevin
// decision: no placeholder card). Server component; the gauge and the
// Explainer are client leaves.
import { Explainer, ExplainerNote, ExplainerSummary } from '@/components/ui/Explainer'
import { SCORE_METHOD } from '@/lib/sales/copy'
import { ScoreGauge } from './ScoreGauge'

export function HeroRow(props: {
  token: string
  auditId: string
  domain: string
  overallScore: number | null
  heroScreenshot: boolean
}) {
  return (
    <div className={`grid gap-6 ${props.heroScreenshot ? 'md:grid-cols-[2fr_3fr]' : ''}`}>
      {props.heroScreenshot && (
        <div className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 dark:border-navy-border bg-white dark:bg-navy-card shadow-sm">
          {/* faux browser chrome */}
          <div className="flex items-center gap-2 border-b border-gray-200 dark:border-navy-border bg-gray-50 dark:bg-white/5 px-4 py-2.5">
            <span className="flex gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
              <span className="h-2.5 w-2.5 rounded-full bg-green-400" />
            </span>
            <span className="ml-2 flex-1 truncate rounded-md bg-white dark:bg-white/10 px-3 py-1 text-[11px] font-body text-navy/60 dark:text-white/60">
              {props.domain}
            </span>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/sales/${props.token}/hero/${props.auditId}`}
            alt={`Homepage of ${props.domain}`}
            className="h-full min-h-[220px] w-full object-cover object-top"
          />
        </div>
      )}
      <div className="flex flex-col items-center justify-center rounded-2xl border border-gray-200 dark:border-navy-border bg-white dark:bg-navy-card p-6 shadow-sm">
        <ScoreGauge score={props.overallScore} />
        <div className="mt-2 w-full max-w-sm">
          <Explainer label="How this score is calculated" variant="plain">
            <ExplainerSummary>{SCORE_METHOD.overall.summary}</ExplainerSummary>
            <ExplainerNote>{SCORE_METHOD.overall.note}</ExplainerNote>
          </Explainer>
        </div>
      </div>
    </div>
  )
}
