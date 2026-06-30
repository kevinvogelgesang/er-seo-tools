'use client'

export type SeoSource = 'sf-upload' | 'live-scan'

/**
 * Pure helper — safe to import in server components and tests.
 * Returns a human-readable label for the given SEO data source.
 */
export function seoSourceLabel(source: SeoSource): string {
  if (source === 'live-scan') {
    return 'Live scan — on-page + audited-set graph; depth approximate'
  }
  return 'Screaming Frog'
}

/**
 * Small inline badge indicating whether results come from a Screaming Frog
 * upload or the live-scan verifier. Purple for live-scan, gray for SF upload.
 */
export function SeoSourceBadge({ source }: { source: SeoSource }) {
  const isLive = source === 'live-scan'
  return (
    <span
      className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${
        isLive
          ? 'bg-purple-100 dark:bg-purple-500/15 text-purple-700 dark:text-purple-400'
          : 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-white/60'
      }`}
      title={seoSourceLabel(source)}
    >
      {isLive ? 'Live scan' : 'SF upload'}
    </span>
  )
}

/**
 * Inline notice used by controls that require a Screaming Frog upload
 * (export, share, diff, roadmap). Rendered when source === 'live-scan'.
 *
 * @param feature  Short description of the gated feature shown in the message.
 *                 Defaults to a generic label if omitted.
 */
export function NeedsScreamingFrog({ feature }: { feature?: string }) {
  const subject = feature
    ? `${feature.charAt(0).toUpperCase()}${feature.slice(1)}`
    : 'This feature'
  return (
    <span className="text-xs text-gray-400 dark:text-white/40 italic">
      {subject} requires Screaming Frog data
    </span>
  )
}
