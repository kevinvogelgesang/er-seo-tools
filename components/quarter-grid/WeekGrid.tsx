// components/quarter-grid/WeekGrid.tsx
'use client'

import { NUM_WEEKS, type ScheduleMap, type ClientStatus } from '@/lib/quarter-grid/state'
import { getWeekRange, type GridClient } from '@/lib/quarter-grid/grid-ops'
import { SLOT_LABELS } from './theme'
import { Chip } from './Chip'

interface WeekGridProps {
  schedule: ScheduleMap
  completed: Set<number>
  slotsPerWeek: number
  startDate: string
  dragging: { id: number; fromWeek: number | null } | null
  dropTarget: { week: number | string; slot: number } | null
  getClient: (id: number) => GridClient | undefined
  onDragOver: (e: React.DragEvent, week: number, slot: number) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent, week: number, slot: number) => void
  onDragStart: (e: React.DragEvent, id: number, fromWeek: number | null) => void
  onDragEnd: () => void
  onToggleDone: (id: number) => void
  onSetPriority: (id: number, p: number) => void
  onReturn: (id: number) => void
  onSetStatus: (id: number, status: ClientStatus) => void
  onOpenNote: (id: number, currentNote: string) => void
  activity: Record<number, string>
}

export function WeekGrid({
  schedule, completed, slotsPerWeek, startDate, dragging, dropTarget, getClient,
  onDragOver, onDragLeave, onDrop,
  onDragStart, onDragEnd, onToggleDone, onSetPriority, onReturn, onSetStatus, onOpenNote, activity,
}: WeekGridProps) {
  const maxCols = Math.max(slotsPerWeek, ...Array.from({ length: NUM_WEEKS }, (_, i) => (schedule[i + 1] || []).length))

  return (
    <div style={{ overflowX: "auto", marginBottom: 12 }}>
      <div style={{ minWidth: 420, background: "#1e293b", border: "1px solid #334155", borderRadius: 10, overflow: "hidden" }}>
        {/* Column headers */}
        <div style={{ display: "grid", gridTemplateColumns: `72px repeat(${maxCols}, 1fr)`, background: "#0f172a", borderBottom: "1px solid #334155", padding: "8px 12px 8px 10px", gap: 8 }}>
          <span style={{ fontSize: 10, color: "#475569", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>Week</span>
          {Array.from({ length: maxCols }, (_, i) => (
            <span key={i} style={{ fontSize: 10, color: "#475569", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {SLOT_LABELS[i] ?? `Slot ${i + 1}`}
            </span>
          ))}
        </div>

        {/* Week rows */}
        {Array.from({ length: NUM_WEEKS }, (_, wi) => {
          const week     = wi + 1
          const wClients = schedule[week] || []
          const wDone    = wClients.filter(id => completed.has(id)).length
          const allDone  = wClients.length > 0 && wDone === wClients.length
          const range    = getWeekRange(startDate, week)
          return (
            <div key={week} style={{
              display: "grid",
              gridTemplateColumns: `72px repeat(${maxCols}, 1fr)`,
              borderBottom: wi < NUM_WEEKS - 1 ? "1px solid #1e293b" : "none",
              padding: "6px 12px 6px 10px", gap: 8,
              background: allDone ? "rgba(34,197,94,0.05)" : wi % 2 === 0 ? "#1e293b" : "#182030",
              alignItems: "center",
            }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <span style={{ fontSize: 11, fontWeight: 500, color: allDone ? "#4ade80" : "#64748b" }}>Wk {week}</span>
                {range && (
                  <span style={{ fontSize: 9, color: "#334155", whiteSpace: "nowrap" }}>{range}</span>
                )}
              </div>
              {Array.from({ length: maxCols }, (_, si) => {
                const clientId = wClients[si]
                const isOver   = dropTarget?.week === week && dropTarget?.slot === si
                return (
                  <div
                    key={si}
                    className="drop-zone"
                    onDragOver={e => onDragOver(e, week, si)}
                    onDragLeave={onDragLeave}
                    onDrop={e => onDrop(e, week, si)}
                    style={{
                      minHeight: 36, borderRadius: 6, padding: 3,
                      border: `1.5px dashed ${isOver ? "#6366f1" : "#334155"}`,
                      background: isOver ? "rgba(99,102,241,0.08)" : "transparent",
                      transition: "border-color 0.15s, background 0.15s",
                    }}
                  >
                    {clientId && getClient(clientId)
                      ? <Chip
                          id={clientId}
                          fromWeek={week}
                          client={getClient(clientId)!}
                          done={completed.has(clientId)}
                          isDragging={dragging?.id === clientId}
                          onDragStart={onDragStart}
                          onDragEnd={onDragEnd}
                          onToggleDone={onToggleDone}
                          onSetPriority={onSetPriority}
                          onReturn={onReturn}
                          onSetStatus={onSetStatus}
                          activity={activity[clientId]}
                          onOpenNote={onOpenNote}
                        />
                      : <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <span style={{ fontSize: 10, color: "#334155" }}>drop</span>
                        </div>
                    }
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
