// Client-safe pure helpers for Quarter Grid state (no Prisma/server imports).
// Shared by app/quarter-grid/page.tsx, the /api/quarter-plan routes, and tests.

export type ClientStatus = 'not_started' | 'in_progress' | 'on_hold' | 'blocked' | 'complete'

export const ALL_STATUSES: ClientStatus[] = ['not_started', 'in_progress', 'on_hold', 'blocked', 'complete']
export const NUM_WEEKS = 13
export const NOTE_MAX = 120
export const NAME_MAX = 80
export const LAYOUTS_MAX_BYTES = 256 * 1024 // serialized-JSON length cap (chars ≈ bytes for this payload)

export type ScheduleMap = Record<number, number[]>
export type ClientPlanState = { priority: number; status: ClientStatus; note: string }
export type ClientStateMap = Record<number, ClientPlanState>

export type SnapshotClient = { id: number; name: string; priority: number; status: ClientStatus; note: string }
export type Snapshot = { schedule: ScheduleMap; completed: number[]; clients: SnapshotClient[] }
export type Snapshots = Record<string, Snapshot>

export type StoredQuarterState = {
  clientState: ClientStateMap
  schedule: ScheduleMap
  completed: number[]
  slotsPerWeek: number
  layouts: Snapshots
  startDate: string
}

export type AssignmentPayload = {
  clientId: number
  week: number | null
  position: number | null
  priority: number
  status: ClientStatus
  note: string
  completed: boolean
}

export type QuarterPlanScalars = {
  name: string
  startDate: string | null
  slotsPerWeek: number
  layouts: Snapshots
}

export type QuarterPlanPayload = QuarterPlanScalars & { assignments: AssignmentPayload[] }

export type QuarterPlanGetResponse =
  | { plan: null }
  | { plan: QuarterPlanScalars & { updatedAt: string }; assignments: AssignmentPayload[] }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function clampPriority(v: unknown): number {
  const n = typeof v === 'number' ? Math.round(v) : NaN
  if (!Number.isFinite(n)) return 3
  return Math.min(5, Math.max(1, n))
}

function coerceStatus(v: unknown): ClientStatus {
  return typeof v === 'string' && (ALL_STATUSES as string[]).includes(v) ? (v as ClientStatus) : 'not_started'
}

function coerceNote(v: unknown): string {
  return typeof v === 'string' ? v.slice(0, NOTE_MAX) : ''
}

function isClientId(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0
}

function parseScheduleMap(v: unknown): ScheduleMap {
  const schedule: ScheduleMap = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return schedule
  for (const [k, ids] of Object.entries(v as Record<string, unknown>)) {
    const wk = parseInt(k, 10)
    if (!Number.isInteger(wk) || wk < 1 || wk > NUM_WEEKS || !Array.isArray(ids)) continue
    const clean = ids.filter(isClientId)
    if (clean.length > 0) schedule[wk] = clean
  }
  return schedule
}

/**
 * Parse a raw `seo-quarter-v3` localStorage string. Handles both the current
 * format (clientState record) and the legacy one (clients[] + snapshots),
 * mirroring the migration the page used to do on read.
 * Returns null for missing, corrupt, or contentless input.
 */
export function parseStoredQuarterState(raw: string | null): StoredQuarterState | null {
  if (!raw) return null
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const d = parsed as Record<string, unknown>

  const clientState: ClientStateMap = {}
  if (d.clientState && typeof d.clientState === 'object' && !Array.isArray(d.clientState)) {
    for (const [k, v] of Object.entries(d.clientState as Record<string, unknown>)) {
      const id = parseInt(k, 10)
      if (!Number.isInteger(id) || id <= 0 || !v || typeof v !== 'object') continue
      const s = v as Record<string, unknown>
      clientState[id] = { priority: clampPriority(s.priority), status: coerceStatus(s.status), note: coerceNote(s.note) }
    }
  } else if (Array.isArray(d.clients)) {
    for (const c of d.clients as Array<Record<string, unknown> | null>) {
      if (!c || !isClientId(c.id)) continue
      clientState[c.id] = { priority: clampPriority(c.priority), status: coerceStatus(c.status), note: coerceNote(c.note) }
    }
  }

  const schedule = parseScheduleMap(d.schedule)
  const completed = Array.isArray(d.completed) ? d.completed.filter(isClientId) : []
  const slotsPerWeek = d.slotsPerWeek === 3 ? 3 : 2
  const layoutsRaw = d.layouts ?? d.snapshots
  const layouts: Snapshots =
    layoutsRaw && typeof layoutsRaw === 'object' && !Array.isArray(layoutsRaw) ? (layoutsRaw as Snapshots) : {}
  const startDate = typeof d.startDate === 'string' && DATE_RE.test(d.startDate) ? d.startDate : ''

  const hasContent =
    Object.keys(clientState).length > 0 ||
    Object.keys(schedule).length > 0 ||
    completed.length > 0 ||
    Object.keys(layouts).length > 0 ||
    startDate !== ''
  if (!hasContent) return null

  return { clientState, schedule, completed, slotsPerWeek, layouts, startDate }
}

export type GridStateInput = {
  clientState: ClientStateMap
  schedule: ScheduleMap
  completed: Iterable<number>
  slotsPerWeek: number
  layouts: Snapshots
  startDate: string
  name?: string
}

/**
 * Page/imported state → PUT/import body. Drops ids not in validClientIds
 * (old localStorage can reference deleted clients) and emits one row per
 * valid client (pool rows get week/position null).
 */
export function buildPlanPayload(input: GridStateInput, validClientIds: Iterable<number>): QuarterPlanPayload {
  const valid = new Set(validClientIds)
  const placement = new Map<number, { week: number; position: number }>()
  const weeks = Object.keys(input.schedule).map(Number)
    .filter((w) => Number.isInteger(w) && w >= 1 && w <= NUM_WEEKS)
    .sort((a, b) => a - b)
  for (const wk of weeks) {
    const ids = (input.schedule[wk] || []).filter((id) => valid.has(id))
    ids.forEach((id, i) => { if (!placement.has(id)) placement.set(id, { week: wk, position: i }) })
  }
  const completedSet = new Set([...input.completed].filter((id) => valid.has(id)))

  const assignments: AssignmentPayload[] = [...valid].sort((a, b) => a - b).map((id) => {
    const st = input.clientState[id]
    const place = placement.get(id) ?? null
    return {
      clientId: id,
      week: place ? place.week : null,
      position: place ? place.position : null,
      priority: st ? clampPriority(st.priority) : 3,
      status: st ? coerceStatus(st.status) : 'not_started',
      note: st ? coerceNote(st.note) : '',
      completed: completedSet.has(id),
    }
  })

  return {
    name: input.name?.trim() ? input.name.trim().slice(0, NAME_MAX) : 'Quarter plan',
    startDate: DATE_RE.test(input.startDate) ? input.startDate : null,
    slotsPerWeek: input.slotsPerWeek === 3 ? 3 : 2,
    layouts: input.layouts ?? {},
    assignments,
  }
}

/**
 * Deterministic assignment order: assigned rows by week/position, pool rows
 * last, clientId as the stable tie-break. Done in JS because SQLite sorts
 * NULL first in ascending orderBy — "pool last" is inexpressible in Prisma.
 */
export function sortAssignments<T extends { week: number | null; position: number | null; clientId: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const aw = a.week ?? Number.POSITIVE_INFINITY
    const bw = b.week ?? Number.POSITIVE_INFINITY
    if (aw !== bw) return aw - bw
    const ap = a.position ?? Number.POSITIVE_INFINITY
    const bp = b.position ?? Number.POSITIVE_INFINITY
    if (ap !== bp) return ap - bp
    return a.clientId - b.clientId
  })
}

export type AppliedPlanState = {
  clientState: ClientStateMap
  schedule: ScheduleMap
  completed: number[]
  slotsPerWeek: number
  layouts: Snapshots
  startDate: string
}

/** GET/import response → page state pieces; ids not in validClientIds never enter page state. */
export function applyPlanResponse(resp: QuarterPlanGetResponse, validClientIds: Iterable<number>): AppliedPlanState | null {
  if (!resp.plan) return null
  const valid = new Set(validClientIds)
  const clientState: ClientStateMap = {}
  const schedule: ScheduleMap = {}
  const completed: number[] = []
  const rows = resp.assignments.filter((a) => valid.has(a.clientId))
  for (const a of sortAssignments(rows)) {
    clientState[a.clientId] = { priority: clampPriority(a.priority), status: coerceStatus(a.status), note: coerceNote(a.note) }
    if (a.week != null && a.week >= 1 && a.week <= NUM_WEEKS) {
      if (!schedule[a.week]) schedule[a.week] = []
      schedule[a.week].push(a.clientId)
    }
    if (a.completed) completed.push(a.clientId)
  }
  return {
    clientState,
    schedule,
    completed,
    slotsPerWeek: resp.plan.slotsPerWeek === 3 ? 3 : 2,
    layouts: resp.plan.layouts ?? {},
    startDate: resp.plan.startDate ?? '',
  }
}

export type SanitizedSnapshot = {
  clientPatches: Map<number, ClientPlanState>
  schedule: ScheduleMap
  completed: number[]
}

/**
 * Used by applyLayout: a stale snapshot must never resurrect deleted clients
 * or clobber current names. Patches (priority/status/note) apply only onto
 * clients in currentClientIds; schedule/completed are pruned to that set.
 * Accepts unknown — layouts blobs are opaque JSON and a malformed entry must
 * degrade to an empty result, never crash the apply.
 */
export function sanitizeSnapshotForApply(snapshot: unknown, currentClientIds: Iterable<number>): SanitizedSnapshot {
  const empty: SanitizedSnapshot = { clientPatches: new Map(), schedule: {}, completed: [] }
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return empty
  const s = snapshot as Record<string, unknown>
  const valid = new Set(currentClientIds)
  const clientPatches = new Map<number, ClientPlanState>()
  const clientsArr = Array.isArray(s.clients) ? (s.clients as Array<Record<string, unknown> | null>) : []
  for (const c of clientsArr) {
    if (!c || typeof c !== 'object' || !isClientId(c.id) || !valid.has(c.id)) continue
    clientPatches.set(c.id, { priority: clampPriority(c.priority), status: coerceStatus(c.status), note: coerceNote(c.note) })
  }
  const schedule: ScheduleMap = {}
  for (const [k, ids] of Object.entries(parseScheduleMap(s.schedule))) {
    const clean = ids.filter((id) => valid.has(id))
    if (clean.length > 0) schedule[Number(k)] = clean
  }
  const completed = (Array.isArray(s.completed) ? s.completed : []).filter((id): id is number => isClientId(id) && valid.has(id))
  return { clientPatches, schedule, completed }
}

export type SanitizeResult = { ok: true; payload: QuarterPlanPayload } | { ok: false; error: string }

/** Server-side body validation/clamping for PUT and import. */
export function sanitizePlanPayload(body: unknown): SanitizeResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Invalid payload' }
  const b = body as Record<string, unknown>

  const layoutsRaw = b.layouts ?? {}
  if (typeof layoutsRaw !== 'object' || Array.isArray(layoutsRaw)) return { ok: false, error: 'layouts must be an object' }
  let layoutsJson: string
  try { layoutsJson = JSON.stringify(layoutsRaw) } catch { return { ok: false, error: 'layouts is not serializable' } }
  if (layoutsJson.length > LAYOUTS_MAX_BYTES) return { ok: false, error: 'layouts too large' }
  const layouts = layoutsRaw as Snapshots

  const seen = new Set<number>()
  const assignments: AssignmentPayload[] = []
  const rows = Array.isArray(b.assignments) ? b.assignments : []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    if (!isClientId(r.clientId) || seen.has(r.clientId)) continue // bad id dropped; dup keep-first
    seen.add(r.clientId)
    const week = typeof r.week === 'number' && Number.isInteger(r.week) && r.week >= 1 && r.week <= NUM_WEEKS ? r.week : null
    const position = week != null && typeof r.position === 'number' && Number.isInteger(r.position) && r.position >= 0 ? r.position : null
    assignments.push({
      clientId: r.clientId,
      week,
      position,
      priority: clampPriority(r.priority),
      status: coerceStatus(r.status),
      note: coerceNote(r.note),
      completed: r.completed === true,
    })
  }

  return {
    ok: true,
    payload: {
      name: typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, NAME_MAX) : 'Quarter plan',
      startDate: typeof b.startDate === 'string' && DATE_RE.test(b.startDate) ? b.startDate : null,
      slotsPerWeek: b.slotsPerWeek === 3 ? 3 : 2,
      layouts,
      assignments,
    },
  }
}
