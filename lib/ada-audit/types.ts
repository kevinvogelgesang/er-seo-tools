// Shared TypeScript interfaces for the ADA/WCAG accessibility audit tool.
// These mirror axe-core's result shapes, narrowed to what we actually use.

export type ImpactLevel = 'critical' | 'serious' | 'moderate' | 'minor'

export interface AxeNode {
  html: string
  failureSummary?: string
  target?: string[]
}

export interface AxeViolation {
  id: string
  impact: ImpactLevel | null
  help: string
  description: string
  helpUrl: string
  tags: string[]
  nodes: AxeNode[]
}

/** Subset of axe-core AxeResults stored in the DB (nodes truncated to 20 per violation) */
export interface StoredAxeResults {
  violations: AxeViolation[]
  passes: { id: string; help: string; nodes: { html: string }[] }[]
  incomplete: { id: string; help: string; impact: ImpactLevel | null; nodes: AxeNode[] }[]
  inapplicable: { id: string; help: string }[]
  timestamp: string
  url: string
  testEngine: { name: string; version: string }
  testRunner: { name: string }
}

/** Violation counts by impact level */
export interface AuditScorecard {
  critical: number
  serious: number
  moderate: number
  minor: number
  total: number
  passed: number
  incomplete: number
}

/** Shape returned by GET /api/ada-audit (list item) */
export interface AuditListItem {
  id: string
  createdAt: string
  url: string
  status: string
  error: string | null
  clientId: number | null
  clientName: string | null
  scorecard: AuditScorecard | null
}

/** Shape returned by GET /api/ada-audit/[id] */
export interface AuditDetail {
  id: string
  createdAt: string
  url: string
  status: string
  error: string | null
  clientId: number | null
  clientName: string | null
  results: StoredAxeResults | null
}
