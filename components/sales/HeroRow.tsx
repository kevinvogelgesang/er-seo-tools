// C14 redesign hero row: homepage screenshot in faux-browser chrome (left)
// + the animated overall-score gauge (right). Older scans without a captured
// hero hide the slot entirely — the gauge takes the full width (Kevin
// decision: no placeholder card). Server component; the gauge is a client leaf.
// Pass 2 (Kevin): larger, no "how this score is calculated" under the gauge.
import { ScoreGauge } from './ScoreGauge'

export function HeroRow(props: {
  token: string
  auditId: string
  domain: string
  overallScore: number | null
  heroScreenshot: boolean
}) {
  return (
    <div className={`grid gap-6 ${props.heroScreenshot ? 'lg:grid-cols-[3fr_2fr]' : ''}`}>
      {props.heroScreenshot && (
        <div className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 dark:border-navy-border bg-white dark:bg-navy-card shadow-md">
          {/* faux browser chrome */}
          <div className="flex items-center gap-2 border-b border-gray-200 dark:border-navy-border bg-gray-50 dark:bg-white/5 px-4 py-2.5">
            <span className="flex gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
              <span className="h-2.5 w-2.5 rounded-full bg-green-400" />
            </span>
            <span className="ml-2 flex-1 truncate rounded-md bg-white dark:bg-white/10 px-3 py-1 text-[12px] font-body text-navy/60 dark:text-white/60">
              {props.domain}
            </span>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/sales/${props.token}/hero/${props.auditId}`}
            alt={`Homepage of ${props.domain}`}
            className="h-full min-h-[340px] w-full object-cover object-top"
          />
        </div>
      )}
      <div className="flex flex-col items-center justify-center rounded-2xl border border-gray-200 dark:border-navy-border bg-white dark:bg-navy-card p-6 sm:p-8 shadow-md">
        <ScoreGauge score={props.overallScore} />
      </div>
    </div>
  )
}
