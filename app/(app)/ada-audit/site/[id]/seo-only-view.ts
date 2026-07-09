// C16: seoOnly audits live on this page while transient (SiteAuditPoller) and
// hand off to the SEO results run page once the live-scan run exists. Pure
// decision helper (no server-only imports) so the branch is unit-testable.
export type SeoOnlyView =
  | { kind: 'none' }
  | { kind: 'redirect'; href: string }
  | { kind: 'banner' }

export function resolveSeoOnlyView(
  audit: { seoOnly: boolean; status: string },
  liveScanRunId: string | null,
): SeoOnlyView {
  if (!audit.seoOnly || audit.status !== 'complete') return { kind: 'none' }
  if (liveScanRunId) return { kind: 'redirect', href: `/seo-audits/results/run/${liveScanRunId}` }
  return { kind: 'banner' }
}
