import { gradeForScore, type Grade } from './SectionCard'

const TILE_GRADE: Record<Grade, string> = {
  good: 'text-green-700 dark:text-green-400',
  warn: 'text-amber-600 dark:text-amber-400',
  bad: 'text-red-600 dark:text-red-400',
  none: 'text-navy/40 dark:text-white/40',
}

function Tile(props: { label: string; value: string; grade: Grade }) {
  return (
    <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-5 text-center">
      <div className={`text-3xl font-heading font-bold ${TILE_GRADE[props.grade]}`}>{props.value}</div>
      <div className="mt-1 text-[12px] font-body text-navy/50 dark:text-white/50">{props.label}</div>
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
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 print:grid-cols-4">
      <Tile label="Accessibility score" value={fmt(props.accessibilityScore)} grade={gradeForScore(props.accessibilityScore)} />
      <Tile label="SEO score" value={fmt(props.seoScore)} grade={gradeForScore(props.seoScore)} />
      <Tile label="Performance (Lighthouse)" value={fmt(props.performanceScore)} grade={gradeForScore(props.performanceScore)} />
      <Tile label="Structured data coverage" value={fmt(props.schemaCoveragePct, '%')} grade={props.schemaCoveragePct === null ? 'none' : props.schemaCoveragePct >= 60 ? 'good' : props.schemaCoveragePct >= 30 ? 'warn' : 'bad'} />
    </div>
  )
}
