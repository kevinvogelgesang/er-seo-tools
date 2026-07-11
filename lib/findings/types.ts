// lib/findings/types.ts
//
// THE source-agnostic crawl-ingestion contract (C5). An "adapter" is any
// producer of crawl data — the SF-CSV pipeline (parsers + aggregator +
// seo-mapper) is adapter #1; the C6 live scan becomes adapter #2. Every
// adapter produces one FindingsBundle per run and persists it via
// writeFindingsRun() — fire-and-forget AFTER its legacy commit (or as its
// only write for blob-less sources).
//
// Adapter rules (all enforced by convention + parity, not the compiler):
// - URLs: every CrawlPageInput.url and page-scope FindingInput.url goes
//   through normalizeFindingUrl(); pages dedupe keep-first by normalized URL.
// - Dedup keys: runFindingKey(type) / pageFindingKey(type, url) from
//   keys.ts — never hand-rolled.
// - Severity vocabulary: exactly critical | warning | notice.
// - Issue shape: one run-scope finding per type (count + detail JSON
//   {description}) plus page-scope findings per affected URL carrying
//   affectedComplete/affectedSource.
// - Score: the adapter computes it; CrawlRun.score is the canonical
//   cross-source score (readers never depend on origin-row scores).
// - Origin: exactly ONE origin FK (writer-enforced). Origin FKs are each
//   @unique — one CrawlRun per origin row. C6 NOTE: a live-SEO run sharing
//   a SiteAudit origin with the ADA run requires removing @unique from
//   siteAuditId, adding @@unique([siteAuditId, tool]), and re-keying
//   writer.ts + every findUnique({ where: { siteAuditId } }) reader to
//   { siteAuditId, tool } — that migration ships IN the C6 PR that
//   introduces the second run, before any live-scan dual-write.
//
// Ids are pre-generated (crypto.randomUUID) so rows can cross-reference
// before insert — createMany cannot return ids.

export interface CrawlRunInput {
  id: string
  tool: 'seo-parser' | 'ada-audit'
  source: 'sf-upload' | 'site-audit' | 'page-audit' | 'live-scan'
  domain: string | null
  clientId: number | null
  sessionId: string | null
  siteAuditId: string | null
  adaAuditId: string | null
  status: 'complete' | 'partial'
  score: number | null
  scoreBreakdown?: string | null   // JSON breakdown; sf-upload + live-scan (v1) and ada-audit (v2) runs
  discoveryCoverageJson?: string | null   // C6 hybrid-discovery: live-scan runs only
  reachabilityJson?: string | null   // roadmap 3b: reachability metrics; live-scan runs only
  contentSimilarityJson?: string | null   // C6 Phase 5: near/exact-duplicate groups; live-scan runs only
  schemaTypesJson?: string | null       // C14: aggregate schema-type histogram (live-scan runs only)
  programEntitiesJson?: string | null   // KS-3: JSON-LD program {name,url} pairs (live-scan runs only)
  wcagLevel: string | null
  pagesTotal: number
  startedAt: Date | null
  completedAt: Date | null
  /** true = this run was produced by the autonomous SEO pipeline */
  seoIntent?: boolean
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
  inlinks?: number | null
  outlinks?: number | null
  indexable: boolean | null
  score: number | null
  passCount: number | null
  incompleteCount: number | null
  faqEvidence: string | null // KS-4 tri-state grammar; null = unknown. REQUIRED so every producer takes a position.
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
