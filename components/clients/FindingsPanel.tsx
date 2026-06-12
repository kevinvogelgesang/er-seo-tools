'use client'

// components/clients/FindingsPanel.tsx
//
// B2 open-findings panel: cross-tool issue list from the client's latest
// runs, with type-level trend badges and expandable affected-URL lists.
// Local prop interfaces (repo convention: never import server-only services).

import Link from 'next/link'
import { useState } from 'react'
import { RelativeTime } from '@/app/pillar-analysis/[id]/components/RelativeTime'

export interface FindingRowProp {
  tool: 'seo' | 'ada'
  type: string
  severity: 'critical' | 'warning' | 'notice'
  count: number
  countDelta: number | null
  isNew: boolean
  description: string | null
  helpUrl: string | null
  urls: string[]
  totalUrls: number
  isSample: boolean
  href: string | null
}

export interface SourceMetaProp {
  runAt: string
  href: string | null
  domain: string | null
  hasPrevious: boolean
  newTypeCount: number
  resolvedTypeCount: number
  /** C3 instance-level counts — ADA-only; null = no comparable previous run. */
  newInstanceCount: number | null
  resolvedInstanceCount: number | null
  sourceClass?: 'site' | 'page'
}

const SEV_CHIP: Record<FindingRowProp['severity'], string> = {
  critical: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400',
  warning: 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400',
  notice: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
}

function humanize(type: string): string {
  const s = type.replace(/[_-]/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function SourceLine({ label, m }: { label: string; m: SourceMetaProp }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-gray-400 dark:text-white/40">
      <span className="font-semibold uppercase">{label}</span>
      {m.sourceClass === 'page' && <span>(page audit)</span>}
      {m.domain && <span>{m.domain}</span>}
      <span>·</span>
      <RelativeTime value={m.runAt} />
      {m.hasPrevious && (
        <span>
          · <span className={m.newTypeCount > 0 ? 'text-red-600 dark:text-red-400' : ''}>+{m.newTypeCount} new</span>
          {' / '}
          <span className={m.resolvedTypeCount > 0 ? 'text-green-600 dark:text-green-400' : ''}>{m.resolvedTypeCount} resolved</span>
        </span>
      )}
      {m.newInstanceCount !== null && m.resolvedInstanceCount !== null && (
        <span>
          · <span className={m.newInstanceCount > 0 ? 'text-red-600 dark:text-red-400' : ''}>+{m.newInstanceCount}</span>
          {' / '}
          <span className={m.resolvedInstanceCount > 0 ? 'text-green-600 dark:text-green-400' : ''}>−{m.resolvedInstanceCount}</span>
          {' violations'}
        </span>
      )}
      {m.href && (
        <Link href={m.href} className="text-[#f5a623] hover:text-[#e09415] font-semibold">
          full report →
        </Link>
      )}
    </div>
  )
}

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null || delta === 0) return null
  // Worse is red: count going UP is bad (inverse of score deltas).
  return (
    <span
      className={`px-1 py-0.5 rounded text-[10px] font-semibold tabular-nums ${
        delta > 0
          ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'
          : 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400'
      }`}
    >
      {delta > 0 ? `▲ +${delta}` : `▼ −${Math.abs(delta)}`}
    </span>
  )
}

function FindingRow({ row }: { row: FindingRowProp }) {
  const [open, setOpen] = useState(false)
  const expandable = row.urls.length > 0
  return (
    <li className="border-b border-gray-100 dark:border-navy-border last:border-0">
      <button
        type="button"
        onClick={() => expandable && setOpen(!open)}
        className={`w-full flex items-center gap-2 py-2.5 px-1 text-left ${expandable ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-navy-light/40' : 'cursor-default'}`}
      >
        <span className={`shrink-0 text-gray-400 dark:text-white/40 text-xs w-3 ${expandable ? '' : 'invisible'}`}>
          {open ? '▾' : '▸'}
        </span>
        <span className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-semibold ${SEV_CHIP[row.severity]}`}>
          {row.severity}
        </span>
        <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50">
          {row.tool === 'seo' ? 'SEO' : 'ADA'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-sm font-medium text-[#1c2d4a] dark:text-white">{humanize(row.type)}</span>
          {row.description && (
            <span className="block text-xs text-gray-500 dark:text-white/50 truncate">{row.description}</span>
          )}
        </span>
        {row.isNew && (
          <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-600 text-white">NEW</span>
        )}
        {/* Sample badge lives on the COLLAPSED row — a sampled, zero-URL
            finding is not expandable and must not look complete. */}
        {row.isSample && (
          <span
            className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50"
            title="URL list is a sample/partial — the count is authoritative"
          >
            sample
          </span>
        )}
        <DeltaBadge delta={row.countDelta} />
        <span className="shrink-0 text-xs text-gray-400 dark:text-white/40 tabular-nums">
          {row.count} URL{row.count === 1 ? '' : 's'}
        </span>
      </button>
      {open && (
        <div className="pl-10 pr-3 pb-3">
          <ul className="space-y-0.5">
            {row.urls.map((u) => (
              <li key={u} className="text-xs text-gray-600 dark:text-white/60 break-all">{u}</li>
            ))}
          </ul>
          <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-gray-400 dark:text-white/40">
            {row.isSample && <span>sample/partial URL list — count is authoritative</span>}
            {row.totalUrls > row.urls.length && (
              <span>
                Showing {row.urls.length} of {row.totalUrls}
                {row.href && (
                  <>
                    {' — '}
                    <Link href={row.href} className="text-[#f5a623] hover:text-[#e09415] font-semibold">view full report →</Link>
                  </>
                )}
              </span>
            )}
            {row.helpUrl && (
              <a href={row.helpUrl} target="_blank" rel="noopener noreferrer" className="text-[#f5a623] hover:text-[#e09415] font-semibold">
                how to fix →
              </a>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

export function FindingsPanel({ rows, seo, ada }: {
  rows: FindingRowProp[]
  seo: SourceMetaProp | null
  ada: SourceMetaProp | null
}) {
  const hasRuns = seo !== null || ada !== null
  return (
    <div className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border p-6">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <h2 className="text-sm font-semibold text-[#1c2d4a] dark:text-white uppercase tracking-wide">Open Findings</h2>
        <div className="space-y-0.5 text-right">
          {seo && <SourceLine label="SEO" m={seo} />}
          {ada && <SourceLine label="ADA" m={ada} />}
        </div>
      </div>
      {!hasRuns ? (
        <p className="text-sm text-gray-500 dark:text-white/60 py-4">
          No findings data yet — findings populate from runs after 2026-06-10. Run a parse or audit to see issues here.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-green-700 dark:text-green-400 py-4 font-medium">
          No open findings — the latest runs came back clean.
        </p>
      ) : (
        <ul>
          {rows.map((r) => (
            <FindingRow key={`${r.tool}:${r.type}`} row={r} />
          ))}
        </ul>
      )}
    </div>
  )
}
