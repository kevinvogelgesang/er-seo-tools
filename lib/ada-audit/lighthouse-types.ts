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
  category: LighthouseCategory  // 'performance' | 'best-practices' only — a11y has its own section
}

export interface LighthouseA11yFailingElement {
  snippet: string           // HTML, e.g. '<div role="codeblock-dropdown" class="...">'
  selector?: string         // CSS selector path, when LH provides one
}

export interface LighthouseA11yAudit {
  id: string                // 'aria-valid-attr-value'
  title: string             // '[role] values are not valid'
  description: string       // long-form explanation
  failingElements: LighthouseA11yFailingElement[]
}

export interface LighthouseA11yGroup {
  id: string                // 'a11y-aria'
  title: string             // 'ARIA'
  description: string       // 'These are opportunities to improve ARIA usage…'
  audits: LighthouseA11yAudit[]
}

export interface LighthouseAccessibility {
  score: number             // 0–100; mirrors scores.accessibility for section header
  groups: LighthouseA11yGroup[]
}

export interface LighthouseSummary {
  scores: LighthouseScores
  cwv: LighthouseCwv
  topFailures: LighthouseFailure[]  // up to 5, performance + best-practices only
  accessibility?: LighthouseAccessibility  // optional for backwards compatibility with old stored summaries
}
