// C11: seoOnly audits have no ADA data — the ADA site results page would
// otherwise render "Result data unavailable". Pure decision helper (no
// server-only imports) so the redirect target is unit-testable.
export function seoOnlyRedirectTarget(audit: { seoOnly: boolean }): string | null {
  return audit.seoOnly ? '/seo-parser' : null
}
