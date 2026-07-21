// A plain-language "what / why" panel a section renders at the top of its
// expanded body (spec §5.5). Server component; LIGHT-ONLY (color via --vb-*).
// Extended for the continuous viewer: an optional status pill + a shared
// StatusPill export reused by StageOverview / PreviousStages / the chapter header.
import type { SectionStatus } from '@/lib/viewbook/section-status'

const STATUS_LABEL: Record<SectionStatus, string> = {
  complete: 'Complete',
  current: 'Current',
  upcoming: 'Upcoming',
  'needs-input': 'Needs input',
}

// Visible TEXT label always present (status is never conveyed by color alone).
export function StatusPill({ status }: { status: SectionStatus }) {
  const filled = status === 'complete' || status === 'needs-input'
  const bg = status === 'complete' ? 'var(--vb-secondary)' : status === 'needs-input' ? 'var(--vb-primary)' : 'transparent'
  // on-secondary for the secondary-bg 'complete' pill; on-primary for the primary-bg 'needs-input' pill.
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

export function SectionSummaryPanel({
  whatThis,
  whatWeNeed,
  status,
}: {
  whatThis: string
  whatWeNeed: string | null
  status?: SectionStatus
}) {
  return (
    <div data-vb-summary-panel className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--vb-secondary)' }}>
              What this is
            </p>
            {status && <StatusPill status={status} />}
          </div>
          <p className="mt-1 max-w-[68ch] text-sm text-black/70">{whatThis}</p>
        </div>
        {whatWeNeed != null && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--vb-primary)' }}>
              What we need from you
            </p>
            <p className="mt-1 max-w-[68ch] text-sm text-black/70">{whatWeNeed}</p>
          </div>
        )}
      </div>
    </div>
  )
}
