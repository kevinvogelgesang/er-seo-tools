'use client'

import type { SortKey, ImpactFilter, FilterCounts } from './useSiteAuditPages'

type ViewMode = 'table' | 'sitemap' | 'by-violation'

interface Props {
  sortKey: SortKey
  onSortChange: (key: SortKey) => void
  filterImpact: ImpactFilter
  onFilterImpactChange: (f: ImpactFilter) => void
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  counts: FilterCounts
}

const IMPACT_FILTERS: { id: ImpactFilter; label: string; countKey: keyof FilterCounts }[] = [
  { id: 'all', label: 'All', countKey: 'all' },
  { id: 'critical', label: 'Critical', countKey: 'critical' },
  { id: 'serious', label: 'Serious', countKey: 'serious' },
  { id: 'moderate', label: 'Moderate', countKey: 'moderate' },
  { id: 'minor', label: 'Minor', countKey: 'minor' },
]

export default function SiteAuditToolbar({
  sortKey, onSortChange, filterImpact, onFilterImpactChange, viewMode, onViewModeChange, counts,
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
        {counts.error > 0 && (
          <button
            type="button"
            onClick={() => onFilterImpactChange('all')}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-body font-semibold rounded-md bg-gray-100 dark:bg-navy-light text-red-500 dark:text-red-400"
            title="Error pages are included in the 'All' filter"
          >
            Errors
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-red-100 dark:bg-red-500/15 text-red-500 dark:text-red-400">
              {counts.error}
            </span>
          </button>
        )}
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

      {/* View toggle */}
      <div className="flex items-center bg-gray-100 dark:bg-navy-light rounded-lg p-0.5 gap-0.5">
        <button
          type="button"
          onClick={() => onViewModeChange('table')}
          title="Table view"
          className={`p-1.5 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-orange/40 ${
            viewMode === 'table'
              ? 'bg-white dark:bg-navy-card text-navy dark:text-white shadow-sm'
              : 'text-navy/50 dark:text-white/50 hover:text-navy dark:hover:text-white'
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => onViewModeChange('sitemap')}
          title="Sitemap view"
          className={`p-1.5 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-orange/40 ${
            viewMode === 'sitemap'
              ? 'bg-white dark:bg-navy-card text-navy dark:text-white shadow-sm'
              : 'text-navy/50 dark:text-white/50 hover:text-navy dark:hover:text-white'
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h2m4 0h10M4 9h2m4 0h10M4 13h2m4 0h6M4 17h2m4 0h6" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => onViewModeChange('by-violation')}
          title="By violation"
          className={`p-1.5 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-orange/40 ${
            viewMode === 'by-violation'
              ? 'bg-white dark:bg-navy-card text-navy dark:text-white shadow-sm'
              : 'text-navy/50 dark:text-white/50 hover:text-navy dark:hover:text-white'
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        </button>
      </div>
    </div>
  )
}
