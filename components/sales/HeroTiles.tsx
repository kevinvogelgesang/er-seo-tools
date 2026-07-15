import { gradeForScore, type Grade } from './SectionCard'
import { UrgencyBar } from './UrgencyBar'

const TILE_GRADE: Record<Grade, string> = {
  good: 'text-green-700 dark:text-green-400',
  warn: 'text-amber-600 dark:text-amber-400',
  bad: 'text-red-600 dark:text-red-400',
  none: 'text-navy/40 dark:text-white/40',
}
const BAR_GRADE: Record<Grade, string> = {
  good: 'bg-green-600 dark:bg-green-500',
  warn: 'bg-amber-500 dark:bg-amber-400',
  bad: 'bg-red-600 dark:bg-red-500',
  none: 'bg-gray-300 dark:bg-white/20',
}

function Tile(props: { label: string; value: string; grade: Grade; pct: number | null }) {
  return (
    <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-md p-5 sm:p-6 text-center">
      <div className={`text-4xl sm:text-5xl font-heading font-extrabold tracking-tight tabular-nums ${TILE_GRADE[props.grade]}`}>{props.value}</div>
      <div className="mt-2 text-[12px] sm:text-[13px] font-body font-medium text-navy/60 dark:text-white/60">{props.label}</div>
      {props.pct !== null && (
        <div className="mt-4">
          <UrgencyBar value={props.pct} max={100} colorClass={BAR_GRADE[props.grade]} ariaLabel={`${props.label}: ${props.pct} out of 100`} />
        </div>
      )}
    </div>
  )
}

export function HeroTiles(props: {
  accessibilityScore: number | null
  seoScore: number | null
  performanceScore: number | null
  schemaCoveragePct: number | null
}) {
  const fmt = (v: number | null, suffix = '') => (v === null ? '—' : `${v}${suffix}`)
  // Unified urgency bands (Kevin, pass 2): coverage uses the same ≥95/≥80/<80
  // thresholds as the scores so the report reads consistently.
  const schemaGrade: Grade = gradeForScore(props.schemaCoveragePct)
  return (
    <div className="grid grid-cols-2 gap-5 sm:grid-cols-4 print:grid-cols-4">
      <Tile label="Accessibility score" value={fmt(props.accessibilityScore)} grade={gradeForScore(props.accessibilityScore)} pct={props.accessibilityScore} />
      <Tile label="SEO score" value={fmt(props.seoScore)} grade={gradeForScore(props.seoScore)} pct={props.seoScore} />
      <Tile label="Performance (Lighthouse)" value={fmt(props.performanceScore)} grade={gradeForScore(props.performanceScore)} pct={props.performanceScore} />
      <Tile label="Structured data coverage" value={fmt(props.schemaCoveragePct, '%')} grade={schemaGrade} pct={props.schemaCoveragePct} />
    </div>
  )
}
