// components/quarter-grid/AssignedSection.tsx
'use client'

import { NUM_WEEKS, type ScheduleMap, type ClientStatus } from '@/lib/quarter-grid/state'
import { getWeekRange, type GridClient } from '@/lib/quarter-grid/grid-ops'
import { Chip } from './Chip'

interface AssignedSectionProps {
  schedule: ScheduleMap
  clients: GridClient[]
  completed: Set<number>
  startDate: string
  assignedCount: number
  dragging: { id: number; fromWeek: number | null } | null
  onDragStart: (e: React.DragEvent, id: number, fromWeek: number | null) => void
  onDragEnd: () => void
  onToggleDone: (id: number) => void
  onSetPriority: (id: number, p: number) => void
  onReturn: (id: number) => void
  onSetStatus: (id: number, status: ClientStatus) => void
  onOpenNote: (id: number, currentNote: string) => void
  activity: Record<number, string>
}

export function AssignedSection({
  schedule, clients, completed, startDate, assignedCount, dragging,
  onDragStart, onDragEnd, onToggleDone, onSetPriority, onReturn, onSetStatus, onOpenNote, activity,
}: AssignedSectionProps) {
  if (assignedCount === 0) return null

  return (
    <div style={{ marginTop: 12, background: "#1e293b", border: "1px solid #334155", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", background: "#0f172a", borderBottom: "1px solid #334155" }}>
        <span style={{ fontSize: 10, fontWeight: 500, color: "#64748b", letterSpacing: "0.08em", textTransform: "uppercase" }}>Assigned</span>
        <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 99, background: "#334155", color: "#94a3b8" }}>
          {assignedCount}
        </span>
      </div>
      <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
        {Array.from({ length: NUM_WEEKS }, (_, wi) => {
          const week = wi + 1
          const wChips = (schedule[week] || [])
            .map(id => clients.find(c => c.id === id))
            .filter((c): c is GridClient => Boolean(c))
          if (wChips.length === 0) return null
          const range = getWeekRange(startDate, week)
          return (
            <div key={week} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", width: 44, flexShrink: 0 }}>
                <span style={{ fontSize: 10, fontWeight: 500, color: "#64748b" }}>Wk {week}</span>
                {range && <span style={{ fontSize: 8, color: "#334155" }}>{range}</span>}
              </div>
              {wChips.map(c => (
                <Chip
                  key={c.id}
                  id={c.id}
                  fromWeek={week}
                  client={c}
                  done={completed.has(c.id)}
                  isDragging={dragging?.id === c.id}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  onToggleDone={onToggleDone}
                  onSetPriority={onSetPriority}
                  onReturn={onReturn}
                  onSetStatus={onSetStatus}
                  onOpenNote={onOpenNote}
                  activity={activity[c.id]}
                />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
