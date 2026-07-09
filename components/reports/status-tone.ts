import type { Tone } from '@/components/ui/StatusPill'

/**
 * Maps a report / report-batch lifecycle status to a StatusPill tone BY COLOR,
 * not by word, so the reports surface stays color-stable when the hand-rolled
 * chips adopt the shared primitive (A8 per-tool polish, spec §8; PR-5 recipe).
 *
 * Report status vocabulary: `queued` | `fetching` | `rendering` | `ready` |
 * `error`. Batch status vocabulary: `running` | `complete` | `error`.
 *
 * Color preservation vs the previous inline chips:
 *   - `ready`/`complete` were green  → `success`
 *   - `error` was red                → `error`
 *   - `running` (batch) was blue     → `running`
 *   - transient `queued`/`fetching`/`rendering` were blue (the report chip's
 *     else-branch) → `running` (blue preserved)
 * `default` → `neutral`: the batch chip already fell back to gray for unknowns;
 * the report chip's blue else-branch only ever caught the three transient
 * statuses above (all mapped explicitly), so a truly-unknown value going gray
 * is a dead-branch nicety, not a live color change.
 */
export function reportStatusTone(status: string): Tone {
  switch (status) {
    case 'ready':
    case 'complete':
      return 'success'
    case 'error':
      return 'error'
    case 'running':
    case 'queued':
    case 'fetching':
    case 'rendering':
      return 'running'
    default:
      return 'neutral'
  }
}
