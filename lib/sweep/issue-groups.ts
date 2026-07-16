// lib/sweep/issue-groups.ts
// Pure change-state / issue-group builder for the weekly client sweep (spec section4.3).
//
// Diffs this week's observed RawGroups against the immediate predecessor sweep's
// semantic keys + rendered groups, under per-(clientId,domain,tool) coverage, to
// produce the render-ready IssueGroup / staleGroup / resolvedGroup rows plus next
// week's SemanticKey baseline+streak store.
//
// Binding decisions (Codex-reviewed brief):
// - Identity key = (clientId, domain, tool, type); severity NOT in the key.
// - Out-of-cohort FIRST: prior keys/groups whose pair has no `coverage` entry are
//   dropped entirely -- never stale, never resolved.
// - failed pair -> its prior GROUPS become staleGroups ('stale', full render data +
//   lastObservedAt carried verbatim); no raw claims possible.
// - partial pair -> raw groups render positive states only; 'new' iff
//   baselineAvailable && no prior key, else with a prior key: count-up -> 'worsened',
//   otherwise -> 'detected' (NEVER 'fewer' -- no downward/absence claim); without a
//   baseline every group is 'new' (delta null, streak 1), never claims new-vs-prior.
//   Missing keys are NOT resolved.
// - comparable pair -> full vocabulary: no prior -> 'new'; up -> 'worsened' (+n);
//   down -> 'fewer' (-n); equal -> 'detected' (streak prev+1); prior key with no raw
//   group -> resolvedGroups (from the prior GROUP). Severity escalation (rank up) ->
//   'escalated' AND at-least-'worsened' (streak resets to 1); downgrade -> 'downgraded'
//   with the count-derived changeState. Severity transitions apply on comparable only.
// - semanticKeys emitted ONLY for currently observed live groups -- stale carry-forward
//   is intentional data loss: a failed/missing sweep breaks the consecutive streak.
// - lastObservedAt = snapshotAt on live rows; the prior group's on stale rows.
// - Deterministic output order: (clientId asc, domain asc, tool asc, type asc).

import type {
  SweepTool,
  IssueUnit,
  SemanticKey,
  IssueGroup,
  ResolvedIssueGroup,
  PairCoverage,
} from './types'

export interface RawGroup {
  // one current observation, loader-provided (Task 8)
  clientId: number
  clientName: string
  domain: string
  tool: SweepTool
  type: string
  title: string
  severity: 'critical' | 'warning' | 'notice'
  affectedCount: number
  unit: IssueUnit
  approximate: boolean
  siteAuditId: string | null
  liveScanRunId: string | null
}

const SEVERITY_RANK: Record<'critical' | 'warning' | 'notice', number> = {
  notice: 0,
  warning: 1,
  critical: 2,
}

function pairKey(clientId: number, domain: string, tool: SweepTool): string {
  return `${clientId}\x00${domain}\x00${tool}`
}

function identityKey(clientId: number, domain: string, tool: SweepTool, type: string): string {
  return `${clientId}\x00${domain}\x00${tool}\x00${type}`
}

function sortRows<T extends { clientId: number; domain: string; tool: SweepTool; type: string }>(
  rows: T[],
): T[] {
  return rows.slice().sort(
    (a, b) =>
      a.clientId - b.clientId ||
      a.domain.localeCompare(b.domain) ||
      a.tool.localeCompare(b.tool) ||
      a.type.localeCompare(b.type),
  )
}

export function buildIssueGroups(input: {
  raw: RawGroup[]
  previous: { keys: SemanticKey[]; groups: IssueGroup[]; staleGroups?: IssueGroup[] } | null
  coverage: PairCoverage[]
  snapshotAt: string
}): {
  groups: IssueGroup[]
  staleGroups: IssueGroup[]
  resolvedGroups: ResolvedIssueGroup[]
  semanticKeys: SemanticKey[]
} {
  const { raw, previous, coverage, snapshotAt } = input

  // --- coverage lookup by pair ---------------------------------------------
  const coverageByPair = new Map<string, PairCoverage>()
  for (const c of coverage) {
    coverageByPair.set(pairKey(c.clientId, c.domain, c.tool), c)
  }
  const inCohort = (clientId: number, domain: string, tool: SweepTool): boolean =>
    coverageByPair.has(pairKey(clientId, domain, tool))

  // --- previous, filtered out-of-cohort FIRST ------------------------------
  const prevKeys = (previous?.keys ?? []).filter((k) => inCohort(k.clientId, k.domain, k.tool))
  const prevGroups = (previous?.groups ?? []).filter((g) => inCohort(g.clientId, g.domain, g.tool))
  // A pair that was failed LAST week carried its issues as staleGroups (not live
  // groups / not semanticKeys). If it fails AGAIN this week those rows must
  // persist — otherwise a second consecutive failed week silently drops them.
  const prevStaleGroups = (previous?.staleGroups ?? []).filter((g) => inCohort(g.clientId, g.domain, g.tool))

  const prevKeyByIdentity = new Map<string, SemanticKey>()
  for (const k of prevKeys) {
    prevKeyByIdentity.set(identityKey(k.clientId, k.domain, k.tool, k.type), k)
  }

  // --- live groups from raw observations -----------------------------------
  const groups: IssueGroup[] = []
  const observedIdentities = new Set<string>()

  for (const r of raw) {
    const covEntry = coverageByPair.get(pairKey(r.clientId, r.domain, r.tool))
    // Missing coverage for an observed pair is an invariant violation; treat it as
    // first-baseline so we never emit a false diff claim.
    const state = covEntry?.state ?? 'first-baseline'
    if (state === 'failed') continue // no claims possible from a failed pair

    const baselineAvailable = covEntry?.baselineAvailable ?? false
    const identity = identityKey(r.clientId, r.domain, r.tool, r.type)
    observedIdentities.add(identity)
    const priorKey = prevKeyByIdentity.get(identity)

    let changeState: IssueGroup['changeState']
    let delta: number | null
    let streak: number
    let severityChanged: 'escalated' | 'downgraded' | null = null

    if (state === 'first-baseline') {
      changeState = 'new'
      delta = null
      streak = 1
    } else if (state === 'partial') {
      if (!baselineAvailable || !priorKey) {
        // never claims new-vs-prior
        changeState = 'new'
        delta = null
        streak = 1
      } else if (r.affectedCount > priorKey.affectedCount) {
        // count-up is a positive observation even under partial coverage
        changeState = 'worsened'
        delta = r.affectedCount - priorKey.affectedCount
        streak = 1
      } else {
        // equal or down -> positive re-observation only; NEVER 'fewer', no numeric claim
        changeState = 'detected'
        delta = null
        streak = priorKey.streak + 1
      }
    } else {
      // comparable -> full vocabulary
      if (!priorKey) {
        changeState = 'new'
        delta = null
        streak = 1
      } else {
        const diff = r.affectedCount - priorKey.affectedCount
        if (diff > 0) {
          changeState = 'worsened'
          delta = diff
          streak = 1
        } else if (diff < 0) {
          changeState = 'fewer'
          delta = diff
          streak = 1
        } else {
          changeState = 'detected'
          delta = 0
          streak = priorKey.streak + 1
        }

        // severity transition (comparable only)
        if (priorKey.severity !== r.severity) {
          if (SEVERITY_RANK[r.severity] > SEVERITY_RANK[priorKey.severity]) {
            severityChanged = 'escalated'
            if (changeState !== 'worsened') {
              // at-least-worsened, even on equal/down count — but the count did
              // NOT rise, so we must NOT fabricate a +n delta. WORSENED renders
              // without a number when delta is null (see components/issues/chips).
              changeState = 'worsened'
              delta = null
              streak = 1
            }
          } else {
            severityChanged = 'downgraded'
            // changeState stays count-derived
          }
        }
      }
    }

    groups.push({
      clientId: r.clientId,
      clientName: r.clientName,
      domain: r.domain,
      tool: r.tool,
      type: r.type,
      title: r.title,
      severity: r.severity,
      unit: r.unit,
      affectedCount: r.affectedCount,
      approximate: r.approximate,
      changeState,
      delta,
      streak,
      severityChanged,
      coverageState: state,
      lastObservedAt: snapshotAt,
      siteAuditId: r.siteAuditId,
      liveScanRunId: r.liveScanRunId,
    })
  }

  // --- stale groups from failed pairs' prior GROUPS ------------------------
  const staleGroups: IssueGroup[] = []
  const staleEmitted = new Set<string>()
  const pushStale = (g: IssueGroup): void => {
    const identity = identityKey(g.clientId, g.domain, g.tool, g.type)
    if (staleEmitted.has(identity)) return
    staleEmitted.add(identity)
    // full render data + lastObservedAt carried verbatim; only changeState flips
    staleGroups.push({ ...g, changeState: 'stale' })
  }
  // --- resolved groups from comparable pairs' prior GROUPS -----------------
  const resolvedGroups: ResolvedIssueGroup[] = []

  for (const g of prevGroups) {
    const covEntry = coverageByPair.get(pairKey(g.clientId, g.domain, g.tool))
    if (!covEntry) continue // out-of-cohort (already filtered, defensive)

    if (covEntry.state === 'failed') {
      pushStale(g)
      continue
    }

    if (covEntry.state === 'comparable') {
      const identity = identityKey(g.clientId, g.domain, g.tool, g.type)
      if (observedIdentities.has(identity)) continue // still present -> not resolved
      resolvedGroups.push({
        clientId: g.clientId,
        clientName: g.clientName,
        domain: g.domain,
        tool: g.tool,
        type: g.type,
        title: g.title,
        severity: g.severity,
        priorCount: g.affectedCount,
        unit: g.unit,
        siteAuditId: g.siteAuditId,
        liveScanRunId: g.liveScanRunId,
      })
    }
    // partial / first-baseline: neither stale nor resolved (no absence claims)
  }

  // Carry prior STALE rows forward for pairs that failed AGAIN this week, so a
  // run of consecutive failed weeks preserves the last-observed evidence (with
  // its ORIGINAL lastObservedAt — never refreshed). A recovered pair reads
  // first-baseline (a failed predecessor grants no baseline), so these never
  // feed the resolved path and cannot fabricate a false "resolved" claim.
  for (const g of prevStaleGroups) {
    const covEntry = coverageByPair.get(pairKey(g.clientId, g.domain, g.tool))
    if (covEntry?.state === 'failed') pushStale(g)
  }

  // --- semantic keys: live groups ONLY (stale carry-forward breaks streaks) -
  const semanticKeys: SemanticKey[] = groups.map((g) => ({
    clientId: g.clientId,
    domain: g.domain,
    tool: g.tool,
    type: g.type,
    severity: g.severity,
    unit: g.unit,
    affectedCount: g.affectedCount,
    approximate: g.approximate,
    streak: g.streak,
  }))

  return {
    groups: sortRows(groups),
    staleGroups: sortRows(staleGroups),
    resolvedGroups: sortRows(resolvedGroups),
    semanticKeys: sortRows(semanticKeys),
  }
}
