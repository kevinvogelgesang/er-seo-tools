'use client'

// SEO Quarter Grid (V3). B4 split: data/persistence lives in useQuarterPlan,
// pure schedule math in lib/quarter-grid/grid-ops, presentation in
// components/quarter-grid/*. This page owns only UI state (view, drag,
// toast, note modal, pool hover) and composition.

import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuarterPlan } from '@/components/quarter-grid/useQuarterPlan'
import { usePoolKeyboard } from '@/components/quarter-grid/usePoolKeyboard'
import { GridHeader } from '@/components/quarter-grid/GridHeader'
import { WeekGrid } from '@/components/quarter-grid/WeekGrid'
import { PoolSection } from '@/components/quarter-grid/PoolSection'
import { AssignedSection } from '@/components/quarter-grid/AssignedSection'
import { GanttView } from '@/components/quarter-grid/GanttView'
import { NoteModal } from '@/components/quarter-grid/NoteModal'

export default function QuarterGridV3() {
  const [view, setView]             = useState<'grid' | 'gantt'>('grid')
  const [dragging, setDragging]     = useState<{ id: number; fromWeek: number | null } | null>(null)
  const [dropTarget, setDropTarget] = useState<{ week: number | string; slot: number } | null>(null)
  const [toast, setToast]           = useState<string | null>(null)
  const [noteModal, setNoteModal]   = useState<{ id: number; note: string } | null>(null)
  const [hoveredPoolChipId, setHoveredPoolChipId] = useState<number | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flash = (msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(msg)
    toastTimer.current = setTimeout(() => setToast(null), 2800)
  }
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  const plan = useQuarterPlan({ onToast: flash })

  usePoolKeyboard({
    hoveredPoolChipId, setHoveredPoolChipId,
    setPriority: plan.setPriority,
    assignHoveredToFrontier: plan.assignHoveredToFrontier,
    onToast: flash,
  })

  // ─── Drag & Drop ─────────────────────────────────────────────────────────
  // Drag state is page-owned (grid, pool, and assigned sections all
  // participate); schedule mutation goes through the hook.

  const onDragStart = (e: React.DragEvent, id: number, fromWeek: number | null) => {
    setDragging({ id, fromWeek })
    e.dataTransfer.effectAllowed = 'move'
  }
  const onDragOver = (e: React.DragEvent, week: number, slot: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropTarget({ week, slot })
  }
  const onDragEnd = () => { setDragging(null); setDropTarget(null) }

  const onDrop = (e: React.DragEvent, targetWeek: number, targetSlot: number) => {
    e.preventDefault()
    if (!dragging) return
    plan.dropChip(dragging, targetWeek, targetSlot)
    setDragging(null)
    setDropTarget(null)
  }

  const onPoolDragOver = (e: React.DragEvent) => { e.preventDefault(); setDropTarget({ week: 'pool', slot: 0 }) }
  const onPoolDrop = (e: React.DragEvent) => {
    e.preventDefault()
    if (dragging?.fromWeek !== null && dragging) plan.returnToPool(dragging.id)
    setDragging(null)
    setDropTarget(null)
  }
  const onPoolDragLeave = () => setDropTarget(null)
  const onDragLeave = () => setDropTarget(null)

  const openNoteModal = useCallback((id: number, currentNote: string) => {
    setNoteModal({ id, note: currentNote })
  }, [])

  const chipHandlers = {
    onDragStart, onDragEnd,
    onToggleDone: plan.toggleDone,
    onSetPriority: plan.setPriority,
    onReturn: plan.returnToPool,
    onSetStatus: plan.setStatus,
    onOpenNote: openNoteModal,
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ fontFamily: "'DM Mono','Courier New',monospace", background: "#0f172a", minHeight: "100vh", padding: 16, color: "#e2e8f0" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&display=swap');
        .chip-row:hover .chip-x { opacity: 0.9 !important; }
        .chip-row:hover .chip-note-btn { opacity: 0.75 !important; }
        .drop-zone:hover { border-color: #6366f1 !important; background: rgba(99,102,241,0.05) !important; }
        select option { background: #1e293b; color: #e2e8f0; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #1e293b; }
        ::-webkit-scrollbar-thumb { background: #475569; border-radius: 3px; }
      `}</style>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 16, right: 16, zIndex: 9999,
          background: "#1e293b", border: "1px solid #334155", color: "#e2e8f0",
          padding: "10px 16px", borderRadius: 8, fontSize: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          fontFamily: "'DM Mono',monospace",
        }}>{toast}</div>
      )}

      <GridHeader
        totalClients={plan.totalClients}
        doneCount={plan.doneCount}
        unassignedCount={plan.unassigned.length}
        pct={plan.pct}
        loaded={plan.loaded}
        canPersist={plan.canPersist}
        saveState={plan.saveState}
        view={view}
        setView={setView}
        slotsPerWeek={plan.slotsPerWeek}
        setSlotsPerWeek={plan.setSlotsPerWeek}
        startDate={plan.startDate}
        setStartDate={plan.setStartDate}
        onAutoDistribute={plan.autoDistribute}
        onReset={plan.resetAll}
        onCsvRows={plan.applyCsv}
        layouts={plan.layouts}
        saveLayout={plan.saveLayout}
        applyLayout={plan.applyLayout}
        deleteLayout={plan.deleteLayout}
      />

      {view === 'grid' && (
        <>
          <WeekGrid
            schedule={plan.schedule}
            completed={plan.completed}
            slotsPerWeek={plan.slotsPerWeek}
            startDate={plan.startDate}
            dragging={dragging}
            dropTarget={dropTarget}
            getClient={plan.getClient}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            {...chipHandlers}
          />
          <PoolSection
            unassigned={plan.unassigned}
            completed={plan.completed}
            dragging={dragging}
            hoveredPoolChipId={hoveredPoolChipId}
            setHoveredPoolChipId={setHoveredPoolChipId}
            onPoolDragOver={onPoolDragOver}
            onPoolDrop={onPoolDrop}
            onPoolDragLeave={onPoolDragLeave}
            addClient={plan.addClient}
            removeClient={plan.removeClient}
            {...chipHandlers}
          />
          <AssignedSection
            schedule={plan.schedule}
            clients={plan.clients}
            completed={plan.completed}
            startDate={plan.startDate}
            assignedCount={plan.assignedIds.size}
            dragging={dragging}
            {...chipHandlers}
          />
        </>
      )}

      {view === 'gantt' && (
        <GanttView
          clients={plan.clients}
          schedule={plan.schedule}
          completed={plan.completed}
          startDate={plan.startDate}
          unassignedCount={plan.unassigned.length}
        />
      )}

      {noteModal && (
        <NoteModal
          id={noteModal.id}
          note={noteModal.note}
          clientName={plan.getClient(noteModal.id)?.name ?? 'Client'}
          onSave={plan.saveNote}
          onClose={() => setNoteModal(null)}
        />
      )}
    </div>
  )
}
