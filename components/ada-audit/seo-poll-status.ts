// C17: client-safe synthetic status for seoOnly audits. The parent SiteAudit
// flips to 'complete' exactly when the verifier phase BEGINS (spec Codex fix
// #8) — so for polling purposes 'complete' is remapped by run-readiness and
// verifier phase. The finalizer's flip→enqueue race is handled SERVER-side:
// classifySeoPhase only reports 'unavailable' after the enqueue grace window
// (plan Codex fix #1) — this mapping trusts the state it is given.
// Type-only import: lib/ada-audit/seo-phase imports prisma.
import type { SeoPhaseState } from '@/lib/ada-audit/seo-phase'

export function deriveSeoOnlyStatus(
  status: string,
  liveScanRunId: string | null,
  seoPhaseState: SeoPhaseState | null | undefined,
): string {
  if (status !== 'complete') return status
  if (liveScanRunId) return 'seo-ready'
  switch (seoPhaseState) {
    case 'failed':
      return 'seo-failed'
    case 'unavailable':
      return 'seo-unavailable'
    default:
      return 'seo-verifying' // queued | running | unknown-yet
  }
}

export function isSeoOnlyTerminal(s: string): boolean {
  return (
    s === 'seo-ready' ||
    s === 'seo-failed' ||
    s === 'seo-unavailable' ||
    s === 'error' ||
    s === 'cancelled'
  )
}
