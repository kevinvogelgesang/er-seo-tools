'use client'

import type { SortKey, ImpactFilter, FilterCounts } from './useSiteAuditPages'

type ViewMode = 'table' | 'by-violation'

interface Props {
  sortKey: SortKey
  onSortChange: (key: SortKey) => void
  filterImpact: ImpactFilter
  onFilterImpactChange: (f: ImpactFilter) => void
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  counts: FilterCounts
  /** Count of unique violations for the Violations tab badge. `undefined`
   *  while the grouped fetch hasn't completed yet — renders as "—". */
  violationsCount?: number
  /** Hide the table/by-violation segmented control (public share view —
   *  the grouped view fetches cookie-gated APIs). */
  hideViewToggle?: boolean
}

const IMPACT_FILTERS: { id: ImpactFilter; label: string; countKey: keyof FilterCounts }[] = [
  { id: 'all', label: 'All', countKey: 'all' },
  { id: 'critical', label: 'Critical', countKey: 'critical' },
  { id: 'serious', label: 'Serious', countKey: 'serious' },
  { id: 'moderate', label: 'Moderate', countKey: 'moderate' },
  { id: 'minor', label: 'Minor', countKey: 'minor' },
]

export default function SiteAuditToolbar({
  sortKey, onSortChange, filterImpact, onFilterImpactChange, viewMode, onViewModeChange, counts, violationsCount,
  hideViewToggle = false,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b border-gray-100 dark:border-navy-border">
      {/* Impact filter pills */}
      <div className="flex gap-1 flex-wrap">
        {IMPACT_FILTERS.map(({ id, label, countKey }) => {
          const count = counts[countKey]
          const active = filterImpact === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => onFilterImpactChange(id)}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-body font-semibold rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-orange/40 ${
                active
                  ? 'bg-orange/15 text-orange'
                  : 'bg-gray-100 dark:bg-navy-light text-navy/50 dark:text-white/50 hover:text-navy/80 dark:hover:text-white/80'
              }`}
            >
              {label}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                active
                  ? 'bg-orange/15 text-orange'
                  : 'bg-gray-200/60 dark:bg-navy-deep text-navy/40 dark:text-white/40'
              }`}>
                {count}
              </span>
            </button>
          )
        })}
        {counts.error > 0 && (() => {
          const active = filterImpact === 'error'
          return (
            <button
              type="button"
              onClick={() => onFilterImpactChange(active ? 'all' : 'error')}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-body font-semibold rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-orange/40 ${
                active
                  ? 'bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400'
                  : 'bg-gray-100 dark:bg-navy-light text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10'
              }`}
            >
              Errors
              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-red-100 dark:bg-red-500/15 text-red-500 dark:text-red-400">
                {counts.error}
              </span>
            </button>
          )
        })()}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Sort dropdown */}
      <select
        value={sortKey}
        onChange={(e) => onSortChange(e.target.value as SortKey)}
        className="py-1.5 pl-2.5 pr-7 text-[12px] font-body border border-gray-200 dark:border-navy-border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange/40 bg-white dark:bg-navy-card text-navy/70 dark:text-white/70"
      >
        <option value="total">Sort: Total Violations</option>
        <option value="critical">Sort: Critical Count</option>
        <option value="serious">Sort: Serious Count</option>
        <option value="url">Sort: URL (A-Z)</option>
      </select>

      {/* View toggle: Pages vs Violations */}
      {!hideViewToggle && (
      <div className="flex items-center bg-gray-100 dark:bg-navy-light rounded-lg p-0.5 gap-0.5">
        <button
          type="button"
          onClick={() => onViewModeChange('table')}
          className={`flex items-center gap-1.5 px-3 py-1 text-[12px] font-body font-semibold rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-orange/40 ${
            viewMode === 'table'
              ? 'bg-white dark:bg-navy-card text-navy dark:text-white shadow-sm'
              : 'text-navy/50 dark:text-white/50 hover:text-navy dark:hover:text-white'
          }`}
        >
          Pages
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
            viewMode === 'table'
              ? 'bg-gray-100 dark:bg-navy-deep text-navy/60 dark:text-white/60'
              : 'bg-gray-200/60 dark:bg-navy-deep text-navy/40 dark:text-white/40'
          }`}>
            {counts.all}
          </span>
        </button>
        <button
          type="button"
          onClick={() => onViewModeChange('by-violation')}
          className={`flex items-center gap-1.5 px-3 py-1 text-[12px] font-body font-semibold rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-orange/40 ${
            viewMode === 'by-violation'
              ? 'bg-white dark:bg-navy-card text-navy dark:text-white shadow-sm'
              : 'text-navy/50 dark:text-white/50 hover:text-navy dark:hover:text-white'
          }`}
        >
          Violations
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
            viewMode === 'by-violation'
              ? 'bg-gray-100 dark:bg-navy-deep text-navy/60 dark:text-white/60'
              : 'bg-gray-200/60 dark:bg-navy-deep text-navy/40 dark:text-white/40'
          }`}>
            {violationsCount ?? '—'}
          </span>
        </button>
      </div>
      )}
    </div>
  )
}
