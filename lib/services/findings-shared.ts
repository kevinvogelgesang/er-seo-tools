// lib/services/findings-shared.ts
//
// Pure helpers for the B2 findings/action center: current/previous run
// selection, type-level aggregation, and type-level diffing. No prisma —
// shared by client-findings (dashboard) and client-fleet. Everything reads
// normalized A2 tables upstream; nothing here touches blobs.

export type Severity = 'critical' | 'warning' | 'notice'
export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, notice: 2 }
export const URLS_PER_FINDING = 25

export function toSeverity(raw: string): Severity {
  return raw === 'critical' || raw === 'warning' || raw === 'notice' ? raw : 'notice'
}

export interface RunRef {
  id: string
  tool: string
  source: string
  domain: string | null
  completedAt: Date | null
  createdAt: Date
  sessionId: string | null
  siteAuditId: string | null
  adaAuditId: string | null
}

export interface SelectedRuns {
  seo: { current: RunRef | null; previous: RunRef | null }
  ada: { current: RunRef | null; previous: RunRef | null; sourceClass: 'site' | 'page' | null }
}

const runTime = (r: RunRef) => (r.completedAt ?? r.createdAt).getTime()

// Deterministic ordering (Codex fix #5): date desc, then id desc.
function sortRunsDesc(runs: RunRef[]): RunRef[] {
  return [...runs].sort((a, b) => runTime(b) - runTime(a) || b.id.localeCompare(a.id))
}

// Previous = most recent earlier run with the SAME non-null domain as current
// (cross-domain dedup/type diffs are garbage; multi-domain clients are a
// documented v1 limitation — see spec).
function domainMatchedPrevious(sorted: RunRef[], current: RunRef): RunRef | null {
  if (current.domain === null) return null
  for (const r of sorted) {
    if (r.id === current.id) continue
    if (runTime(r) > runTime(current)) continue
    if (runTime(r) === runTime(current) && r.id.localeCompare(current.id) > 0) continue
    if (r.domain === current.domain) return r
  }
  return null
}

export function selectRuns(runs: RunRef[], keywordSessionIds: Set<string>): SelectedRuns {
  const seoCandidates = sortRunsDesc(
    runs.filter((r) => r.tool === 'seo-parser' && !(r.sessionId && keywordSessionIds.has(r.sessionId))),
  )
  const seoCurrent = seoCandidates[0] ?? null

  const adaRuns = runs.filter((r) => r.tool === 'ada-audit')
  const siteRuns = sortRunsDesc(adaRuns.filter((r) => r.source === 'site-audit'))
  const pageRuns = sortRunsDesc(adaRuns.filter((r) => r.source === 'page-audit'))
  const sourceClass: 'site' | 'page' | null = siteRuns.length ? 'site' : pageRuns.length ? 'page' : null
  const adaCandidates = sourceClass === 'site' ? siteRuns : pageRuns
  const adaCurrent = adaCandidates[0] ?? null

  return {
    seo: {
      current: seoCurrent,
      previous: seoCurrent ? domainMatchedPrevious(seoCandidates, seoCurrent) : null,
    },
    ada: {
      current: adaCurrent,
      // Standalone page audits of different URLs aren't comparable — no previous.
      previous: sourceClass === 'site' && adaCurrent ? domainMatchedPrevious(siteRuns, adaCurrent) : null,
      sourceClass,
    },
  }
}

export interface TypeAggregate {
  type: string
  severity: Severity
  count: number
}

export function aggregateSeoTypes(rows: { type: string; severity: string; count: number }[]): TypeAggregate[] {
  return rows.map((r) => ({ type: r.type, severity: toSeverity(r.severity), count: r.count }))
}

// One aggregate per type from pre-counted groups: severity = max, count = sum
// (Codex fix #3 — mixed-severity types must not double-count).
export function collapseTypeGroups(rows: { type: string; severity: string; count: number }[]): TypeAggregate[] {
  const byType = new Map<string, TypeAggregate>()
  for (const r of rows) {
    const sev = toSeverity(r.severity)
    const cur = byType.get(r.type)
    if (!cur) byType.set(r.type, { type: r.type, severity: sev, count: r.count })
    else {
      cur.count += r.count
      if (SEVERITY_RANK[sev] < SEVERITY_RANK[cur.severity]) cur.severity = sev
    }
  }
  return [...byType.values()]
}

// ADA page-scope rows are unique per (type, url) — row count IS the URL count.
export function aggregateAdaTypes(rows: { type: string; severity: string }[]): TypeAggregate[] {
  return collapseTypeGroups(rows.map((r) => ({ type: r.type, severity: r.severity, count: 1 })))
}

export interface TypeDiff {
  newTypes: Set<string>
  resolvedCount: number
  /** current − previous, only for types present in BOTH runs. */
  countDelta: Map<string, number>
}

// Previous shape is type+count only — severity intentionally absent
// (Codex fix #4); severity always comes from the current run.
export function diffTypes(current: TypeAggregate[], previous: { type: string; count: number }[] | null): TypeDiff {
  if (previous === null) return { newTypes: new Set(), resolvedCount: 0, countDelta: new Map() }
  const prevByType = new Map(previous.map((p) => [p.type, p.count]))
  const newTypes = new Set<string>()
  const countDelta = new Map<string, number>()
  for (const c of current) {
    const prev = prevByType.get(c.type)
    if (prev === undefined) newTypes.add(c.type)
    else countDelta.set(c.type, c.count - prev)
  }
  const currentTypes = new Set(current.map((c) => c.type))
  const resolvedCount = previous.filter((p) => !currentTypes.has(p.type)).length
  return { newTypes, resolvedCount, countDelta }
}

export function newCriticalTypes(current: TypeAggregate[], previousTypes: Set<string> | null): string[] {
  if (previousTypes === null) return []
  return current.filter((c) => c.severity === 'critical' && !previousTypes.has(c.type)).map((c) => c.type)
}
