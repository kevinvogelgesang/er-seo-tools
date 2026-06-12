// lib/findings/types.ts
//
// The in-memory row bundle every mapper produces and the writer persists.
// Ids are pre-generated (crypto.randomUUID) so rows can cross-reference
// before insert — createMany cannot return ids.

export interface CrawlRunInput {
  id: string
  tool: 'seo-parser' | 'ada-audit'
  source: 'sf-upload' | 'site-audit' | 'page-audit'
  domain: string | null
  clientId: number | null
  sessionId: string | null
  siteAuditId: string | null
  adaAuditId: string | null
  status: 'complete' | 'partial'
  score: number | null
  wcagLevel: string | null
  pagesTotal: number
  startedAt: Date | null
  completedAt: Date | null
}

export interface CrawlPageInput {
  id: string
  runId: string
  url: string
  status: string | null
  error: string | null
  finalUrl: string | null
  statusCode: number | null
  title: string | null
  h1: string | null
  metaDescription: string | null
  wordCount: number | null
  crawlDepth: number | null
  indexable: boolean | null
  score: number | null
  passCount: number | null
  incompleteCount: number | null
  adaAuditId: string | null
}

export interface FindingInput {
  id: string
  runId: string
  pageId: string | null
  scope: 'run' | 'page'
  type: string
  severity: 'critical' | 'warning' | 'notice'
  url: string | null
  count: number
  affectedComplete: boolean | null
  affectedSource: string | null
  detail: string | null
  dedupKey: string
}

export interface ViolationInput {
  id: string
  findingId: string
  runId: string
  pageId: string
  ruleId: string
  impact: string
  wcagTags: string
  help: string | null
  helpUrl: string | null
  nodeCount: number
  nodes: string | null
}

export interface FindingsBundle {
  run: CrawlRunInput
  pages: CrawlPageInput[]
  findings: FindingInput[]
  violations: ViolationInput[]
}
