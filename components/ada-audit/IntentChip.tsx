import { scanIntentOf, SCAN_INTENT_LABEL } from '@/lib/ada-audit/scan-intent'

/** Scan-intent badge for dense rows: renders the SEO label only; ADA (the
 *  default) renders nothing to avoid labeling every historical row. Explicit
 *  two-way intent lives in the form/schedule toggles, not here. */
export function IntentChip({ seoOnly }: { seoOnly?: boolean | null }) {
  if (scanIntentOf({ seoOnly }) !== 'seo') return null
  return (
    <span className="rounded bg-orange/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange dark:bg-orange/15">
      {SCAN_INTENT_LABEL.seo}
    </span>
  )
}
