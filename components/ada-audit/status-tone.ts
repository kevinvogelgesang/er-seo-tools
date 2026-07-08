import type { Tone } from '@/components/ui/StatusPill'

/**
 * Maps an ada-audit lifecycle status to a StatusPill tone BY COLOR, not by word,
 * so operational surfaces stay pixel-stable: a running audit keeps its amber via
 * the `warning` tone, and LiveAuditTable's `redirected` keeps its blue via the
 * `running` tone. See docs/superpowers/…/2026-07-08-app-shell-pr5… §5.
 *
 * `pending` and `cancelled` fall to `neutral` (gray) deliberately: `pending` is
 * already gray in QueueMemberRow/LiveAuditTable (canonicalized — the amber-pending
 * in ClientsAuditSummary was an inconsistency); `cancelled`'s slate→gray is
 * negligible.
 */
export function auditStatusTone(status: string): Tone {
  switch (status) {
    case 'complete':
      return 'success'
    case 'error':
      return 'error'
    case 'running':
    case 'pdfs-running':
    case 'lighthouse-running':
      return 'warning'
    case 'redirected':
      return 'running'
    default:
      return 'neutral'
  }
}
