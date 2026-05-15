// lib/ada-audit/lighthouse-provider.ts
//
// Provider selection for the Lighthouse data source. Three providers:
//   - 'pagespeed' — Google PageSpeed Insights v5 over HTTPS (default in prod)
//   - 'local'     — local puppeteer-core + lighthouse package (fallback)
//   - 'off'       — skip Lighthouse entirely
//
// LIGHTHOUSE_ENABLED=false short-circuits to 'off' regardless of provider —
// preserves the existing kill-switch behavior.

export type LighthouseProvider = 'pagespeed' | 'local' | 'off'

export function getLighthouseProvider(): LighthouseProvider {
  if ((process.env.LIGHTHOUSE_ENABLED ?? 'true') === 'false') return 'off'
  const raw = (process.env.LIGHTHOUSE_PROVIDER ?? 'local').toLowerCase()
  if (raw === 'pagespeed' || raw === 'local' || raw === 'off') return raw
  return 'local'   // unknown values fall back to local (safer than silently disabling)
}

/**
 * True when the chosen provider is responsible for calling `page.goto()`
 * during the audit. Local Lighthouse owns navigation; PSI and 'off' do not,
 * so the caller (runAxeAudit) must navigate itself before running axe.
 */
export function lighthouseOwnsNavigation(): boolean {
  return getLighthouseProvider() === 'local'
}
