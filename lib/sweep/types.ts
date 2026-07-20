// lib/sweep/types.ts
// Versioned JSON contracts for the weekly client sweep (`WeeklySweep.membershipJson`
// / `snapshotJson`, see Task 1). Pure types/consts/parsers only — no prisma import,
// no server-only import — this module is safe to import from client code too.
//
// Parsers are strict, matching the house `ingest-schema.ts` convention: reject the
// WHOLE document on any structural defect (null/undefined, unparseable JSON,
// `v !== 1`, wrong-shaped array item, missing/mistyped required field, unknown
// enum value). There is no field-by-field salvage — a corrupt or foreign doc
// must read as absent (`null`), never as partial data.

export const CLIENT_SWEEP_JOB_TYPE = 'client-sweep'
export const SWEEP_DIGEST_JOB_TYPE = 'sweep-digest'
export const SWEEP_SCAN_PROFILE = { wcagLevel: 'wcag21aa', seoIntent: true, seoOnly: false } as const // D8

// A WeeklySweep row is either the Sunday scheduled sweep or an on-demand manual
// full-cohort sweep ("Queue all clients"). Stored on WeeklySweep.origin.
export type SweepOrigin = 'scheduled' | 'manual'

/** Fail-safe: any unknown/legacy value reads as 'scheduled' (the pre-origin default). */
export function asSweepOrigin(s: string | null | undefined): SweepOrigin {
  return s === 'manual' ? 'manual' : 'scheduled'
}

// D8 cadences — the SINGLE source of truth shared by the system-schedule seed
// and the digest's sweep-slot derivation (which must agree on the 01:00 hour).
export const SWEEP_CADENCE = 'weekly:1@01:00' // fan-out: Monday 01:00 server-local
export const SWEEP_DIGEST_CADENCE = 'weekly:1@14:00' // digest: Monday 14:00 server-local
export const SWEEP_SLOT_HOUR = 1 // the hour the fan-out slot lands on (matches SWEEP_CADENCE)

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

export type MemberOutcome =
  | 'pending'
  | 'enqueued'
  | 'duplicate'
  | 'shared-domain'
  | 'skipped-archived'
  | 'skipped-delisted'
  | 'skipped-conflict'
  | 'invalid-domain'
  | 'error'

export interface SweepMember {
  clientId: number
  clientName: string
  domain: string
  siteAuditId: string | null
  outcome: MemberOutcome
  reason?: string
}

export interface SweepMembership {
  v: 1
  expectedCount: number
  members: SweepMember[]
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export type SweepTool = 'ada-audit' | 'seo-parser'
export type CoverageState = 'comparable' | 'first-baseline' | 'partial' | 'failed'
export type ChangeState = 'new' | 'worsened' | 'fewer' | 'detected' | 'stale'
export type IssueUnit = 'pages' | 'targets' | 'groups'

export interface SemanticKey {
  clientId: number
  domain: string
  tool: SweepTool
  type: string
  severity: 'critical' | 'warning' | 'notice'
  unit: IssueUnit
  affectedCount: number
  approximate: boolean
  streak: number
}

export interface IssueGroup extends Omit<SemanticKey, 'streak'> {
  clientName: string
  title: string
  changeState: ChangeState
  delta: number | null
  streak: number
  severityChanged: 'escalated' | 'downgraded' | null
  coverageState: CoverageState
  lastObservedAt: string // ISO; current sweep's snapshotAt for live rows, the PRIOR sweep's for stale rows (Codex plan-fix #2)
  siteAuditId: string | null
  liveScanRunId: string | null
}

export interface ResolvedIssueGroup {
  // full render payload for "no longer detected" (Codex plan-fix #2)
  clientId: number
  clientName: string
  domain: string
  tool: SweepTool
  type: string
  title: string
  severity: 'critical' | 'warning' | 'notice'
  priorCount: number
  unit: IssueUnit
  siteAuditId: string | null
  liveScanRunId: string | null
}

export interface PairCoverage {
  clientId: number
  domain: string
  tool: SweepTool
  state: CoverageState
  reason: string | null // e.g. 'scan-failed' | 'timed-out' | 'crawl-capped' | 'run-missing' | 'attribution-incomplete'
  baselineAvailable: boolean // pair observed in the immediate predecessor snapshot (Codex plan-fix #9)
  siteAuditId: string | null
  runId: string | null // selected run ids frozen per member/tool (spec Codex #4)
}

export interface SweepSnapshot {
  v: 1
  snapshotAt: string
  totals: {
    actionable: number
    delta: number | null
    comparablePairs: number
    newCount: number
    worsenedCount: number
    resolvedCount: number
    scanned: number
    expected: number
    comparableDomains: number
    partialDomains: number
    failedDomains: number
  }
  coverage: PairCoverage[]
  groups: IssueGroup[] // actionable + notices, changeState != 'stale'
  staleGroups: IssueGroup[] // from failed pairs' previous GROUPS (full render data, Codex plan-fix #10)
  resolvedGroups: ResolvedIssueGroup[]
  shortlist: IssueGroup[] // top 3, deterministic tuple rank (Task 8, Codex plan-fix #16)
  semanticKeys: SemanticKey[] // next week's baseline + streak store
}

// ---------------------------------------------------------------------------
// Runtime validation helpers (not exported — internal to the parsers below)
// ---------------------------------------------------------------------------

const MEMBER_OUTCOMES: readonly MemberOutcome[] = [
  'pending',
  'enqueued',
  'duplicate',
  'shared-domain',
  'skipped-archived',
  'skipped-delisted',
  'skipped-conflict',
  'invalid-domain',
  'error',
]

const TOOLS: readonly SweepTool[] = ['ada-audit', 'seo-parser']
const COVERAGE_STATES: readonly CoverageState[] = ['comparable', 'first-baseline', 'partial', 'failed']
const CHANGE_STATES: readonly ChangeState[] = ['new', 'worsened', 'fewer', 'detected', 'stale']
const ISSUE_UNITS: readonly IssueUnit[] = ['pages', 'targets', 'groups']
const SEVERITIES: readonly ('critical' | 'warning' | 'notice')[] = ['critical', 'warning', 'notice']
const SEVERITY_CHANGED_VALUES: readonly ('escalated' | 'downgraded')[] = ['escalated', 'downgraded']

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isString(v: unknown): v is string {
  return typeof v === 'string'
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean'
}

function isOneOf<T extends string>(v: unknown, allowed: readonly T[]): v is T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v)
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** Parse a JSON array with `itemParser`; any invalid item invalidates the whole array. */
function parseArray<T>(raw: unknown, itemParser: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(raw)) return null
  const out: T[] = []
  for (const item of raw) {
    const parsed = itemParser(item)
    if (parsed === null) return null
    out.push(parsed)
  }
  return out
}

// ---------------------------------------------------------------------------
// Membership parser
// ---------------------------------------------------------------------------

function parseMember(raw: unknown): SweepMember | null {
  if (!isPlainObject(raw)) return null
  if (!isFiniteNumber(raw.clientId)) return null
  if (!isString(raw.clientName)) return null
  if (!isString(raw.domain)) return null
  if (raw.siteAuditId !== null && !isString(raw.siteAuditId)) return null
  if (!isOneOf(raw.outcome, MEMBER_OUTCOMES)) return null
  if (raw.reason !== undefined && !isString(raw.reason)) return null

  const member: SweepMember = {
    clientId: raw.clientId,
    clientName: raw.clientName,
    domain: raw.domain,
    siteAuditId: raw.siteAuditId as string | null,
    outcome: raw.outcome,
  }
  if (raw.reason !== undefined) member.reason = raw.reason as string
  return member
}

export function parseMembership(raw: string | null): SweepMembership | null {
  if (raw == null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isPlainObject(parsed)) return null
  if (parsed.v !== 1) return null
  if (!isFiniteNumber(parsed.expectedCount)) return null

  const members = parseArray(parsed.members, parseMember)
  if (members === null) return null

  return { v: 1, expectedCount: parsed.expectedCount, members }
}

// ---------------------------------------------------------------------------
// Snapshot parser
// ---------------------------------------------------------------------------

/** Fields shared by SemanticKey and IssueGroup (everything but `streak`). */
function parseKeyFields(raw: Record<string, unknown>): Omit<SemanticKey, 'streak'> | null {
  if (!isFiniteNumber(raw.clientId)) return null
  if (!isString(raw.domain)) return null
  if (!isOneOf(raw.tool, TOOLS)) return null
  if (!isString(raw.type)) return null
  if (!isOneOf(raw.severity, SEVERITIES)) return null
  if (!isOneOf(raw.unit, ISSUE_UNITS)) return null
  if (!isFiniteNumber(raw.affectedCount)) return null
  if (!isBoolean(raw.approximate)) return null

  return {
    clientId: raw.clientId,
    domain: raw.domain,
    tool: raw.tool,
    type: raw.type,
    severity: raw.severity,
    unit: raw.unit,
    affectedCount: raw.affectedCount,
    approximate: raw.approximate,
  }
}

function parseSemanticKey(raw: unknown): SemanticKey | null {
  if (!isPlainObject(raw)) return null
  const base = parseKeyFields(raw)
  if (!base) return null
  if (!isFiniteNumber(raw.streak)) return null
  return { ...base, streak: raw.streak }
}

function parseIssueGroup(raw: unknown): IssueGroup | null {
  if (!isPlainObject(raw)) return null
  const base = parseKeyFields(raw)
  if (!base) return null
  if (!isString(raw.clientName)) return null
  if (!isString(raw.title)) return null
  if (!isOneOf(raw.changeState, CHANGE_STATES)) return null
  if (raw.delta !== null && !isFiniteNumber(raw.delta)) return null
  if (!isFiniteNumber(raw.streak)) return null
  if (raw.severityChanged !== null && !isOneOf(raw.severityChanged, SEVERITY_CHANGED_VALUES)) return null
  if (!isOneOf(raw.coverageState, COVERAGE_STATES)) return null
  if (!isString(raw.lastObservedAt)) return null
  if (raw.siteAuditId !== null && !isString(raw.siteAuditId)) return null
  if (raw.liveScanRunId !== null && !isString(raw.liveScanRunId)) return null

  return {
    ...base,
    clientName: raw.clientName,
    title: raw.title,
    changeState: raw.changeState,
    delta: raw.delta as number | null,
    streak: raw.streak,
    severityChanged: raw.severityChanged as 'escalated' | 'downgraded' | null,
    coverageState: raw.coverageState,
    lastObservedAt: raw.lastObservedAt,
    siteAuditId: raw.siteAuditId as string | null,
    liveScanRunId: raw.liveScanRunId as string | null,
  }
}

function parseResolvedIssueGroup(raw: unknown): ResolvedIssueGroup | null {
  if (!isPlainObject(raw)) return null
  if (!isFiniteNumber(raw.clientId)) return null
  if (!isString(raw.clientName)) return null
  if (!isString(raw.domain)) return null
  if (!isOneOf(raw.tool, TOOLS)) return null
  if (!isString(raw.type)) return null
  if (!isString(raw.title)) return null
  if (!isOneOf(raw.severity, SEVERITIES)) return null
  if (!isFiniteNumber(raw.priorCount)) return null
  if (!isOneOf(raw.unit, ISSUE_UNITS)) return null
  if (raw.siteAuditId !== null && !isString(raw.siteAuditId)) return null
  if (raw.liveScanRunId !== null && !isString(raw.liveScanRunId)) return null

  return {
    clientId: raw.clientId,
    clientName: raw.clientName,
    domain: raw.domain,
    tool: raw.tool,
    type: raw.type,
    title: raw.title,
    severity: raw.severity,
    priorCount: raw.priorCount,
    unit: raw.unit,
    siteAuditId: raw.siteAuditId as string | null,
    liveScanRunId: raw.liveScanRunId as string | null,
  }
}

function parsePairCoverage(raw: unknown): PairCoverage | null {
  if (!isPlainObject(raw)) return null
  if (!isFiniteNumber(raw.clientId)) return null
  if (!isString(raw.domain)) return null
  if (!isOneOf(raw.tool, TOOLS)) return null
  if (!isOneOf(raw.state, COVERAGE_STATES)) return null
  if (raw.reason !== null && !isString(raw.reason)) return null
  if (!isBoolean(raw.baselineAvailable)) return null
  if (raw.siteAuditId !== null && !isString(raw.siteAuditId)) return null
  if (raw.runId !== null && !isString(raw.runId)) return null

  return {
    clientId: raw.clientId,
    domain: raw.domain,
    tool: raw.tool,
    state: raw.state,
    reason: raw.reason as string | null,
    baselineAvailable: raw.baselineAvailable,
    siteAuditId: raw.siteAuditId as string | null,
    runId: raw.runId as string | null,
  }
}

function parseTotals(raw: unknown): SweepSnapshot['totals'] | null {
  if (!isPlainObject(raw)) return null
  const requiredFiniteKeys = [
    'actionable',
    'comparablePairs',
    'newCount',
    'worsenedCount',
    'resolvedCount',
    'scanned',
    'expected',
    'comparableDomains',
    'partialDomains',
    'failedDomains',
  ] as const
  for (const key of requiredFiniteKeys) {
    if (!isFiniteNumber(raw[key])) return null
  }
  if (raw.delta !== null && !isFiniteNumber(raw.delta)) return null

  return {
    actionable: raw.actionable as number,
    delta: raw.delta as number | null,
    comparablePairs: raw.comparablePairs as number,
    newCount: raw.newCount as number,
    worsenedCount: raw.worsenedCount as number,
    resolvedCount: raw.resolvedCount as number,
    scanned: raw.scanned as number,
    expected: raw.expected as number,
    comparableDomains: raw.comparableDomains as number,
    partialDomains: raw.partialDomains as number,
    failedDomains: raw.failedDomains as number,
  }
}

export function parseSnapshot(raw: string | null): SweepSnapshot | null {
  if (raw == null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isPlainObject(parsed)) return null
  if (parsed.v !== 1) return null
  if (!isString(parsed.snapshotAt)) return null

  const totals = parseTotals(parsed.totals)
  if (!totals) return null

  const coverage = parseArray(parsed.coverage, parsePairCoverage)
  if (coverage === null) return null

  const groups = parseArray(parsed.groups, parseIssueGroup)
  if (groups === null) return null

  const staleGroups = parseArray(parsed.staleGroups, parseIssueGroup)
  if (staleGroups === null) return null

  const resolvedGroups = parseArray(parsed.resolvedGroups, parseResolvedIssueGroup)
  if (resolvedGroups === null) return null

  const shortlist = parseArray(parsed.shortlist, parseIssueGroup)
  if (shortlist === null) return null

  const semanticKeys = parseArray(parsed.semanticKeys, parseSemanticKey)
  if (semanticKeys === null) return null

  return {
    v: 1,
    snapshotAt: parsed.snapshotAt,
    totals,
    coverage,
    groups,
    staleGroups,
    resolvedGroups,
    shortlist,
    semanticKeys,
  }
}
