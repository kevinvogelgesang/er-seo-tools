'use client'

// components/issues/IssuesView.tsx
//
// Task 13 (D8 weekly client sweep) — the /issues "Current Scan Issues" page.
// A server component (app/(app)/issues/page.tsx) calls loadIssuesPayload()
// directly and hands the frozen snapshot here; there is NO client fetch and NO
// polling — the payload is a point-in-time picture of the last completed sweep.
//
// Filters (severity / tool / change / client / search) are pure client state;
// they only narrow what's already loaded. HEADLINE counts come straight from
// payload.sweep.totals and are NEVER recomputed from the visible rows (notices
// are already excluded from actionable totals upstream — recounting would
// double-adjust). The effort nudge ("1 hour") is email-only (DIGEST_EFFORT_
// NUDGE): the page uses "keep going as time allows" framing instead.

import { useMemo, useState } from 'react'
import type { IssuesPayload } from '@/lib/sweep/read'
import type { IssueGroup } from '@/lib/sweep/types'
import { Chip, ChangeChip, CoverageChip, SeverityChip, ToolChip, formatShortDate } from './chips'

type SeverityFilter = 'actionable' | 'critical' | 'warning' | 'notices'
type ToolFilter = 'both' | 'ada-audit' | 'seo-parser'
type ChangeFilter = 'any' | 'new-worsened'

const SEVERITY_STRIPE: Record<IssueGroup['severity'], string> = {
  critical: 'bg-red-500',
  warning: 'bg-amber-500',
  notice: 'bg-gray-300 dark:bg-white/20',
}

function scanHref(g: Pick<IssueGroup, 'tool' | 'siteAuditId' | 'liveScanRunId'>): string | null {
  if (g.tool === 'ada-audit') {
    return g.siteAuditId ? `/ada-audit/site/${g.siteAuditId}?resultTab=accessibility` : null
  }
  return g.liveScanRunId ? `/seo-audits/results/run/${g.liveScanRunId}` : null
}

function affectedLabel(g: IssueGroup): string {
  return `${g.approximate ? '≥' : ''}${g.affectedCount} ${g.unit}`
}

function ScanLink({ group }: { group: IssueGroup }) {
  const href = scanHref(group)
  if (!href) return <span className="text-xs text-gray-400 dark:text-white/30">No scan link</span>
  return (
    <a href={href} className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap">
      View scan →
    </a>
  )
}

// ---------------------------------------------------------------------------
// Summary tiles
// ---------------------------------------------------------------------------

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-navy-card rounded-xl border border-gray-200 dark:border-navy-border p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-white/50">{label}</div>
      <div className="mt-1.5">{children}</div>
    </div>
  )
}

function DeltaNote({ delta }: { delta: number | null }) {
  if (delta == null) return <span className="text-xs text-gray-400 dark:text-white/40">no prior week to compare</span>
  if (delta === 0) return <span className="text-xs text-gray-500 dark:text-white/50">no change vs last week</span>
  const down = delta < 0
  return (
    <span className={`text-xs font-semibold ${down ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
      {down ? '▼' : '▲'} {Math.abs(delta)} vs last week
    </span>
  )
}

type SweepTotals = NonNullable<IssuesPayload['sweep']>['totals']

function SummaryTiles({ totals }: { totals: SweepTotals }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <Tile label="Actionable groups observed">
        <div className="text-2xl font-bold text-navy dark:text-white tabular-nums">{totals.actionable}</div>
        <div className="mt-0.5"><DeltaNote delta={totals.delta} /></div>
        <div className="mt-1 text-[11px] text-gray-400 dark:text-white/40">
          across {totals.comparablePairs} comparable domain/tool observations
        </div>
      </Tile>
      <Tile label="New / worsened">
        <div className="text-sm font-semibold text-navy dark:text-white">
          <span className="text-blue-600 dark:text-blue-400">{totals.newCount} new</span>
          <span className="text-gray-400 dark:text-white/40"> · </span>
          <span className="text-red-600 dark:text-red-400">{totals.worsenedCount} worsened</span>
        </div>
        <div className="mt-1 text-[11px] text-gray-400 dark:text-white/40">issues that appeared or grew this week</div>
      </Tile>
      <Tile label="No longer detected">
        <div className="text-2xl font-bold text-navy dark:text-white tabular-nums">{totals.resolvedCount}</div>
        <div className="mt-1 text-[11px] text-gray-400 dark:text-white/40">
          groups not seen this sweep — verify, don&apos;t assume fixed
        </div>
      </Tile>
      <Tile label="Sweep coverage">
        <div className="text-2xl font-bold text-navy dark:text-white tabular-nums">
          {totals.scanned}/{totals.expected}
        </div>
        <div className="mt-1 text-[11px] text-gray-400 dark:text-white/40">
          {totals.comparableDomains} comparable · {totals.partialDomains} partial · {totals.failedDomains} failed
        </div>
      </Tile>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

function Segment<T extends string>({ value, current, onSelect, label }: {
  value: T; current: T; onSelect: (v: T) => void; label: string
}) {
  const active = value === current
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      aria-pressed={active}
      className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
        active
          ? 'bg-navy text-white dark:bg-white dark:text-navy'
          : 'text-gray-600 dark:text-white/60 hover:bg-gray-100 dark:hover:bg-white/5'
      }`}
    >
      {label}
    </button>
  )
}

function SegmentGroup({ children }: { children: React.ReactNode }) {
  return <div className="inline-flex items-center gap-0.5 rounded-lg border border-gray-200 dark:border-navy-border p-0.5">{children}</div>
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

function IssueRow({ group, stale }: { group: IssueGroup; stale?: boolean }) {
  return (
    <tr className={`border-b border-gray-100 dark:border-navy-border ${stale ? 'opacity-60' : ''}`}>
      <td className="w-1 p-0">
        <div className={`h-full min-h-[2.5rem] w-1 ${SEVERITY_STRIPE[group.severity]}`} />
      </td>
      <td className="py-2.5 pl-3 pr-3 align-top">
        <div className="text-xs font-semibold text-navy dark:text-white">{group.clientName}</div>
        <div className="text-[11px] text-gray-400 dark:text-white/40">{group.domain}</div>
      </td>
      <td className="py-2.5 pr-3 align-top"><ToolChip tool={group.tool} /></td>
      <td className="py-2.5 pr-3 align-top">
        <div className="text-xs font-medium text-navy dark:text-white">{group.title}</div>
        <div className="text-[11px] text-gray-400 dark:text-white/40 font-mono">{group.type}</div>
      </td>
      <td className="py-2.5 pr-3 align-top">
        <SeverityChip severity={group.severity} severityChanged={group.severityChanged} />
      </td>
      <td className="py-2.5 pr-3 align-top">
        <span className="text-xs text-gray-700 dark:text-white/80 tabular-nums whitespace-nowrap">{affectedLabel(group)}</span>
      </td>
      <td className="py-2.5 pr-3 align-top">
        <div className="flex flex-wrap items-center gap-1">
          <ChangeChip group={group} />
          {!stale && <CoverageChip coverageState={group.coverageState} />}
        </div>
      </td>
      <td className="py-2.5 pr-3 align-top text-right"><ScanLink group={group} /></td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function IssuesView({ payload }: { payload: IssuesPayload }) {
  const [severity, setSeverity] = useState<SeverityFilter>('actionable')
  const [tool, setTool] = useState<ToolFilter>('both')
  const [change, setChange] = useState<ChangeFilter>('any')
  const [clientId, setClientId] = useState<number | 'all'>('all')
  const [search, setSearch] = useState('')

  const clientOptions = useMemo(() => {
    const seen = new Map<number, string>()
    for (const g of [...payload.groups, ...payload.staleGroups]) {
      if (!seen.has(g.clientId)) seen.set(g.clientId, g.clientName)
    }
    return Array.from(seen, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [payload.groups, payload.staleGroups])

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (g: IssueGroup): boolean => {
      if (severity === 'actionable' && g.severity === 'notice') return false
      if (severity === 'critical' && g.severity !== 'critical') return false
      if (severity === 'warning' && g.severity !== 'warning') return false
      if (severity === 'notices' && g.severity !== 'notice') return false
      if (tool !== 'both' && g.tool !== tool) return false
      if (change === 'new-worsened' && g.changeState !== 'new' && g.changeState !== 'worsened') return false
      if (clientId !== 'all' && g.clientId !== clientId) return false
      if (q && ![g.title, g.type, g.clientName, g.domain].some((s) => s.toLowerCase().includes(q))) return false
      return true
    }
  }, [severity, tool, change, clientId, search])

  const visibleGroups = payload.groups.filter(matches)
  const visibleStale = payload.staleGroups.filter(matches)

  const actionableCount = payload.groups.filter((g) => g.severity !== 'notice').length
  const noticeCount = payload.groups.filter((g) => g.severity === 'notice').length
  const staleCount = payload.staleGroups.length

  // --- Empty (first-run) state ------------------------------------------------
  if (!payload.sweep) {
    return (
      <div className="space-y-6">
        <Header />
        {payload.inProgress && <InProgressBanner />}
        <div className="bg-white dark:bg-navy-card rounded-xl border border-gray-200 dark:border-navy-border p-8 text-center">
          <p className="text-sm text-gray-600 dark:text-white/70">No sweep has completed yet.</p>
          <p className="mt-1 text-xs text-gray-400 dark:text-white/40">
            The first sweep runs Sunday evening; check back Monday for the first snapshot.
          </p>
        </div>
      </div>
    )
  }

  const { sweep } = payload

  return (
    <div className="space-y-6">
      <Header sweep={sweep} />
      {payload.inProgress && <InProgressBanner />}

      <SummaryTiles totals={sweep.totals} />

      {/* Shortlist */}
      {payload.shortlist.length > 0 && (
        <div className="bg-white dark:bg-navy-card rounded-xl border border-gray-200 dark:border-navy-border border-l-4 border-l-orange p-5">
          <h2 className="text-sm font-bold text-navy dark:text-white">Start here — highest-impact candidates</h2>
          <p className="mt-0.5 text-[11px] text-gray-500 dark:text-white/50">
            New &amp; worsened issues ranked by severity × affected reach. Impact ranking doesn&apos;t guarantee a
            quick fix. Work top-down and keep going as time allows.
          </p>
          <ol className="mt-3 space-y-2.5">
            {payload.shortlist.slice(0, 3).map((g, i) => (
              <li key={`${g.clientId}-${g.tool}-${g.type}-${i}`} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold text-navy dark:text-white">{g.clientName}</span>
                    <span className="text-gray-300 dark:text-white/30">—</span>
                    <span className="text-xs text-navy dark:text-white truncate">{g.title}</span>
                    <SeverityChip severity={g.severity} severityChanged={g.severityChanged} />
                    <ChangeChip group={g} />
                    <CoverageChip coverageState={g.coverageState} />
                  </div>
                  <div className="mt-0.5 text-[11px] text-gray-400 dark:text-white/40">
                    {g.severity} · {g.changeState} · {affectedLabel(g)}
                  </div>
                </div>
                <ScanLink group={g} />
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Filter bar */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <SegmentGroup>
            <Segment value="actionable" current={severity} onSelect={setSeverity} label="Actionable" />
            <Segment value="critical" current={severity} onSelect={setSeverity} label="Critical" />
            <Segment value="warning" current={severity} onSelect={setSeverity} label="Warning" />
            <Segment value="notices" current={severity} onSelect={setSeverity} label="Notices" />
          </SegmentGroup>
          <SegmentGroup>
            <Segment value="both" current={tool} onSelect={setTool} label="ADA + SEO" />
            <Segment value="ada-audit" current={tool} onSelect={setTool} label="ADA" />
            <Segment value="seo-parser" current={tool} onSelect={setTool} label="SEO" />
          </SegmentGroup>
          <SegmentGroup>
            <Segment value="any" current={change} onSelect={setChange} label="Any" />
            <Segment value="new-worsened" current={change} onSelect={setChange} label="New / worsened" />
          </SegmentGroup>
          <select
            value={clientId === 'all' ? 'all' : String(clientId)}
            onChange={(e) => setClientId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            className="rounded-md border border-gray-200 dark:border-navy-border bg-white dark:bg-navy px-2 py-1 text-xs text-navy dark:text-white"
            aria-label="Filter by client"
          >
            <option value="all">All clients</option>
            {clientOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search issue, type, client…"
            aria-label="Search issues"
            className="flex-1 min-w-[160px] rounded-md border border-gray-200 dark:border-navy-border bg-white dark:bg-navy px-2.5 py-1 text-xs text-navy dark:text-white placeholder:text-gray-400 dark:placeholder:text-white/30"
          />
        </div>
        <p className="text-[11px] text-gray-400 dark:text-white/40">
          {actionableCount} actionable groups · {noticeCount} notice groups hidden · {staleCount} stale
        </p>
      </div>

      {/* Table */}
      {visibleGroups.length + visibleStale.length === 0 ? (
        <div className="bg-white dark:bg-navy-card rounded-xl border border-gray-200 dark:border-navy-border p-6 text-center text-xs text-gray-400 dark:text-white/40">
          No issues match the current filters.
        </div>
      ) : (
        <div className="bg-white dark:bg-navy-card rounded-xl border border-gray-200 dark:border-navy-border overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-200 dark:border-navy-border text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-white/40">
                <th className="w-1 p-0" aria-hidden="true"></th>
                <th className="py-2 pl-3 pr-3">Client / Domain</th>
                <th className="py-2 pr-3">Tool</th>
                <th className="py-2 pr-3">Issue</th>
                <th className="py-2 pr-3">Severity</th>
                <th className="py-2 pr-3">Affected</th>
                <th className="py-2 pr-3">Change</th>
                <th className="py-2 pr-3 text-right">Scan</th>
              </tr>
            </thead>
            <tbody>
              {visibleGroups.map((g, i) => (
                <IssueRow key={`g-${g.clientId}-${g.tool}-${g.type}-${i}`} group={g} />
              ))}
              {visibleStale.map((g, i) => (
                <IssueRow key={`s-${g.clientId}-${g.tool}-${g.type}-${i}`} group={g} stale />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Not comparable this week */}
      {payload.notComparable.length > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/5 p-4">
          <h3 className="text-xs font-semibold text-amber-800 dark:text-amber-300">Not comparable this week</h3>
          <p className="mt-0.5 text-[11px] text-amber-700/70 dark:text-amber-300/60">
            These domain/tool pairs could not be compared against last week — their issue counts are omitted or
            partial above.
          </p>
          <ul className="mt-2 space-y-1">
            {payload.notComparable.map((c, i) => (
              <li key={`${c.clientId}-${c.tool}-${i}`} className="flex flex-wrap items-center gap-1.5 text-[11px] text-amber-800 dark:text-amber-200">
                <ToolChip tool={c.tool} />
                <span className="font-medium">{c.domain}</span>
                <Chip label={c.state} tone={c.state === 'failed' ? 'red' : 'amber'} />
                {c.reason && <span className="text-amber-700/70 dark:text-amber-300/60">{c.reason}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* No longer detected */}
      {payload.resolvedGroups.length > 0 && (
        <details className="rounded-xl border border-gray-200 dark:border-navy-border bg-white dark:bg-navy-card">
          <summary className="cursor-pointer px-4 py-3 text-xs font-semibold text-gray-600 dark:text-white/70">
            No longer detected this week ({payload.resolvedGroups.length})
          </summary>
          <ul className="border-t border-gray-100 dark:border-navy-border divide-y divide-gray-100 dark:divide-navy-border">
            {payload.resolvedGroups.map((r, i) => (
              <li key={`${r.clientId}-${r.tool}-${r.type}-${i}`} className="flex flex-wrap items-center gap-2 px-4 py-2 text-[11px]">
                <ToolChip tool={r.tool} />
                <span className="font-semibold text-navy dark:text-white">{r.clientName}</span>
                <span className="text-gray-600 dark:text-white/70">{r.title}</span>
                <span className="text-gray-400 dark:text-white/40">
                  was {r.priorCount} {r.unit} · no longer detected in {formatShortDate(sweep.snapshotAt)} sweep
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="text-[11px] text-gray-400 dark:text-white/40 leading-relaxed">
        These are patterns observed in the most recent weekly sweep, not a live re-scan. A resolved or absent issue
        means it was not detected this week — verify before assuming it is fixed. Approximate counts (≥) reflect
        capped or partial crawls.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Header & banners
// ---------------------------------------------------------------------------

function Header({ sweep }: { sweep?: NonNullable<IssuesPayload['sweep']> }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-heading font-bold text-navy dark:text-white">Current Scan Issues</h1>
        {sweep ? (
          <p className="mt-1 text-[13px] font-body text-navy/50 dark:text-white/50">
            {sweep.startedAt && <>Sweep started {formatShortDate(sweep.startedAt)} · </>}
            snapshot {formatShortDate(sweep.snapshotAt)} · {sweep.totals.scanned}/{sweep.totals.expected} scanned,{' '}
            {sweep.totals.comparableDomains} comparable · <DeltaInline delta={sweep.totals.delta} />
          </p>
        ) : (
          <p className="mt-1 text-[13px] font-body text-navy/50 dark:text-white/50">
            The weekly client sweep of accessibility &amp; SEO issues across the fleet.
          </p>
        )}
      </div>
      <p className="text-[11px] text-gray-400 dark:text-white/40 max-w-[220px] text-right">
        A digest of this snapshot emails every Monday at 7:00 AM Pacific to support@.
      </p>
    </header>
  )
}

function DeltaInline({ delta }: { delta: number | null }) {
  if (delta == null) return <span>no prior week</span>
  if (delta === 0) return <span>no change vs last week</span>
  const down = delta < 0
  return <span>{down ? '▼' : '▲'} {Math.abs(delta)} vs last week</span>
}

function InProgressBanner() {
  return (
    <div className="rounded-xl border border-blue-200 dark:border-blue-500/20 bg-blue-50 dark:bg-blue-500/5 px-4 py-3 text-xs text-blue-800 dark:text-blue-300">
      A newer sweep is in progress — its snapshot is still being computed. The results below are from the last
      completed sweep.
    </div>
  )
}
