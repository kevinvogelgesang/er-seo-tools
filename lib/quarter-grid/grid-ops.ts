// lib/quarter-grid/grid-ops.ts
// Pure, client-safe grid operations for the Quarter Grid (no React, no Prisma).
// Extracted verbatim from app/quarter-grid/page.tsx in the B4 split.

import { NUM_WEEKS, ALL_STATUSES, type ScheduleMap, type ClientStatus, type SnapshotClient } from './state'

// The working client-row shape used by the grid page, hook, and components.
// Structurally identical to a layout-snapshot client entry.
export type GridClient = SnapshotClient

// Shared shape of returnToPool / removeClient's schedule update
export function removeFromSchedule(schedule: ScheduleMap, id: number): ScheduleMap {
  const ns = { ...schedule }
  Object.keys(ns).forEach(w => { ns[+w] = (ns[+w] || []).filter(x => x !== id) })
  return ns
}

// The drag-and-drop onDrop body: occupied-slot swap (displaced chip returns
// to the drag's source week; pool-sourced drags displace to the pool),
// pad-with-0/append semantics, final falsy-filter pass.
export function dropChipOnSlot(
  schedule: ScheduleMap,
  drag: { id: number; fromWeek: number | null },
  targetWeek: number,
  targetSlot: number,
): ScheduleMap {
  const { id, fromWeek } = drag
  const ns: ScheduleMap = JSON.parse(JSON.stringify(schedule))
  if (!ns[targetWeek]) ns[targetWeek] = []
  const existing = ns[targetWeek][targetSlot]
  if (fromWeek !== null) ns[fromWeek] = (ns[fromWeek] || []).filter(x => x !== id)
  if (existing !== undefined && existing !== id) {
    if (fromWeek !== null) { if (!ns[fromWeek]) ns[fromWeek] = []; ns[fromWeek].push(existing) }
    ns[targetWeek][targetSlot] = id
  } else {
    while (ns[targetWeek].length < targetSlot) ns[targetWeek].push(0)
    if (targetSlot < ns[targetWeek].length) ns[targetWeek][targetSlot] = id
    else ns[targetWeek].push(id)
  }
  Object.keys(ns).forEach(w => { ns[+w] = ns[+w].filter(x => x !== null && x !== undefined && x !== 0) })
  return ns
}

// Space key: pick the target week (last week with chips → fill its open
// slot, or move to the next week, capped at NUM_WEEKS). Split from placement
// so the hook can compute the week from refs and place via a functional
// update, exactly mirroring the old keyboard effect's timing.
export function frontierWeek(schedule: ScheduleMap, slotsPerWeek: number): number {
  const weeksWithChips = Object.keys(schedule).map(Number).filter(w => (schedule[w] || []).length > 0)
  if (weeksWithChips.length === 0) return 1
  const lastWeek = Math.max(...weeksWithChips)
  return (schedule[lastWeek] || []).length < slotsPerWeek
    ? lastWeek
    : Math.min(lastWeek + 1, NUM_WEEKS)
}

// Space key: the setSchedule updater body
export function placeInWeek(schedule: ScheduleMap, id: number, targetWeek: number): ScheduleMap {
  const ns: ScheduleMap = JSON.parse(JSON.stringify(schedule))
  Object.keys(ns).forEach(wk => { ns[+wk] = (ns[+wk] || []).filter(x => x !== id) })
  if (!ns[targetWeek]) ns[targetWeek] = []
  ns[targetWeek] = [...ns[targetWeek], id]
  return ns
}

// Pool derivation: unassigned clients, priority then name
export function sortPool(clients: GridClient[], assignedIds: Set<number>): GridClient[] {
  return clients
    .filter(c => !assignedIds.has(c.id))
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
}

// Space key: pre-select the next pool chip. `schedule` is the PRE-update
// schedule; justAssignedId is added on top, matching the old ref-based
// computation.
export function nextPoolChipId(clients: GridClient[], schedule: ScheduleMap, justAssignedId: number): number | null {
  const currentAssigned = new Set(Object.values(schedule).flat())
  currentAssigned.add(justAssignedId)
  const next = sortPool(clients, currentAssigned)[0]
  return next?.id ?? null
}

export function autoDistributeSchedule(clients: GridClient[], slotsPerWeek: number): ScheduleMap {
  const sorted = [...clients].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
  const total = sorted.length
  const ns: ScheduleMap = {}
  if (slotsPerWeek === 3) {
    let w = 1, s = 0
    for (const c of sorted) {
      if (!ns[w]) ns[w] = []
      ns[w].push(c.id)
      if (++s >= 3) { w++; s = 0 }
    }
  } else {
    const heavyWeeks = new Set([1, 4, 7, 11])
    const weekCaps = Array.from({ length: NUM_WEEKS }, (_, i) => heavyWeeks.has(i + 1) ? 3 : 2)
    let ci = 0
    for (let wi = 0; wi < NUM_WEEKS && ci < total; wi++) {
      ns[wi + 1] = []
      for (let s = 0; s < weekCaps[wi] && ci < total; s++) {
        ns[wi + 1].push(sorted[ci++].id)
      }
    }
  }
  return ns
}

export type CsvApplyResult = {
  schedule: ScheduleMap
  clientUpdates: Map<number, Partial<GridClient>>
  assignCount: number
  unrecognized: string[]
}

// The CSV merge (Papa parsing + FileReader live in GridHeader; this takes
// parsed rows): case-insensitive name match, week/priority clamps, status
// normalization, reassignment removes the prior week placement.
export function applyCsvRows(
  rows: Record<string, string>[],
  clients: GridClient[],
  schedule: ScheduleMap,
): CsvApplyResult {
  const unrecognized: string[] = []
  let assignCount = 0
  const newSchedule: ScheduleMap = JSON.parse(JSON.stringify(schedule))
  const clientUpdates = new Map<number, Partial<GridClient>>()

  for (const row of rows) {
    const rawName = (row['client_name'] ?? row['client'] ?? '').trim()
    if (!rawName) continue

    const match = clients.find(c => c.name.toLowerCase() === rawName.toLowerCase())
    if (!match) {
      if (!unrecognized.includes(rawName)) unrecognized.push(rawName)
      continue
    }

    const weekRaw = parseInt(row['week_assigned'] ?? row['week'] ?? '', 10)
    const week = isNaN(weekRaw) ? null : Math.min(Math.max(weekRaw, 1), NUM_WEEKS)

    const priorityRaw = parseInt(row['priority'] ?? '', 10)
    const priority = isNaN(priorityRaw) ? null : Math.min(Math.max(priorityRaw, 1), 5)

    const statusRaw = (row['status'] ?? '').trim().toLowerCase().replace(/ /g, '_') as ClientStatus
    const validStatus: ClientStatus | null = ALL_STATUSES.includes(statusRaw) ? statusRaw : null

    const upd: Partial<GridClient> = {}
    if (priority !== null) upd.priority = priority
    if (validStatus !== null) upd.status = validStatus
    if (Object.keys(upd).length > 0) clientUpdates.set(match.id, upd)

    if (week !== null) {
      // Remove this client from any existing week assignment
      Object.keys(newSchedule).forEach(w => {
        newSchedule[+w] = (newSchedule[+w] || []).filter(x => x !== match.id)
      })
      if (!newSchedule[week]) newSchedule[week] = []
      newSchedule[week].push(match.id)
      assignCount++
    }
  }

  return { schedule: newSchedule, clientUpdates, assignCount, unrecognized }
}

export function getWeekRange(startDate: string, weekNum: number): string | null {
  if (!startDate) return null
  const base = new Date(startDate + 'T00:00:00')
  if (isNaN(base.getTime())) return null
  const mon = new Date(base)
  mon.setDate(base.getDate() + (weekNum - 1) * 7)
  const fri = new Date(mon)
  fri.setDate(mon.getDate() + 4)
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`
  return `${fmt(mon)}–${fmt(fri)}`
}
