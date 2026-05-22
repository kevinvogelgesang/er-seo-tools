// Curated blocklist of third-party hosts whose only role on a public web page
// is to send beacons / poll for events / inject session-replay or chat
// widgets. Blocking them at request-interception time stops them from holding
// the page network "busy" past first paint, which was the dominant cause of
// the 1128 nav-timeout errors observed on the 2026-05-21 queue-wide run
// (99.1% of all page errors that day).
//
// Matching is exact-hostname-suffix only: a request host matches an entry E
// when `host === E` or `host.endsWith('.' + E)`. No substring matching, no
// regex — both produce false positives that are hard to debug.
//
// We do NOT block: first-party requests, fonts, images, CSS, scripts on
// non-listed hosts, or HTML documents.
//
// Risk accepted: a small number of cookie-banners / GDPR widgets / chat
// bubbles that ONLY load via GTM will be absent from the scanned DOM.
// Documented in the spec.

export const NOISE_HOSTS: readonly string[] = [
  // Tag management + analytics
  'googletagmanager.com',
  'www.google-analytics.com',
  'analytics.google.com',
  'region1.google-analytics.com',
  'region1.analytics.google.com',
  'stats.g.doubleclick.net',
  'www.googleadservices.com',
  'googlesyndication.com',
  'doubleclick.net',

  // Ad pixels + retargeting
  // EXPLICITLY NOT BLOCKED: connect.facebook.net (FB SDK can be used for
  // accessibility-relevant login widgets / share buttons; post-DCL settle
  // already prevents throughput cost). www.facebook.com is left allowed for
  // the same reason — its /tr beacon is short-lived and won't stall DCL.
  'bat.bing.com',
  'analytics.tiktok.com',
  'analytics.pinterest.com',
  'ct.pinterest.com',
  'px.ads.linkedin.com',
  'snap.licdn.com',

  // Session-replay + heatmaps
  'static.hotjar.com',
  'script.hotjar.com',
  'vc.hotjar.io',
  'cdn.mouseflow.com',
  'rs.fullstory.com',
  'edge.fullstory.com',
  'app.clarity.ms',
  'www.clarity.ms',
  'script.crazyegg.com',

  // Chat / support widgets (Intercom intentionally excluded — it's often
  // the only "Contact us" affordance on a page, so blocking it risks hiding
  // an accessibility-relevant CTA. The post-DCL settle already neutralises
  // any throughput cost of letting Intercom load.)
  'js.driftt.com',
  'js.usemessagely.com',
  'embed.tawk.to',
  'cdn.livechatinc.com',
  'static.olark.com',

  // WordPress.com telemetry (on Jetpack-enabled sites)
  'stats.wp.com',
  'pixel.wp.com',

  // New Relic browser agent
  'bam.nr-data.net',
  'js-agent.newrelic.com',
]

/**
 * Returns true when a request should be aborted as scanner-noise.
 * The function never throws — malformed URLs return false.
 */
export function isNoiseRequest(url: string, resourceType: string): boolean {
  // Block all media (video/audio) regardless of host — irrelevant to axe and
  // a known throughput sink.
  if (resourceType === 'media') return true

  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  if (!host) return false

  for (const entry of NOISE_HOSTS) {
    if (host === entry) return true
    if (host.endsWith('.' + entry)) return true
  }
  return false
}
