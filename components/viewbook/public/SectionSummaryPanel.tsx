// A plain-language "what / why" panel a section renders at the top of its
// expanded body — "What this is" (always) + "What we need from you" (only when
// the section actually needs operator/client input). Fills the gap the viewer
// otherwise leaves: the hero + collapse chrome say WHERE you are, this says
// WHAT the section is and whether anything is needed from you. Copy is
// code-owned (SECTION_COPY) — no operator data, no server imports.
//
// Server component: no client state, no `dark:` classes — the public viewbook
// is LIGHT-ONLY (house rule); all color via `--vb-*` tokens.
export function SectionSummaryPanel({
  whatThis,
  whatWeNeed,
}: {
  whatThis: string
  whatWeNeed: string | null
}) {
  return (
    <div data-vb-summary-panel className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
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
