// lib/ada-audit/lighthouse-types.ts
//
// Stable subset of the Lighthouse report shape that the rest of the app cares
// about. Stored as a JSON string on AdaAudit.lighthouseSummary.

export type CwvStatus = 'pass' | 'needs-improvement' | 'fail'

export type LighthouseCategory = 'performance' | 'accessibility' | 'best-practices'

export interface LighthouseScores {
  performance: number       // 0–100
  accessibility: number     // 0–100
  bestPractices: number     // 0–100
}

export interface LighthouseCwv {
  lcp: number               // ms
  cls: number               // unitless
  tbt: number               // ms
  lcpStatus: CwvStatus
  clsStatus: CwvStatus
  tbtStatus: CwvStatus
}

export interface LighthouseFailure {
  id: string                // e.g. 'render-blocking-resources'
  title: string
  score: number | null      // 0–1 in raw LH; we copy as-is
  displayValue?: string
  category: LighthouseCategory
}

export interface LighthouseSummary {
  scores: LighthouseScores
  cwv: LighthouseCwv
  topFailures: LighthouseFailure[]  // up to 5
}
