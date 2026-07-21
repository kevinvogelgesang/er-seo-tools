// The viewbook-public section StatusPill (distinct from components/ui/StatusPill).
// Visible TEXT label always present — status is never conveyed by color alone.
// LIGHT-ONLY (color via --vb-*). Relocated out of SectionSummaryPanel (removed
// in Feature A) since StageOverview / PreviousStages / the chapter header still
// consume it.
import type { SectionStatus } from '@/lib/viewbook/section-status'

const STATUS_LABEL: Record<SectionStatus, string> = {
  complete: 'Complete',
  current: 'Current',
  upcoming: 'Upcoming',
  'needs-input': 'Needs input',
}

export function StatusPill({ status }: { status: SectionStatus }) {
  const filled = status === 'complete' || status === 'needs-input'
  const bg = status === 'complete' ? 'var(--vb-secondary)' : status === 'needs-input' ? 'var(--vb-primary)' : 'transparent'
  const color = status === 'complete' ? 'var(--vb-on-secondary)' : status === 'needs-input' ? 'var(--vb-on-primary)' : 'rgba(0,0,0,0.6)'
  return (
    <span
      data-vb-status-pill={status}
      className="inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold"
      style={{ background: bg, color, borderColor: filled ? 'transparent' : 'rgba(0,0,0,0.15)' }}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}
