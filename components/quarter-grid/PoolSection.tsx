// components/quarter-grid/PoolSection.tsx
'use client'

import { useState } from 'react'
import type { ClientStatus } from '@/lib/quarter-grid/state'
import type { GridClient } from '@/lib/quarter-grid/grid-ops'
import { Chip } from './Chip'

interface PoolSectionProps {
  unassigned: GridClient[]
  completed: Set<number>
  dragging: { id: number; fromWeek: number | null } | null
  hoveredPoolChipId: number | null
  setHoveredPoolChipId: (id: number | null) => void
  onPoolDragOver: (e: React.DragEvent) => void
  onPoolDrop: (e: React.DragEvent) => void
  onPoolDragLeave: () => void
  addClient: (name: string) => Promise<boolean>
  removeClient: (id: number) => void
  onDragStart: (e: React.DragEvent, id: number, fromWeek: number | null) => void
  onDragEnd: () => void
  onToggleDone: (id: number) => void
  onSetPriority: (id: number, p: number) => void
  onReturn: (id: number) => void
  onSetStatus: (id: number, status: ClientStatus) => void
  onOpenNote: (id: number, currentNote: string) => void
  activity: Record<number, string>
}

export function PoolSection({
  unassigned, completed, dragging, hoveredPoolChipId, setHoveredPoolChipId,
  onPoolDragOver, onPoolDrop, onPoolDragLeave, addClient, removeClient,
  onDragStart, onDragEnd, onToggleDone, onSetPriority, onReturn, onSetStatus, onOpenNote, activity,
}: PoolSectionProps) {
  // Leaf UI state — nothing outside the add-client form reads these.
  const [newClientName, setNewClientName] = useState('')
  const [addClientOpen, setAddClientOpen] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (await addClient(newClientName)) { setNewClientName(''); setAddClientOpen(false) }
  }

  return (
    <div
      style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, overflow: "hidden" }}
      onDragOver={onPoolDragOver}
      onDrop={onPoolDrop}
      onDragLeave={onPoolDragLeave}
    >
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "9px 14px",
        background: "#0f172a", borderBottom: (unassigned.length > 0 || addClientOpen) ? "1px solid #334155" : "none",
        flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 10, fontWeight: 500, color: "#64748b", letterSpacing: "0.08em", textTransform: "uppercase" }}>Unassigned</span>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 99,
          background: unassigned.length > 0 ? "#334155" : "#14532d",
          color: unassigned.length > 0 ? "#94a3b8" : "#4ade80",
        }}>
          {unassigned.length > 0 ? unassigned.length : "✓ all assigned"}
        </span>
        {/* Keyboard hint */}
        {hoveredPoolChipId && unassigned.length > 0 && (
          <span style={{ fontSize: 9, color: "#6366f1", letterSpacing: "0.03em" }}>
            1–5 priority · space → next slot
          </span>
        )}
        <div style={{ flex: 1 }} />
        {/* Add Client */}
        {addClientOpen ? (
          <form
            onSubmit={submit}
            style={{ display: "flex", gap: 4, alignItems: "center" }}
          >
            <input
              autoFocus
              value={newClientName}
              onChange={e => setNewClientName(e.target.value)}
              placeholder="client name…"
              style={{
                padding: "4px 8px", background: "#1e293b", border: "1px solid #6366f1",
                borderRadius: 6, color: "#e2e8f0", fontSize: 11, fontFamily: "inherit", width: 160, outline: "none",
              }}
            />
            <button type="submit" disabled={!newClientName.trim()} style={{
              padding: "4px 10px", background: newClientName.trim() ? "#6366f1" : "#1e293b",
              color: newClientName.trim() ? "#fff" : "#475569", border: "1px solid #334155",
              borderRadius: 6, fontSize: 11, cursor: newClientName.trim() ? "pointer" : "not-allowed", fontFamily: "inherit",
            }}>Add</button>
            <button type="button" onClick={() => { setAddClientOpen(false); setNewClientName('') }} style={{
              padding: "4px 8px", background: "transparent", color: "#64748b",
              border: "1px solid #334155", borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
            }}>✕</button>
          </form>
        ) : (
          <button onClick={() => setAddClientOpen(true)} style={{
            padding: "4px 10px", background: "transparent", color: "#6366f1",
            border: "1px solid #6366f1", borderRadius: 6, fontSize: 10,
            cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
          }}>+ Client</button>
        )}
      </div>
      {unassigned.length > 0 && (
        <div
          style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: 12 }}
          onPointerMove={e => {
            const el = document.elementFromPoint(e.clientX, e.clientY)
            const chipEl = el?.closest('[data-pool-chip]') as HTMLElement | null
            const id = chipEl ? (parseInt(chipEl.dataset.poolChip ?? '0', 10) || null) : null
            if (id !== hoveredPoolChipId) setHoveredPoolChipId(id)
          }}
          onPointerLeave={() => setHoveredPoolChipId(null)}
        >
          {unassigned.map(c => {
            const isHovered = hoveredPoolChipId === c.id
            return (
              <div
                key={c.id}
                data-pool-chip={c.id}
                style={{
                  borderRadius: 8,
                  outline: isHovered ? '2px solid #6366f1' : '2px solid transparent',
                  outlineOffset: 1,
                  transition: 'outline-color 0.1s',
                  position: 'relative',
                }}
              >
                <Chip
                  id={c.id}
                  fromWeek={null}
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
                {/* Remove client button — visible on hover */}
                <button
                  onClick={e => { e.stopPropagation(); removeClient(c.id) }}
                  title="Remove client"
                  style={{
                    display: isHovered ? 'flex' : 'none',
                    position: 'absolute', top: -6, right: -6,
                    width: 14, height: 14, alignItems: 'center', justifyContent: 'center',
                    background: '#ef4444', color: '#fff', border: 'none', borderRadius: '50%',
                    fontSize: 9, cursor: 'pointer', lineHeight: 1, fontWeight: 700, zIndex: 10,
                    padding: 0,
                  }}
                >×</button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
