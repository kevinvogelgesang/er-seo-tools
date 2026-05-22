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
  requestedBy: string | null
  startedAt: string | null
  completedAt: string | null
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
  finalUrl?: string | null
  redirected?: boolean
}

// ─── Site audit types ─────────────────────────────────────────────────────────

export interface SitePagePdfState {
  total: number      // PdfAudit rows attached to this page
  complete: number   // status === 'complete'
  errored: number    // status === 'error'
  withIssues: number // complete + issues.length > 0
}

/**
 * One row rendered in the live-children table while a SiteAudit is in flight.
 * Computed at request time in buildLiveChildren() — never persisted.
 *
 * Deliberately omits any timestamp field: the route returns rows in
 * createdAt desc already, and these rows never get re-written between
 * fetches, so exposing a timestamp would be misleading.
 */
export interface LiveAuditChild {
  adaAuditId: string
  url: string
  status: 'pending' | 'running' | 'complete' | 'error'
  scorecard: AuditScorecard | null  // null until status === 'complete'
  error: string | null              // populated when status === 'error'
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
  skipped: number
  withIssues: number
}

export type PdfAuditStatus = 'pending' | 'scanning' | 'complete' | 'error' | 'skipped'
export type PdfSkipReason = 'oversize'

/** Landmark elements we surface as shared-ancestor hints in common-issue callouts. */
export type LandmarkTag = 'header' | 'footer' | 'nav' | 'aside' | 'main'

/** How confidently we believe a common issue's nodes share a single landmark ancestor. */
export type AncestorConfidence = 'all' | 'majority'

/** Tier expresses how strongly the cross-page frequency suggests a template/shared origin.
 *  - 'template'  → ≥80% of scanned pages: almost certainly one fix in a global template.
 *  - 'common'    → ≥50%: likely a shared component or recurring layout block.
 *  - 'recurring' → ≥25%: may be a recurring element on a page type or template variant. */
export type CommonIssueTier = 'template' | 'common' | 'recurring'

/** A rule that appears on >= COMMON_ISSUE_THRESHOLD of the scanned pages.
 *  Stored as part of SiteAuditSummary.commonIssues; rendered by CommonIssueCallout. */
export interface CommonIssue {
  ruleId: string
  impact: ImpactLevel
  help: string
  description: string
  helpUrl: string
  affectedPagesCount: number
  totalPagesScanned: number
  sharedAncestor: LandmarkTag | null
  ancestorConfidence: AncestorConfidence | null  // null when sharedAncestor is null
  /** Frequency tier. Older audits (predating the tier rollout) may omit this — consumers
   *  should treat a missing field as 'template' since the old detector only emitted ≥80% rows. */
  tier?: CommonIssueTier
}

/** Stored in SiteAudit.summary — computed once when all pages + PDFs finish */
export interface SiteAuditSummary {
  aggregate: AuditScorecard
  pdfsAggregate: SiteAuditPdfAggregate
  pages: SitePageResult[]  // sorted by scorecard.total descending
  /** Issues that hit >= threshold of complete pages, with shared-ancestor hint.
   *  Older audits (rows where summary JSON predates this feature) lack the
   *  field; consumers should default to []. */
  commonIssues?: CommonIssue[]
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
  pdfsSkipped?: number
  lighthouseTotal: number
  lighthouseComplete: number
  lighthouseError: number
  requestedBy: string | null
  startedAt: string | null
  completedAt: string | null
  /** Optional — present only when the audit is in a running state. */
  liveChildren?: LiveAuditChild[]
}

// ── Pagination ─────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  items: T[]
  totalCount: number
  page: number
  pageSize: number
}

// ── Client audit summary (Clients view on /ada-audit) ──────────────────────

export interface ClientAuditSummary {
  clientId: number
  clientName: string
  firstDomain: string | null
  latestSiteAudit: {
    id: string
    createdAt: string                 // ISO
    score: number | null
    pagesTotal: number
    pagesError: number
    summary: SiteAuditSummary | null
  } | null
}

// ── Audit batches ──────────────────────────────────────────────────────────

export interface AuditBatchSummary {
  id: string
  startedAt: string          // ISO
  closedAt: string           // ISO (always non-null in list responses)
  label: string              // resolved auto-label if DB column is null
  auditCount: number
  completeCount: number
  errorCount: number
}

export interface AuditBatchMember {
  id: string
  domain: string
  clientId: number | null
  clientName: string | null
  status: string             // queued | running | pdfs-running | lighthouse-running | complete | error
  pagesTotal: number
  pagesComplete: number
  pagesError: number
  score: number | null
  createdAt: string          // ISO
  startedAt: string | null
  completedAt: string | null
}

export interface AuditBatchDetail {
  id: string
  startedAt: string          // ISO
  closedAt: string | null    // null when this is the open batch
  label: string
  members: AuditBatchMember[]
}

// Shape returned by GET /api/site-audit/queue.
// `batch` describes the currently open batch (null when queue is drained).
// `clientId` on each active/queued row lets the Clients section drive
// in-flight chips by client id rather than fragile domain string compare.
// `status` on the active row lets consumers distinguish `running` from
// `pdfs-running` (so the chip can read "Running" vs "Scanning PDFs").
export interface QueueStatusWithBatch {
  active: {
    id: string
    domain: string
    status: string             // running | pdfs-running | lighthouse-running | pending
    pagesTotal: number
    pagesComplete: number
    pagesError: number
    pdfsTotal: number
    pdfsComplete: number
    pdfsError: number
    pdfsSkipped: number
    lighthouseTotal: number
    lighthouseComplete: number
    lighthouseError: number
    clientId: number | null
  } | null
  queued: {
    id: string
    domain: string
    position: number
    clientId: number | null
  }[]
  batch: {
    id: string
    startedAt: string
    label: string
  } | null
}
