// lib/sweep/classify.ts
// Pure coverage classifier: per-(domain,tool) state derivation from a pair observation.

import type { CoverageState } from './types'

export interface PairObservation {
  runPresent: boolean // required tool run exists for this member's audit
  runStatus: string | null // CrawlRun.status ('complete' | 'partial' | ...)
  discoveryCapped: boolean // SiteAudit.discoveryCapped === true
  attributionComplete: boolean | null // Codex plan-fix #8: SEO run-scope groups need affectedComplete === true
  // (null = legacy/sample = INCOMPLETE); ADA page-scope rows are
  // complete by construction (the loader sets true for ada pairs)
}

/**
 * Classify a current pair observation against a baseline.
 *
 * Precedence (first match wins):
 * - null current OR !runPresent -> 'failed'
 * - capped / status 'partial' / !attributionComplete -> 'partial'
 * - runPresent && !baselineAvailable -> 'first-baseline'
 * - else -> 'comparable'
 *
 * baselineAvailable is INDEPENDENT of state: a 'partial' pair with a baseline
 * may still prove NEW; a 'partial' pair without one cannot (Task 7 consumes it).
 */
export function classifyCoverage(
  current: PairObservation | null,
  baselineAvailable: boolean,
): {
  state: CoverageState
  baselineAvailable: boolean // carried through (Codex plan-fix #9)
} {
  let state: CoverageState

  // Precedence 1: null current OR !runPresent -> 'failed'
  if (current === null || !current.runPresent) {
    state = 'failed'
  }
  // Precedence 2: capped / status 'partial' / !attributionComplete -> 'partial'
  else if (current.discoveryCapped || current.runStatus === 'partial' || !current.attributionComplete) {
    state = 'partial'
  }
  // Precedence 3: runPresent && !baselineAvailable -> 'first-baseline'
  else if (!baselineAvailable) {
    state = 'first-baseline'
  }
  // Precedence 4: else -> 'comparable'
  else {
    state = 'comparable'
  }

  return {
    state,
    baselineAvailable, // carried through unchanged
  }
}
