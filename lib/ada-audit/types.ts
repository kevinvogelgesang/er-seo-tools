// Shared TypeScript interfaces for the ADA/WCAG accessibility audit tool.
// These mirror axe-core's result shapes, narrowed to what we actually use.

import type { LighthouseSummary } from './lighthouse-types'
import type { PdfIssue } from './pdf-types'

/** Per-PDF row returned by the audit detail endpoints */
export interface AuditPdfRow {
  url: string
  fileSize: number | null
  pageCount: number | null
  issues: PdfIssue[]
  scanError: string | null
}

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
  /** Filename of the element screenshot (e.g. "color-contrast.png"), set when captureScreenshots is enabled */
  screenshotPath?: string
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
  /** Total DOM elements found in the page snapshot. Low values (<50) suggest a JS-rendered SPA. */
  domElementCount?: number
  /** Whether screenshot capture was enabled for this audit */
  captureScreenshots?: boolean
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
  progress: number
  progressMessage: string
  runnerType: string
  lighthouseSummary?: LighthouseSummary | null
  lighthouseError?: string | null
  pdfs?: AuditPdfRow[]
}

// ─── Site audit types ─────────────────────────────────────────────────────────

export interface SitePagePdfState {
  total: number      // PdfAudit rows attached to this page
  complete: number   // status === 'complete'
  errored: number    // status === 'error'
  withIssues: number // complete + issues.length > 0
}

/** Per-page summary row inside SiteAuditSummary.pages */
export interface SitePageResult {
  adaAuditId: string
  url: string
  status: 'complete' | 'error'
  error: string | null
  scorecard: AuditScorecard | null
  lighthouse: LighthouseSummary | null   // null if LH disabled / errored for this page
  pdfs: SitePagePdfState                  // zero-valued when no PDFs harvested
}

export interface SiteAuditPdfAggregate {
  total: number
  complete: number
  errored: number
  withIssues: number
}

/** Stored in SiteAudit.summary — computed once when all pages + PDFs finish */
export interface SiteAuditSummary {
  aggregate: AuditScorecard
  pdfsAggregate: SiteAuditPdfAggregate
  pages: SitePageResult[]  // sorted by scorecard.total descending
}

/** Shape returned by GET /api/site-audit (list) and GET /api/site-audit/[id] */
export interface SiteAuditDetail {
  id: string
  createdAt: string
  domain: string
  status: string
  error: string | null
  clientId: number | null
  clientName: string | null
  pagesTotal: number
  pagesComplete: number
  pagesError: number
  summary: SiteAuditSummary | null
  pdfs?: AuditPdfRow[]
  pdfsTotal?: number
  pdfsComplete?: number
  pdfsError?: number
}
