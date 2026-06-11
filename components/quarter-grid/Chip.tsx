// components/quarter-grid/Chip.tsx
'use client'

import { memo } from 'react'
import { ALL_STATUSES, type ClientStatus } from '@/lib/quarter-grid/state'
import type { GridClient } from '@/lib/quarter-grid/grid-ops'
import { PCOLORS, DONE_COLORS, STATUS_COLORS, STATUS_LABELS } from './theme'

interface ChipProps {
  id: number
  fromWeek: number | null
  client: GridClient
  done: boolean
  isDragging: boolean
  onDragStart: (e: React.DragEvent, id: number, fromWeek: number | null) => void
  onDragEnd: () => void
  onToggleDone: (id: number) => void
  onSetPriority: (id: number, p: number) => void
  onReturn: (id: number) => void
  onSetStatus: (id: number, status: ClientStatus) => void
  onOpenNote: (id: number, currentNote: string) => void
  activity?: string // preformatted "kind · date" tooltip line; renders the ⚡ glyph when set
}

export const Chip = memo(function Chip({
  id, fromWeek, client: c, done, isDragging,
  onDragStart, onDragEnd, onToggleDone, onSetPriority, onReturn,
  onSetStatus, onOpenNote, activity,
}: ChipProps) {
  const colors = done ? DONE_COLORS : PCOLORS[c.priority]
  const statusColor = STATUS_COLORS[c.status]
  const hasNote = c.note.trim().length > 0

  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, id, fromWeek)}
      onDragEnd={onDragEnd}
      className="chip-row"
      style={{
        background: colors.chip, border: `1.5px solid ${colors.border}`, color: colors.text,
        opacity: isDragging ? 0.35 : 1, borderRadius: 6, padding: "4px 6px", fontSize: 11,
        fontFamily: "'DM Mono', monospace", display: "flex", alignItems: "center", gap: 4,
        cursor: "grab", userSelect: "none", transition: "opacity 0.15s", minWidth: 0, position: "relative",
      }}
    >
      {/* Status dot — click to cycle through statuses */}
      <span
        title={`Status: ${STATUS_LABELS[c.status]} (click to cycle)`}
        onClick={e => {
          e.stopPropagation()
          const idx = ALL_STATUSES.indexOf(c.status)
          onSetStatus(id, ALL_STATUSES[(idx + 1) % ALL_STATUSES.length])
        }}
        style={{
          width: 7, height: 7, borderRadius: "50%",
          background: statusColor, flexShrink: 0,
          cursor: "pointer", display: "inline-block",
          border: "1px solid rgba(0,0,0,0.15)",
        }}
      />
      <input
        type="checkbox" checked={done} onChange={() => onToggleDone(id)} onClick={e => e.stopPropagation()}
        style={{ width: 11, height: 11, flexShrink: 0, cursor: "pointer", accentColor: colors.badge }}
      />
      <span
        title={c.name}
        style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          fontWeight: done ? 400 : 500, textDecoration: done ? "line-through" : "none", opacity: done ? 0.7 : 1 }}
      >{c.name}</span>
      {/* Derived tool activity this cycle (B5) — display-only */}
      {activity && (
        <span title={`This cycle: ${activity}`} style={{ flexShrink: 0, fontSize: 9, lineHeight: 1, opacity: 0.8 }}>⚡</span>
      )}
      {/* Note pencil icon */}
      <span
        className="chip-note-btn"
        onClick={e => { e.stopPropagation(); onOpenNote(id, c.note) }}
        title={hasNote ? `Note: ${c.note}` : "Add note"}
        style={{
          flexShrink: 0, fontSize: 10, lineHeight: 1, cursor: "pointer",
          opacity: hasNote ? 0.85 : 0.28, paddingLeft: 1,
        }}
      >✎</span>
      <select
        value={c.priority}
        onChange={e => { e.stopPropagation(); onSetPriority(id, +e.target.value) }}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        title="Priority 1=High, 5=Low"
        style={{
          background: colors.badge, color: "#fff", border: "none", borderRadius: 3,
          fontSize: 10, padding: "1px 2px", cursor: "pointer", fontWeight: 700,
          flexShrink: 0, width: 22, fontFamily: "inherit",
        }}
      >
        {[1,2,3,4,5].map(p => <option key={p} value={p}>{p}</option>)}
      </select>
      {fromWeek != null && (
        <span
          className="chip-x"
          onClick={e => { e.stopPropagation(); onReturn(id) }}
          title="Return to pool"
          style={{ flexShrink: 0, fontWeight: 700, fontSize: 12, lineHeight: 1, cursor: "pointer", opacity: 0.4, paddingLeft: 2 }}
        >×</span>
      )}
    </div>
  )
})
