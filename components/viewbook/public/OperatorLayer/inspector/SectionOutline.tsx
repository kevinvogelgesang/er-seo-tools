'use client'
import { useMemo, useState } from 'react'
import { StatusPill, type Tone } from '@/components/ui/StatusPill'
import { SECTION_TITLES } from '@/components/viewbook/public/section-titles'
import { navigateToAnchor } from '@/components/viewbook/public/viewbook-navigate'
import type { OperatorViewbookData } from '@/lib/viewbook/operator-data'
import { STAGE_LINEUPS, VIEWBOOK_STAGES, type ViewbookStage } from '@/lib/viewbook/stages'
import type { SectionKey } from '@/lib/viewbook/theme'
import { useSelectionContext } from './SelectionContext'

export type OutlineGroup = 'primary' | 'carried' | 'future'
export interface OutlineRow {
  sectionKey: SectionKey
  title: string
  state: 'active' | 'hidden' | 'done' | 'collapsed'
  acknowledged: boolean
  group: OutlineGroup
}
export interface SectionOutlineProps {
  operatorData: OperatorViewbookData
  stage: ViewbookStage
  pcCompletedAt: string | null
  viewbookId: number
}

export function buildOutlineRows(operatorData: OperatorViewbookData, stage: ViewbookStage, pcCompletedAt: string | null): OutlineRow[] {
  const sectionByKey = new Map(operatorData.sections.map((section) => [section.sectionKey, section]))
  const lineup = STAGE_LINEUPS[stage]
  const rows: OutlineRow[] = []
  const showSection = (key: SectionKey) => key !== 'pc-thanks' || pcCompletedAt !== null

  const append = (key: SectionKey, group: OutlineGroup) => {
    const section = sectionByKey.get(key)
    if (!section || !showSection(key)) return
    rows.push({
      sectionKey: key,
      title: SECTION_TITLES[key],
      state: section.state,
      acknowledged: section.acknowledgedAt !== null,
      group,
    })
  }

  for (const key of lineup.primary) append(key, 'primary')
  for (const key of lineup.carried) append(key, 'carried')

  const seen = new Set<SectionKey>([...lineup.primary, ...lineup.carried])
  const currentIndex = VIEWBOOK_STAGES.indexOf(stage)
  for (const futureStage of VIEWBOOK_STAGES.slice(currentIndex + 1)) {
    const futureLineup = STAGE_LINEUPS[futureStage]
    for (const key of [...futureLineup.primary, ...futureLineup.carried]) {
      if (seen.has(key)) continue
      if (!sectionByKey.has(key) || !showSection(key)) continue
      seen.add(key)
      append(key, 'future')
    }
  }

  return rows
}

const GROUP_LABELS: Record<OutlineGroup, string> = {
  primary: 'Current stage',
  carried: 'Carried into this stage',
  future: 'Upcoming stages',
}

const STATE_PILLS: Record<OutlineRow['state'], { label: string; tone: Tone }> = {
  active: { label: 'Visible', tone: 'neutral' },
  hidden: { label: 'Hidden', tone: 'warning' },
  done: { label: 'Complete', tone: 'success' },
  collapsed: { label: 'Collapsed', tone: 'warning' },
}

export function SectionOutline({ operatorData, stage, pcCompletedAt }: SectionOutlineProps) {
  const [query, setQuery] = useState('')
  const { select } = useSelectionContext()
  const rows = useMemo(
    () => buildOutlineRows(operatorData, stage, pcCompletedAt),
    [operatorData, stage, pcCompletedAt],
  )
  const normalizedQuery = query.trim().toLowerCase()
  const filteredRows = normalizedQuery
    ? rows.filter((row) => row.title.toLowerCase().includes(normalizedQuery))
    : rows

  return (
    <nav aria-label="Section outline" data-vb-section-outline className="border-b border-gray-200 p-4 dark:border-navy-border">
      <h2 className="font-display text-sm font-semibold text-navy dark:text-white">Sections</h2>
      <label className="mt-3 block">
        <span className="sr-only">Search sections</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search sections…"
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-navy outline-none placeholder:text-gray-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-navy-border dark:bg-navy-card dark:text-white dark:placeholder:text-white/35"
        />
      </label>
      <div className="mt-3 space-y-4">
        {filteredRows.length === 0 && (
          <p className="rounded-lg bg-gray-50 px-3 py-4 text-center text-xs text-gray-500 dark:bg-white/5 dark:text-white/50">
            No sections match your search.
          </p>
        )}
        {(['primary', 'carried', 'future'] as const).map((group) => {
          const groupRows = filteredRows.filter((row) => row.group === group)
          if (groupRows.length === 0) return null
          return (
            <section key={group} data-outline-group={group} aria-labelledby={`vb-outline-${group}`}>
              <h3
                id={`vb-outline-${group}`}
                className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500 dark:text-white/45"
              >
                {GROUP_LABELS[group]}
              </h3>
              <ul className="space-y-1.5">
                {groupRows.map((row) => {
                  const statePill = STATE_PILLS[row.state]
                  const current = row.group !== 'future'
                  return (
                    <li key={row.sectionKey}>
                      <button
                        type="button"
                        aria-label={row.title}
                        data-section-key={row.sectionKey}
                        data-vb-current-stage={current ? 'true' : 'false'}
                        onClick={() => {
                          if (row.state === 'hidden') select(row.sectionKey, 'manual-nav', 'status')
                          else select(row.sectionKey, 'manual-nav')
                          navigateToAnchor(row.sectionKey, `#${row.sectionKey}`)
                        }}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 dark:border-navy-border dark:bg-navy-card dark:hover:bg-white/5"
                      >
                        <span className="flex items-start justify-between gap-2">
                          <span className="min-w-0 font-display text-sm font-semibold text-navy dark:text-white">
                            {`${row.title} · ${current ? 'Current' : 'Later'}`}
                          </span>
                        </span>
                        <span className="mt-1.5 flex flex-wrap gap-1.5">
                          <StatusPill label={statePill.label} tone={statePill.tone} />
                          {row.acknowledged && <StatusPill label="Acknowledged" tone="success" />}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
      </div>
    </nav>
  )
}
