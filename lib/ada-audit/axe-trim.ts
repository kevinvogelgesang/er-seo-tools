// lib/ada-audit/axe-trim.ts — C13 in-page axe result trim.
//
// INJECTED INTO THE AUDITED PAGE via `.toString()` interpolation inside the
// runner's page.evaluate string (same contract as seo/parse-seo-dom.ts):
//   • MUST reference NOTHING from module scope — only its parameter and
//     JS built-ins available in every browser (Array.isArray).
//   • MUST NOT emit an escaping SWC helper at es2017. `typeof` compiles to a
//     module-scope `_type_of` helper (in-page ReferenceError — commit cc8d1c1);
//     object spread emits `_object_spread`. Both are banned here. Guarded by
//     the source-string test in axe-trim.test.ts.
//
// WHY: axe-core's `no-passes` reporter silently forces resultTypes to
// ['violations'], stripping BOTH passes and incomplete from results — which
// zeroed every "rules passed"/"needs review" count and killed scoring-v2's
// incomplete penalty fleet-wide (C13 root cause). The runner now uses the 'v2'
// reporter (which honors resultTypes) and trims IN-PAGE, before the
// browser→Node serialization: full passes/inapplicable rule lists would
// otherwise cross the CDP wire ~50 rules per page just to be thrown away.
// `incomplete` is deliberately KEPT — it feeds the needs-review UI list and
// the v2 score's incomplete penalty (nodes are capped later, in Node).

interface TrimmableAxeResults {
  violations: unknown[]
  passes?: unknown[]
  incomplete?: unknown[]
  inapplicable?: unknown[]
  passCount?: number
}

export function trimAxeResultsForStorage<T extends TrimmableAxeResults>(results: T): T {
  results.passCount = Array.isArray(results.passes) ? results.passes.length : 0
  delete results.passes
  delete results.inapplicable
  return results
}
