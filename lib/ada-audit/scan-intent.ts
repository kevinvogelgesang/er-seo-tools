// Single source of truth for the ADA-vs-SEO scan-intent label. Intent is
// derived from seoOnly (the execution mode) — a full-pipeline seoIntent audit
// is still an accessibility audit. Pure + client-safe (no server imports).
export type ScanIntent = 'ada' | 'seo'

export function scanIntentOf(a: { seoOnly?: boolean | null }): ScanIntent {
  return a.seoOnly ? 'seo' : 'ada'
}

export const SCAN_INTENT_LABEL: Record<ScanIntent, string> = {
  ada: 'Accessibility',
  seo: 'SEO',
}
