// components/quarter-grid/GanttView.tsx
'use client'

import { NUM_WEEKS, type ScheduleMap } from '@/lib/quarter-grid/state'
import { getWeekRange, type GridClient } from '@/lib/quarter-grid/grid-ops'
import { PCOLORS, DONE_COLORS, STATUS_COLORS, STATUS_LABELS } from './theme'

interface GanttViewProps {
  clients: GridClient[]
  schedule: ScheduleMap
  completed: Set<number>
  startDate: string
  unassignedCount: number
}

const ROW_HEIGHT = 36
const GANTT_HEADER_H = 32
const GANTT_MAX_SCROLL_ROWS = 20

export function GanttView({ clients, schedule, completed, startDate, unassignedCount }: GanttViewProps) {
  const assignedIds = new Set(Object.values(schedule).flat())

  const ganttClients = clients
    .filter(c => assignedIds.has(c.id))
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))

  const clientWeekMap = new Map<number, Set<number>>()
  for (let w = 1; w <= NUM_WEEKS; w++) {
    for (const id of (schedule[w] || [])) {
      if (!clientWeekMap.has(id)) clientWeekMap.set(id, new Set())
      clientWeekMap.get(id)!.add(w)
    }
  }

  return (
    <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, overflow: "hidden", marginBottom: 12 }}>
      <div
        style={{
          overflowX: "auto",
          overflowY: ganttClients.length > GANTT_MAX_SCROLL_ROWS ? "auto" : "visible",
          maxHeight: ganttClients.length > GANTT_MAX_SCROLL_ROWS
            ? GANTT_HEADER_H + GANTT_MAX_SCROLL_ROWS * ROW_HEIGHT + 8
            : undefined,
        }}
      >
        {/* Gantt header row */}
        <div style={{
          display: "grid",
          gridTemplateColumns: `160px repeat(${NUM_WEEKS}, minmax(48px, 1fr))`,
          background: "#0f172a",
          borderBottom: "1px solid #334155",
          height: GANTT_HEADER_H,
          alignItems: "center",
          position: "sticky",
          top: 0,
          zIndex: 2,
          minWidth: 160 + NUM_WEEKS * 52,
        }}>
          <span style={{ fontSize: 10, color: "#475569", fontWeight: 500, padding: "0 12px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Client</span>
          {Array.from({ length: NUM_WEEKS }, (_, i) => {
            const w = i + 1
            const range = getWeekRange(startDate, w)
            return (
              <div key={w} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#475569", fontWeight: 500 }}>Wk {w}</div>
                {range && <div style={{ fontSize: 8, color: "#334155" }}>{range}</div>}
              </div>
            )
          })}
        </div>

        {/* Gantt client rows */}
        {ganttClients.length === 0 ? (
          <div style={{ padding: "24px 16px", fontSize: 12, color: "#475569", textAlign: "center" }}>
            No clients assigned yet. Use Auto-Distribute or drag chips into weeks.
          </div>
        ) : (
          ganttClients.map((c, ri) => {
            const weeks  = clientWeekMap.get(c.id) ?? new Set<number>()
            const isDone = completed.has(c.id)
            const colors = isDone ? DONE_COLORS : PCOLORS[c.priority]
            const statusColor = STATUS_COLORS[c.status]
            return (
              <div
                key={c.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: `160px repeat(${NUM_WEEKS}, minmax(48px, 1fr))`,
                  height: ROW_HEIGHT,
                  alignItems: "center",
                  background: ri % 2 === 0 ? "#1e293b" : "#182030",
                  borderBottom: "1px solid #1a2540",
                  minWidth: 160 + NUM_WEEKS * 52,
                }}
              >
                {/* Client label cell */}
                <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "0 8px 0 12px", overflow: "hidden" }}>
                  <span
                    title={`Status: ${STATUS_LABELS[c.status]}`}
                    style={{ width: 7, height: 7, borderRadius: "50%", background: statusColor, flexShrink: 0, display: "inline-block" }}
                  />
                  <span style={{
                    fontSize: 10, color: isDone ? "#4ade80" : "#cbd5e1",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    textDecoration: isDone ? "line-through" : "none", opacity: isDone ? 0.75 : 1,
                    flex: 1,
                  }} title={c.name}>{c.name}</span>
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: "1px 4px", borderRadius: 3,
                    background: colors.badge, color: "#fff", flexShrink: 0,
                  }}>{c.priority}</span>
                </div>
                {/* Week bar cells */}
                {Array.from({ length: NUM_WEEKS }, (_, i) => {
                  const w = i + 1
                  const assigned = weeks.has(w)
                  return (
                    <div
                      key={w}
                      title={assigned ? `${c.name} · Wk ${w} · ${STATUS_LABELS[c.status]}` : undefined}
                      style={{ padding: "0 3px", height: "100%", display: "flex", alignItems: "center" }}
                    >
                      {assigned && (
                        <div style={{
                          height: 20, width: "100%", borderRadius: 4,
                          background: isDone ? "#22c55e" : colors.badge,
                          opacity: isDone ? 0.55 : 0.82,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          overflow: "hidden",
                        }}>
                          <span style={{
                            fontSize: 9, color: "#fff", fontWeight: 600,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            padding: "0 3px",
                          }}>
                            {c.name.split(" ")[0]}
                          </span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })
        )}
      </div>

      {/* Gantt footer: pool count */}
      <div style={{
        padding: "8px 14px", background: "#0f172a", borderTop: "1px solid #334155",
        fontSize: 10, color: "#475569", display: "flex", alignItems: "center", gap: 6,
      }}>
        <span style={{ fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>Pool</span>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 99,
          background: unassignedCount > 0 ? "#334155" : "#14532d",
          color: unassignedCount > 0 ? "#94a3b8" : "#4ade80",
        }}>
          {unassignedCount > 0 ? `${unassignedCount} clients unassigned` : "✓ all assigned"}
        </span>
      </div>
    </div>
  )
}
