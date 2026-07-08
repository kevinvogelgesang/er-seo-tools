import { StatusPill } from '@/components/ui/StatusPill'

export function ScoreVersionBadge({ version, fromFallback, passCount, incompleteCount }: {
  version: number
  fromFallback: boolean
  passCount: number | null
  incompleteCount: number | null
}) {
  const label = version >= 2 ? 'v2' : 'v1'
  const title = version >= 2
    ? 'Score v2 — size-normalized, WCAG-aware; passes & needs-review shown'
    : fromFallback
      ? 'Score v1 (formula label unavailable for this run)'
      : 'Score v1 (legacy formula)'
  return (
    <span className="inline-flex items-center gap-2 text-xs text-gray-500 dark:text-white/60">
      <span title={title}>
        <StatusPill label={label} tone="neutral" />
      </span>
      {passCount != null && <span>{passCount} passed</span>}
      {incompleteCount != null && <span>{incompleteCount} needs review</span>}
    </span>
  )
}
