// components/issues/chips.tsx
//
// Task 13 — chip vocabulary for the /issues current-scan-issues table.
// Pure presentational, client-safe (no server import). The load-bearing rule
// (Codex plan-fix #21): coverage badges SUPPLEMENT change badges — they never
// replace them. A partial pair's NEW group renders BOTH <ChangeChip> (NEW) and
// <CoverageChip> (PARTIAL). Stale rows are identified by the staleGroups array
// / changeState 'stale', NEVER by coverageState (Task 7 contract: a stale row
// carries its prior coverageState verbatim).

import type { IssueGroup, SweepTool, IssueUnit } from '@/lib/sweep/types'

type ChipTone = 'red' | 'orange' | 'amber' | 'green' | 'blue' | 'purple' | 'gray'

const CHIP_TONES: Record<ChipTone, string> = {
  red: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400',
  orange: 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  green: 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400',
  blue: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
  purple: 'bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400',
  gray: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/60',
}

export function Chip({ label, tone, title }: { label: string; tone: ChipTone; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-body font-semibold uppercase tracking-wide ${CHIP_TONES[tone]}`}
    >
      {label}
    </span>
  )
}

export function formatShortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const UNIT_LABEL: Record<IssueUnit, string> = {
  pages: 'pages',
  targets: 'targets',
  groups: 'groups',
}

/** ADA (blue) / SEO (orange) tool chip. */
export function ToolChip({ tool }: { tool: SweepTool }) {
  return tool === 'ada-audit'
    ? <Chip label="ADA" tone="blue" title="Accessibility audit" />
    : <Chip label="SEO" tone="orange" title="SEO live-scan" />
}

const SEVERITY_TONE: Record<IssueGroup['severity'], ChipTone> = {
  critical: 'red',
  warning: 'amber',
  notice: 'gray',
}

/** Severity chip; an escalation (severityChanged 'escalated') adds a ↑ marker. */
export function SeverityChip({ severity, severityChanged }: {
  severity: IssueGroup['severity']
  severityChanged: IssueGroup['severityChanged']
}) {
  const escalated = severityChanged === 'escalated'
  return (
    <Chip
      label={escalated ? `↑ ${severity}` : severity}
      tone={SEVERITY_TONE[severity]}
      title={escalated ? 'Severity escalated since last sweep' : undefined}
    />
  )
}

/**
 * Change chip: NEW / WORSENED +n <unit> / FEWER −n <unit> / DETECTED n SWEEPS /
 * STALE · LAST OBSERVED <date>. First-observation groups (delta null,
 * changeState 'new') render a bare NEW with no delta claim.
 */
// `hideStreak` — on a MANUAL snapshot the streak was counted against the last
// SCHEDULED sweep (a mid-week diff), so "N SWEEPS" would misread as consecutive
// weeks. Suppress the count there; the change state itself stays honest.
export function ChangeChip({ group, hideStreak = false }: { group: IssueGroup; hideStreak?: boolean }) {
  const unit = UNIT_LABEL[group.unit]
  switch (group.changeState) {
    case 'new':
      return <Chip label="NEW" tone="blue" />
    case 'worsened':
      return (
        <Chip
          label={group.delta != null ? `WORSENED +${Math.abs(group.delta)} ${unit}` : 'WORSENED'}
          tone="red"
        />
      )
    case 'fewer':
      return (
        <Chip
          label={group.delta != null ? `FEWER −${Math.abs(group.delta)} ${unit}` : 'FEWER'}
          tone="green"
        />
      )
    case 'detected':
      return <Chip label={hideStreak ? 'DETECTED' : `DETECTED ${group.streak} SWEEPS`} tone="gray" />
    case 'stale':
      return <Chip label={`STALE · LAST OBSERVED ${formatShortDate(group.lastObservedAt)}`} tone="amber" />
    default:
      return null
  }
}

/**
 * Coverage chip — SUPPLEMENTS the change chip, never replaces it. Only
 * first-baseline and partial pairs get a badge; comparable pairs get none and
 * failed pairs never render live rows here.
 */
export function CoverageChip({ coverageState }: { coverageState: IssueGroup['coverageState'] }) {
  if (coverageState === 'first-baseline') return <Chip label="FIRST BASELINE" tone="purple" title="First time this pair was observed — no prior week to compare" />
  if (coverageState === 'partial') return <Chip label="PARTIAL" tone="amber" title="This pair scanned only partially this week — counts may undercount" />
  return null
}
