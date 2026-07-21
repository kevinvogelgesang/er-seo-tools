// A plain-language "what / why" panel a section renders at the top of its
// expanded body (spec §5.5). Server component; LIGHT-ONLY (color via --vb-*).
// Extended for the continuous viewer: an optional status pill. StatusPill itself
// now lives in ./StatusPill (relocated so it survives this panel's deletion in
// Feature A); re-exported here so existing importers keep resolving.
import type { SectionStatus } from '@/lib/viewbook/section-status'
import { StatusPill } from './StatusPill'

export { StatusPill }

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
