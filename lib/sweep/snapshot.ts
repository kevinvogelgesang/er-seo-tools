// lib/sweep/snapshot.ts
//
// Task 8 (D8 weekly client sweep): the snapshot loader + compute + race-safe
// publish. Consumes the Task 6 coverage classifier and Task 7 change-state
// builder, loads per-member evidence from the findings tables (NEVER origin
// blobs), and freezes the complete render payload the digest email AND /issues
// both serve.
//
// Binding decisions (Codex-reviewed brief):
// - Run selection: crawlRun.findUnique({ siteAuditId_tool }) — the C6 compound
//   unique, never findFirst (Codex plan-fix #13).
// - ADA pair: page-scope findings grouped by type; affectedCount = distinct
//   affected pages; severity = max; title from Violation.help (fallback type id);
//   attributionComplete: true by construction.
// - SEO pair: run-scope findings are the authoritative aggregates; title from
//   Finding.detail.description (fallback type id); pair attributionComplete iff
//   EVERY run-scope finding has affectedComplete === true (null = legacy/sample =
//   incomplete, Codex plan-fix #8); a per-group `approximate` flag mirrors the
//   same three-state rule for "≥n" rendering.
// - Unit map exhaustive (Codex plan-fix #15); unknown future type → 'groups' +
//   a logged warning, never a silent guess.
// - baselineAvailable = the pair appears in the immediate predecessor's coverage
//   with a NON-failed state, OR in its semanticKeys. A failed predecessor week is
//   NOT a baseline (it observed nothing) — using it would let a comparable pair
//   falsely claim 'new'. This tightens the brief's "coverage OR semanticKeys"
//   shorthand to the PairCoverage type's own documented meaning ("observed").
// - Shared-domain members load their audit ONCE (dedup by siteAuditId) and emit
//   per-client groups for every member sharing it.
// - publishSweepSnapshot: updateMany fenced on snapshotJson null; on 0 rows the
//   racer re-reads and returns the WINNER's payload (Codex plan-fix #5).
// - loadPreviousSnapshot: EXACT scheduledFor − 7 days only; missing/corrupt → null.

import type { WeeklySweep } from '@prisma/client'
import { prisma } from '@/lib/db'
import { logError } from '@/lib/log'
import { classifyCoverage, type PairObservation } from './classify'
import { buildIssueGroups, type RawGroup } from './issue-groups'
import { findingUnit } from '@/lib/findings/finding-type-sets'
import {
  parseMembership,
  parseSnapshot,
  type CoverageState,
  type IssueGroup,
  type IssueUnit,
  type MemberOutcome,
  type PairCoverage,
  type ResolvedIssueGroup,
  type SweepSnapshot,
  type SweepTool,
} from './types'

// ---------------------------------------------------------------------------
// Loader contract (injectable for tests)
// ---------------------------------------------------------------------------

type Severity = 'critical' | 'warning' | 'notice'

/** One current issue-group observation keyed to an audit (no client identity). */
export interface LoadedGroup {
  tool: SweepTool
  type: string
  title: string
  severity: Severity
  affectedCount: number
  unit: IssueUnit
  approximate: boolean
  liveScanRunId: string | null
}

/** Per-tool run state + observed groups for one audit. */
export interface ToolLoad {
  runPresent: boolean
  runId: string | null
  runStatus: string | null
  attributionComplete: boolean | null
  groups: LoadedGroup[]
}

/** Everything computeSweepSnapshot needs about one SiteAudit (loaded once). */
export interface AuditLoad {
  discoveryCapped: boolean
  pagesError: number // SiteAudit.pagesError — shared by both tool pairs
  ada: ToolLoad
  seo: ToolLoad
}

export interface SnapshotDeps {
  loadAudit: (siteAuditId: string) => Promise<AuditLoad>
}

const TOOLS: readonly SweepTool[] = ['ada-audit', 'seo-parser']
const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, notice: 2 }
const RANK_TO_SEVERITY: readonly Severity[] = ['critical', 'warning', 'notice']

function toSeverity(raw: string): Severity {
  return raw === 'critical' || raw === 'warning' || raw === 'notice' ? raw : 'warning'
}

// ---------------------------------------------------------------------------
// Unit map (exhaustive, Codex plan-fix #15)
// ---------------------------------------------------------------------------

function unitForType(tool: SweepTool, type: string): IssueUnit {
  // The type→unit knowledge lives in ONE place (finding-type-sets.findingUnit)
  // so the on-page/broken/validation/dead_page maps can't drift from the
  // results-page sections. `null` = genuinely unknown future type.
  const unit = findingUnit(tool, type)
  if (unit) return unit
  // Unknown future type — never a silent guess.
  logError(
    { event: 'sweep_unmapped_issue_unit', tool, type },
    new Error('[sweep] unmapped issue unit'),
  )
  return 'groups'
}

// ---------------------------------------------------------------------------
// Default loader (real prisma reads)
// ---------------------------------------------------------------------------

function parseDescription(detail: string | null): string | null {
  if (!detail) return null
  try {
    const obj = JSON.parse(detail)
    return typeof obj?.description === 'string' && obj.description ? obj.description : null
  } catch {
    return null
  }
}

async function loadAdaTool(runId: string | null, runStatus: string | null): Promise<ToolLoad> {
  if (!runId) return { runPresent: false, runId: null, runStatus: null, attributionComplete: true, groups: [] }
  const [findings, violations] = await Promise.all([
    prisma.finding.findMany({
      where: { runId, scope: 'page' },
      select: { type: true, severity: true, url: true, pageId: true },
    }),
    prisma.violation.findMany({
      where: { runId },
      select: { ruleId: true, help: true },
      distinct: ['ruleId'],
    }),
  ])
  const helpByRule = new Map(violations.map((v) => [v.ruleId, v.help]))

  // Group page-scope findings by type: affectedCount = distinct pages, severity = max.
  const byType = new Map<string, { minRank: number; pages: Set<string> }>()
  for (const f of findings) {
    const g = byType.get(f.type) ?? { minRank: SEVERITY_RANK.notice, pages: new Set<string>() }
    g.pages.add(f.pageId ?? f.url ?? '')
    const rank = SEVERITY_RANK[toSeverity(f.severity)]
    if (rank < g.minRank) g.minRank = rank
    byType.set(f.type, g)
  }
  const groups: LoadedGroup[] = [...byType.entries()].map(([type, g]) => ({
    tool: 'ada-audit',
    type,
    title: helpByRule.get(type) ?? type,
    severity: RANK_TO_SEVERITY[g.minRank] ?? 'warning',
    affectedCount: g.pages.size,
    unit: unitForType('ada-audit', type),
    approximate: false, // ADA page-scope rows are complete by construction
    liveScanRunId: null,
  }))
  return { runPresent: true, runId, runStatus, attributionComplete: true, groups }
}

async function loadSeoTool(runId: string | null, runStatus: string | null): Promise<ToolLoad> {
  if (!runId) return { runPresent: false, runId: null, runStatus: null, attributionComplete: true, groups: [] }
  const findings = await prisma.finding.findMany({
    where: { runId, scope: 'run' },
    select: { type: true, severity: true, count: true, detail: true, affectedComplete: true },
  })
  // Pair is attribution-complete only if EVERY group is complete (three-state:
  // null = legacy/sample = incomplete). Empty findings → clean scan → complete.
  const attributionComplete = findings.every((f) => f.affectedComplete === true)
  const groups: LoadedGroup[] = findings.map((f) => ({
    tool: 'seo-parser',
    type: f.type,
    title: parseDescription(f.detail) ?? f.type,
    severity: toSeverity(f.severity),
    affectedCount: f.count,
    unit: unitForType('seo-parser', f.type),
    approximate: f.affectedComplete !== true,
    liveScanRunId: runId,
  }))
  return { runPresent: true, runId, runStatus, attributionComplete, groups }
}

export async function loadAuditForSnapshot(siteAuditId: string): Promise<AuditLoad> {
  const [audit, adaRun, seoRun] = await Promise.all([
    prisma.siteAudit.findUnique({ where: { id: siteAuditId }, select: { discoveryCapped: true, pagesError: true } }),
    prisma.crawlRun.findUnique({
      where: { siteAuditId_tool: { siteAuditId, tool: 'ada-audit' } },
      select: { id: true, status: true },
    }),
    prisma.crawlRun.findUnique({
      where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } },
      select: { id: true, status: true },
    }),
  ])
  const [ada, seo] = await Promise.all([
    loadAdaTool(adaRun?.id ?? null, adaRun?.status ?? null),
    loadSeoTool(seoRun?.id ?? null, seoRun?.status ?? null),
  ])
  return { discoveryCapped: audit?.discoveryCapped === true, pagesError: audit?.pagesError ?? 0, ada, seo }
}

const defaultDeps: SnapshotDeps = { loadAudit: loadAuditForSnapshot }

// ---------------------------------------------------------------------------
// compute
// ---------------------------------------------------------------------------

function pairKey(clientId: number, domain: string, tool: SweepTool): string {
  return `${clientId}\x00${domain}\x00${tool}`
}

// A cohort member that never produced an audit (pending/error/skipped-conflict/
// invalid-domain) → failed coverage with an outcome-derived reason.
function reasonForNoAudit(outcome: MemberOutcome): string {
  switch (outcome) {
    case 'pending':
      return 'not-scanned'
    case 'error':
      return 'scan-error'
    case 'skipped-conflict':
      return 'scan-conflict'
    case 'invalid-domain':
      return 'invalid-domain'
    default:
      return 'run-missing'
  }
}

function reasonFor(state: CoverageState, obs: PairObservation): string | null {
  if (state === 'failed') return 'run-missing'
  if (state === 'partial') {
    if (obs.discoveryCapped) return 'crawl-capped'
    if (obs.pagesError > 0) return 'pages-errored' // retires the false 'timed-out'
    if (!obs.attributionComplete) return 'attribution-incomplete'
    return 'coverage-capped' // runStatus 'partial' with no pagesError (verifier-capped)
  }
  return null
}

export async function computeSweepSnapshot(
  sweep: WeeklySweep,
  previous: SweepSnapshot | null,
  now: Date,
  deps: SnapshotDeps = defaultDeps,
): Promise<SweepSnapshot> {
  const membership = parseMembership(sweep.membershipJson)
  const members = membership?.members ?? []
  const expected = membership?.expectedCount ?? 0
  const snapshotAt = now.toISOString()

  // Baseline pairs from the immediate predecessor (non-failed coverage OR keys).
  const baselinePairs = new Set<string>()
  if (previous) {
    for (const c of previous.coverage) {
      if (c.state !== 'failed') baselinePairs.add(pairKey(c.clientId, c.domain, c.tool))
    }
    for (const k of previous.semanticKeys) baselinePairs.add(pairKey(k.clientId, k.domain, k.tool))
  }

  // Load each audit ONCE (shared-domain members reuse the same promise).
  const auditCache = new Map<string, Promise<AuditLoad>>()
  const loadAudit = (id: string): Promise<AuditLoad> => {
    let p = auditCache.get(id)
    if (!p) {
      p = deps.loadAudit(id)
      auditCache.set(id, p)
    }
    return p
  }

  const coverage: PairCoverage[] = []
  const raw: RawGroup[] = []

  for (const m of members) {
    if (!m.siteAuditId) {
      // Only archived/delisted members are OUT of cohort — the client left scope
      // before the scan, so they emit no coverage rows (they still count toward
      // `expected`). Every OTHER audit-less member (pending/error/skipped-conflict/
      // invalid-domain) IS in cohort but produced no scan: both tools classify
      // `failed` so prior issues go stale and failedDomains counts the pair.
      if (m.outcome === 'skipped-archived' || m.outcome === 'skipped-delisted') continue
      for (const tool of TOOLS) {
        const baselineAvailable = baselinePairs.has(pairKey(m.clientId, m.domain, tool))
        const { state } = classifyCoverage(null, baselineAvailable)
        coverage.push({
          clientId: m.clientId,
          domain: m.domain,
          tool,
          state,
          reason: reasonForNoAudit(m.outcome),
          baselineAvailable,
          siteAuditId: null,
          runId: null,
        })
      }
      continue
    }
    const load = await loadAudit(m.siteAuditId)
    for (const tool of TOOLS) {
      const tl = tool === 'ada-audit' ? load.ada : load.seo
      const obs: PairObservation = {
        runPresent: tl.runPresent,
        runStatus: tl.runStatus,
        discoveryCapped: load.discoveryCapped,
        attributionComplete: tl.attributionComplete,
        pagesError: load.pagesError,
      }
      const baselineAvailable = baselinePairs.has(pairKey(m.clientId, m.domain, tool))
      const { state } = classifyCoverage(obs, baselineAvailable)
      coverage.push({
        clientId: m.clientId,
        domain: m.domain,
        tool,
        state,
        reason: reasonFor(state, obs),
        baselineAvailable,
        siteAuditId: m.siteAuditId,
        runId: tl.runId,
      })
      if (state === 'failed') continue // no raw claims possible
      for (const g of tl.groups) {
        raw.push({
          clientId: m.clientId,
          clientName: m.clientName,
          domain: m.domain,
          tool: g.tool,
          type: g.type,
          title: g.title,
          severity: g.severity,
          affectedCount: g.affectedCount,
          unit: g.unit,
          approximate: g.approximate,
          siteAuditId: m.siteAuditId,
          liveScanRunId: g.liveScanRunId,
        })
      }
    }
  }

  const { groups, staleGroups, resolvedGroups, semanticKeys } = buildIssueGroups({
    raw,
    previous: previous
      ? { keys: previous.semanticKeys, groups: previous.groups, staleGroups: previous.staleGroups }
      : null,
    coverage,
    snapshotAt,
  })

  const totals = computeTotals({ groups, resolvedGroups, coverage, expected, previous })
  const shortlist = buildShortlist(groups)

  return { v: 1, snapshotAt, totals, coverage, groups, staleGroups, resolvedGroups, shortlist, semanticKeys }
}

// ---------------------------------------------------------------------------
// totals
// ---------------------------------------------------------------------------

// Domain rollup rank: worst wins. failed > partial > comparable > first-baseline
// (a first-baseline-only domain is a clean scan without a bucket; any comparable
// tool makes the domain comparable-quality).
const DOMAIN_RANK: Record<CoverageState, number> = {
  'first-baseline': 0,
  comparable: 1,
  partial: 2,
  failed: 3,
}

function computeTotals(input: {
  groups: IssueGroup[]
  resolvedGroups: ResolvedIssueGroup[]
  coverage: PairCoverage[]
  expected: number
  previous: SweepSnapshot | null
}): SweepSnapshot['totals'] {
  const { groups, resolvedGroups, coverage, expected, previous } = input
  const nonNotice = (s: { severity: Severity }) => s.severity !== 'notice'

  const actionable = groups.filter(nonNotice).length
  const comparablePairs = coverage.filter((c) => c.state === 'comparable').length
  const newCount = groups.filter((g) => nonNotice(g) && g.changeState === 'new').length
  const worsenedCount = groups.filter((g) => nonNotice(g) && g.changeState === 'worsened').length
  const resolvedCount = resolvedGroups.filter(nonNotice).length

  // Domain granularity = worst tool state.
  const domainWorst = new Map<string, number>()
  for (const c of coverage) {
    const k = `${c.clientId}\x00${c.domain}`
    domainWorst.set(k, Math.max(domainWorst.get(k) ?? -1, DOMAIN_RANK[c.state]))
  }
  let comparableDomains = 0
  let partialDomains = 0
  let failedDomains = 0
  for (const r of domainWorst.values()) {
    if (r === DOMAIN_RANK.comparable) comparableDomains++
    else if (r === DOMAIN_RANK.partial) partialDomains++
    else if (r === DOMAIN_RANK.failed) failedDomains++
  }
  const scanned = domainWorst.size

  // Delta: net change in actionable-severity issue identities over the pairs
  // that are comparable THIS week. Counting identities on both sides (current
  // vs prior over the SAME pairs) — rather than new − resolved — also captures
  // notice↔actionable severity transitions, which new/resolved alone miss.
  // `null` when there are no comparable pairs (nothing to compare against;
  // comparable requires a baseline, so this also covers the first-sweep case).
  let delta: number | null = null
  if (comparablePairs > 0) {
    const comparablePairKeys = new Set<string>()
    for (const c of coverage) {
      if (c.state === 'comparable') comparablePairKeys.add(pairKey(c.clientId, c.domain, c.tool))
    }
    const currentActionable = groups.filter(
      (g) => nonNotice(g) && g.coverageState === 'comparable',
    ).length
    let priorActionable = 0
    for (const k of previous?.semanticKeys ?? []) {
      if (k.severity !== 'notice' && comparablePairKeys.has(pairKey(k.clientId, k.domain, k.tool))) {
        priorActionable++
      }
    }
    delta = currentActionable - priorActionable
  }

  return {
    actionable,
    delta,
    comparablePairs,
    newCount,
    worsenedCount,
    resolvedCount,
    scanned,
    expected,
    comparableDomains,
    partialDomains,
    failedDomains,
  }
}

// ---------------------------------------------------------------------------
// shortlist — deterministic tuple sort (Codex plan-fix #16)
// ---------------------------------------------------------------------------

const CHANGE_PRIORITY: Record<'new' | 'worsened', number> = { new: 0, worsened: 1 }

function buildShortlist(groups: IssueGroup[]): IssueGroup[] {
  const eligible = groups.filter(
    (g) => g.severity !== 'notice' && (g.changeState === 'new' || g.changeState === 'worsened'),
  )
  eligible.sort(
    (a, b) =>
      CHANGE_PRIORITY[a.changeState as 'new' | 'worsened'] - CHANGE_PRIORITY[b.changeState as 'new' | 'worsened'] ||
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      b.affectedCount - a.affectedCount ||
      a.clientId - b.clientId ||
      a.domain.localeCompare(b.domain) ||
      a.tool.localeCompare(b.tool) ||
      a.type.localeCompare(b.type),
  )
  return eligible.slice(0, 3)
}

// ---------------------------------------------------------------------------
// publish (race-safe) + previous loader
// ---------------------------------------------------------------------------

export async function publishSweepSnapshot(sweepId: number, snapshot: SweepSnapshot): Promise<SweepSnapshot> {
  const json = JSON.stringify(snapshot)
  const { count } = await prisma.weeklySweep.updateMany({
    where: { id: sweepId, snapshotJson: null },
    data: { snapshotJson: json, snapshotAt: new Date() },
  })
  if (count === 0) {
    const row = await prisma.weeklySweep.findUnique({ where: { id: sweepId } })
    const winner = parseSnapshot(row?.snapshotJson ?? null)
    if (!winner) throw new Error('[sweep] snapshot publish raced but winner unreadable')
    return winner
  }
  return snapshot
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export async function loadPreviousSnapshot(scheduledFor: Date): Promise<SweepSnapshot | null> {
  const prevSlot = new Date(scheduledFor.getTime() - WEEK_MS)
  const row = await prisma.weeklySweep.findUnique({ where: { scheduledFor: prevSlot } })
  return parseSnapshot(row?.snapshotJson ?? null)
}
