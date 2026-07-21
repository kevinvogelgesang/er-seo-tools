// Reading-experience pass, Task 5: a plain-language "what/why" panel a section
// can render above its detail body — "What this is" (always) + "What we need
// from you" (only when the section actually needs operator input) + a
// StatusPill so the reader always sees where a section sits without having to
// infer it from collapse state alone. Server component: no client state, no
// `dark:` classes (public viewbook is LIGHT-ONLY per house rules) — all color
// via `--vb-*` tokens or the literal neutral the brief names for `upcoming`.
//
// `StatusPill` is exported from here (not its own file) because it's a small,
// self-contained status→label/color mapping that SectionShell and
// StageOverview will both import directly — no reason to give it a file of
// its own.
import type { SectionStatus } from '@/lib/viewbook/section-status'

const STATUS_META: Record<SectionStatus, { label: string; color: string }> = {
  complete: { label: 'Complete', color: 'var(--vb-tertiary)' },
  current: { label: 'Current', color: 'var(--vb-secondary)' },
  upcoming: { label: 'Upcoming', color: 'rgba(0,0,0,0.45)' },
  'needs-input': { label: 'Needs input', color: 'var(--vb-primary)' },
}

export function StatusPill({ status }: { status: SectionStatus }) {
  const { label, color } = STATUS_META[status]
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-white px-2.5 py-1 text-xs font-semibold"
      style={{ color }}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {label}
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
  status: SectionStatus
}) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: 'var(--vb-secondary)' }}
        >
          Section summary
        </p>
        <StatusPill status={status} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: 'var(--vb-secondary)' }}
          >
            What this is
          </p>
          <p className="mt-1 text-sm text-black/70">{whatThis}</p>
        </div>
        {whatWeNeed != null && (
          <div>
            <p
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: 'var(--vb-primary)' }}
            >
              What we need from you
            </p>
            <p className="mt-1 text-sm text-black/70">{whatWeNeed}</p>
          </div>
        )}
      </div>
    </div>
  )
}
