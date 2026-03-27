'use client'

import { useState, useEffect, useRef, memo, useCallback } from 'react'
import Papa from 'papaparse'

// ─── Types ────────────────────────────────────────────────────────────────────

type ClientStatus = 'not_started' | 'in_progress' | 'on_hold' | 'blocked' | 'complete'
type Client = { id: number; name: string; priority: number; status: ClientStatus; note: string }
type Schedule = Record<number, number[]>
type Snapshots = Record<string, { schedule: Schedule; completed: number[]; clients: Client[] }>

// ─── Constants ────────────────────────────────────────────────────────────────

const INITIAL_CLIENTS: Client[] = [
  { id: 1,  name: "Beal University" },
  { id: 2,  name: "BEONAIR (M & S Media Inc.)" },
  { id: 3,  name: "Bidwell Training Center" },
  { id: 4,  name: "Boca Beauty Academy" },
  { id: 5,  name: "Brockway Center for Arts and Technology" },
  { id: 6,  name: "Brownson Technical School" },
  { id: 7,  name: "Federico Beauty Institute" },
  { id: 8,  name: "Florida Education Institute (FEI)" },
  { id: 9,  name: "Healthcare Career College" },
  { id: 10, name: "Hilbert College" },
  { id: 11, name: "Innovate Salon Academy" },
  { id: 12, name: "Manhattan School of Computer Technology" },
  { id: 13, name: "Milan Institute" },
  { id: 14, name: "New York Institute of Massage" },
  { id: 15, name: "Nuvani Institute" },
  { id: 16, name: "Penrose Academy" },
  { id: 17, name: "Prism Career Institute" },
  { id: 18, name: "San Diego Global Knowledge University" },
  { id: 19, name: "Southwest Schools" },
  { id: 20, name: "Sutter County Career Training Center" },
  { id: 21, name: "The College of Westchester" },
  { id: 22, name: "The Soma Institute" },
  { id: 23, name: "Urban River Massage Therapy School" },
  { id: 24, name: "Valley College" },
  { id: 25, name: "Wellspring School of Allied Health" },
  { id: 26, name: "Discovery Community College" },
  { id: 27, name: "Canadian College of Health Science & Technology" },
  { id: 28, name: "Canadian College of Business, Science & Technology" },
  { id: 29, name: "Cambria College" },
  { id: 30, name: "Glow College of Artistic Design" },
].map(c => ({ ...c, priority: 3, status: 'not_started' as ClientStatus, note: '' }))

const PCOLORS: Record<number, { chip: string; border: string; text: string; badge: string; label: string }> = {
  1: { chip: "#fee2e2", border: "#f87171", text: "#991b1b", badge: "#ef4444", label: "P1 · High" },
  2: { chip: "#ffedd5", border: "#fb923c", text: "#9a3412", badge: "#f97316", label: "P2" },
  3: { chip: "#fef9c3", border: "#facc15", text: "#713f12", badge: "#eab308", label: "P3 · Med" },
  4: { chip: "#dbeafe", border: "#60a5fa", text: "#1e3a8a", badge: "#3b82f6", label: "P4" },
  5: { chip: "#f1f5f9", border: "#94a3b8", text: "#334155", badge: "#94a3b8", label: "P5 · Low" },
}

const STATUS_COLORS: Record<ClientStatus, string> = {
  not_started: '#94a3b8',
  in_progress:  '#3b82f6',
  on_hold:      '#eab308',
  blocked:      '#ef4444',
  complete:     '#22c55e',
}

const STATUS_LABELS: Record<ClientStatus, string> = {
  not_started: 'Not Started',
  in_progress:  'In Progress',
  on_hold:      'On Hold',
  blocked:      'Blocked',
  complete:     'Complete',
}

const ALL_STATUSES: ClientStatus[] = ['not_started', 'in_progress', 'on_hold', 'blocked', 'complete']

const NUM_WEEKS = 13
const SLOT_LABELS = ["Mon", "Wed", "Fri"]
const STORAGE_KEY = "seo-quarter-v3"

// ─── Chip Component ───────────────────────────────────────────────────────────

interface ChipProps {
  id: number
  fromWeek: number | null
  client: Client
  done: boolean
  isDragging: boolean
  onDragStart: (e: React.DragEvent, id: number, fromWeek: number | null) => void
  onDragEnd: () => void
  onToggleDone: (id: number) => void
  onSetPriority: (id: number, p: number) => void
  onReturn: (id: number) => void
  onSetStatus: (id: number, status: ClientStatus) => void
  onOpenNote: (id: number, currentNote: string) => void
}

const Chip = memo(function Chip({
  id, fromWeek, client: c, done, isDragging,
  onDragStart, onDragEnd, onToggleDone, onSetPriority, onReturn,
  onSetStatus, onOpenNote,
}: ChipProps) {
  const colors = done
    ? { chip: "#dcfce7", border: "#4ade80", text: "#14532d", badge: "#22c55e" }
    : PCOLORS[c.priority]
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

// ─── Main Component ───────────────────────────────────────────────────────────

export default function QuarterGridV3() {
  const [clients, setClients]         = useState<Client[]>(() => INITIAL_CLIENTS)
  const [schedule, setSchedule]       = useState<Schedule>({})
  const [completed, setCompleted]     = useState<Set<number>>(new Set())
  const [slotsPerWeek, setSlots]      = useState(2)
  const [snapshots, setSnapshots]     = useState<Snapshots>({})
  const [snapName, setSnapName]       = useState("")
  const [loadSnap, setLoadSnap]       = useState("")
  const [startDate, setStartDate]     = useState("")
  const [dragging, setDragging]       = useState<{ id: number; fromWeek: number | null } | null>(null)
  const [dropTarget, setDropTarget]   = useState<{ week: number | string; slot: number } | null>(null)
  const [toast, setToast]             = useState<string | null>(null)
  const [loaded, setLoaded]           = useState(false)
  const [exportModal, setExportModal] = useState(false)
  const [exportText, setExportText]   = useState("")
  const [view, setView]               = useState<'grid' | 'gantt'>('grid')
  const [noteModal, setNoteModal]     = useState<{ id: number; note: string } | null>(null)
  const [noteDraft, setNoteDraft]     = useState("")
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const csvInputRef = useRef<HTMLInputElement | null>(null)

  // Clear pending toast timer on unmount
  useEffect(() => {
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current) }
  }, [])

  const flash = (msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(msg)
    toastTimer.current = setTimeout(() => setToast(null), 2800)
  }

  // ─── localStorage restore ────────────────────────────────────────────────

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const d = JSON.parse(raw)
        if (d.clients) {
          // Backfill status/note for data persisted before this feature was added
          setClients(d.clients.map((c: Partial<Client> & { id: number; name: string; priority: number }) => ({
            status: 'not_started' as ClientStatus,
            note: '',
            ...c,
          })))
        }
        if (d.schedule)     setSchedule(d.schedule)
        if (d.completed)    setCompleted(new Set(d.completed))
        if (d.slotsPerWeek) setSlots(d.slotsPerWeek)
        if (d.snapshots)    setSnapshots(d.snapshots)
        if (d.startDate)    setStartDate(d.startDate)
      }
    } catch {}
    setLoaded(true)
  }, [])

  const persist = (overrides = {}) => {
    const state = {
      clients, schedule, completed: Array.from(completed),
      slotsPerWeek, snapshots, startDate, ...overrides
    }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch {}
  }

  useEffect(() => { if (loaded) persist() }, [clients, schedule, completed, slotsPerWeek, snapshots, startDate]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Derived values ──────────────────────────────────────────────────────

  const assignedIds = new Set(Object.values(schedule).flat())
  const unassigned  = clients
    .filter(c => !assignedIds.has(c.id))
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
  const getClient = (id: number) => clients.find(c => c.id === id)
  const doneCount = completed.size
  const pct       = Math.round((doneCount / 30) * 100)

  // ─── Handlers ────────────────────────────────────────────────────────────

  const autoDistribute = () => {
    const sorted = [...clients].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
    const total  = sorted.length
    const ns: Schedule = {}
    if (slotsPerWeek === 3) {
      let w = 1, s = 0
      for (const c of sorted) {
        if (!ns[w]) ns[w] = []
        ns[w].push(c.id)
        if (++s >= 3) { w++; s = 0 }
      }
    } else {
      const heavyWeeks = new Set([1, 4, 7, 11])
      const weekCaps   = Array.from({ length: NUM_WEEKS }, (_, i) => heavyWeeks.has(i + 1) ? 3 : 2)
      let ci = 0
      for (let wi = 0; wi < NUM_WEEKS && ci < total; wi++) {
        ns[wi + 1] = []
        for (let s = 0; s < weekCaps[wi] && ci < total; s++) {
          ns[wi + 1].push(sorted[ci++].id)
        }
      }
    }
    setSchedule(ns)
    flash("⚡ Auto-distributed across 13 weeks")
  }

  const setPriority  = (id: number, p: number) => setClients(prev => prev.map(c => c.id === id ? { ...c, priority: p } : c))
  const toggleDone   = (id: number) => setCompleted(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const returnToPool = (id: number) => setSchedule(prev => {
    const ns = { ...prev }
    Object.keys(ns).forEach(w => { ns[+w] = ns[+w].filter(x => x !== id) })
    return ns
  })

  const setStatus = useCallback((id: number, status: ClientStatus) => {
    setClients(prev => prev.map(c => c.id === id ? { ...c, status } : c))
  }, [])

  const saveNote = (id: number, note: string) => {
    setClients(prev => prev.map(c => c.id === id ? { ...c, note } : c))
  }

  const openNoteModal = useCallback((id: number, currentNote: string) => {
    setNoteModal({ id, note: currentNote })
    setNoteDraft(currentNote)
  }, [])

  const handleNoteSave = () => {
    if (noteModal) {
      saveNote(noteModal.id, noteDraft.slice(0, 120))
      setNoteModal(null)
    }
  }

  const saveSnapshot = () => {
    if (!snapName.trim()) return
    const snap = {
      schedule:  JSON.parse(JSON.stringify(schedule)),
      completed: Array.from(completed),
      clients:   JSON.parse(JSON.stringify(clients)),
    }
    setSnapshots(prev => ({ ...prev, [snapName.trim()]: snap }))
    flash(`💾 Saved "${snapName.trim()}"`)
    setSnapName("")
  }

  const applySnapshot = () => {
    if (!loadSnap || !snapshots[loadSnap]) return
    const s = snapshots[loadSnap]
    setSchedule(s.schedule)
    setCompleted(new Set(s.completed))
    setClients(s.clients)
    flash(`📂 Loaded "${loadSnap}"`)
  }

  const deleteSnapshot = () => {
    if (!loadSnap) return
    const name = loadSnap
    setSnapshots(prev => { const n = { ...prev }; delete n[name]; return n })
    setLoadSnap("")
    flash(`🗑 Deleted "${name}"`)
  }

  const resetAll = () => {
    setSchedule({})
    setCompleted(new Set())
    setClients(INITIAL_CLIENTS)
    flash("🔄 Reset — all clients returned to pool")
  }

  const getWeekRange = (weekNum: number) => {
    if (!startDate) return null
    const base = new Date(startDate + "T00:00:00")
    if (isNaN(base.getTime())) return null
    const mon = new Date(base)
    mon.setDate(base.getDate() + (weekNum - 1) * 7)
    const fri = new Date(mon)
    fri.setDate(mon.getDate() + 4)
    const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`
    return `${fmt(mon)}–${fmt(fri)}`
  }

  const isoDate = (weekNum: number, offsetDays = 0) => {
    if (!startDate) return null
    const base = new Date(startDate + "T00:00:00")
    if (isNaN(base.getTime())) return null
    const d = new Date(base)
    d.setDate(base.getDate() + (weekNum - 1) * 7 + offsetDays)
    return d.toISOString().split("T")[0]
  }

  const buildExport = () => {
    const rows: object[] = []
    for (let w = 1; w <= NUM_WEEKS; w++) {
      ;(schedule[w] || []).forEach((id, si) => {
        const c = getClient(id)
        if (!c) return
        const offsets = [0, 2, 4]
        rows.push({
          client:    c.name,
          priority:  c.priority,
          status:    c.status,
          note:      c.note,
          week:      w,
          weekStart: isoDate(w, 0),
          weekEnd:   isoDate(w, 4),
          slotDay:   SLOT_LABELS[si] ?? `Slot ${si + 1}`,
          dueDate:   isoDate(w, offsets[si] ?? si * 2),
          completed: completed.has(id),
        })
      })
    }
    unassigned.forEach(c => {
      rows.push({
        client: c.name, priority: c.priority, status: c.status, note: c.note,
        week: null, weekStart: null, weekEnd: null, slotDay: null, dueDate: null, completed: false,
      })
    })
    return JSON.stringify(rows, null, 2)
  }

  const openExport = () => { setExportText(buildExport()); setExportModal(true) }
  const copyExport = () => {
    navigator.clipboard.writeText(exportText).then(() => flash("📋 Copied to clipboard"))
  }

  // ─── CSV Import ──────────────────────────────────────────────────────────

  const handleCsvFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result
      if (typeof text !== 'string') return

      const parsed = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h: string) => h.trim().toLowerCase(),
      })

      const unrecognized: string[] = []
      let assignCount = 0

      const newSchedule: Schedule = JSON.parse(JSON.stringify(schedule))
      const clientUpdates = new Map<number, Partial<Client>>()

      for (const row of parsed.data) {
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

        const upd: Partial<Client> = {}
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

      if (clientUpdates.size > 0) {
        setClients(prev => prev.map(c => {
          const upd = clientUpdates.get(c.id)
          return upd ? { ...c, ...upd } : c
        }))
      }

      setSchedule(newSchedule)

      const msgs: string[] = []
      if (assignCount > 0) msgs.push(`Imported ${assignCount} assignment${assignCount !== 1 ? 's' : ''}`)
      if (unrecognized.length > 0) {
        msgs.push(`Unrecognized: ${unrecognized.slice(0, 3).join(', ')}${unrecognized.length > 3 ? ` +${unrecognized.length - 3} more` : ''}`)
      }
      flash(msgs.join(' · ') || 'No data found in CSV')
    }
    reader.readAsText(file)
  }

  const onCsvInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleCsvFile(file)
    e.target.value = '' // reset so same file can be re-imported
  }

  // ─── Drag & Drop ─────────────────────────────────────────────────────────

  const onDragStart = (e: React.DragEvent, id: number, fromWeek: number | null) => {
    setDragging({ id, fromWeek })
    e.dataTransfer.effectAllowed = "move"
  }
  const onDragOver = (e: React.DragEvent, week: number, slot: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    setDropTarget({ week, slot })
  }
  const onDragEnd = () => { setDragging(null); setDropTarget(null) }

  const onDrop = (e: React.DragEvent, targetWeek: number, targetSlot: number) => {
    e.preventDefault()
    if (!dragging) return
    const { id, fromWeek } = dragging
    const ns: Schedule = JSON.parse(JSON.stringify(schedule))
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
    setSchedule(ns)
    setDragging(null)
    setDropTarget(null)
  }

  const onDropPool = (e: React.DragEvent) => {
    e.preventDefault()
    if (dragging?.fromWeek !== null && dragging) returnToPool(dragging.id)
    setDragging(null)
    setDropTarget(null)
  }

  const maxCols = Math.max(slotsPerWeek, ...Array.from({ length: NUM_WEEKS }, (_, i) => (schedule[i + 1] || []).length))

  // ─── Gantt data ──────────────────────────────────────────────────────────

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

  const ROW_HEIGHT = 36
  const GANTT_HEADER_H = 32
  const GANTT_MAX_SCROLL_ROWS = 20

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

      {/* ─── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: "14px 18px", marginBottom: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 12, justifyContent: "space-between" }}>

          {/* Title + progress */}
          <div style={{ minWidth: 200 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 15, fontWeight: 500, color: "#f1f5f9", letterSpacing: "-0.3px" }}>SEO Quarter Grid <span style={{ fontSize: 10, color: "#6366f1", background: "#1e1b4b", padding: "1px 6px", borderRadius: 4, marginLeft: 4 }}>V3</span></span>
              <span style={{ fontSize: 11, color: "#64748b" }}>30 clients · 13 wks · {pct}%</span>
            </div>
            <div style={{ height: 5, background: "#0f172a", borderRadius: 99, width: 240, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, background: "linear-gradient(90deg,#22c55e,#4ade80)", borderRadius: 99, transition: "width 0.3s" }} />
            </div>
            <div style={{ marginTop: 4, fontSize: 10, color: "#475569" }}>{doneCount}/30 done · {unassigned.length} unassigned</div>
          </div>

          {/* Controls */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>

            {/* Grid / Gantt view toggle */}
            <div style={{ display: "flex", background: "#0f172a", borderRadius: 6, overflow: "hidden", border: "1px solid #334155" }}>
              {(['grid', 'gantt'] as const).map(v => (
                <button key={v} onClick={() => setView(v)} style={{
                  padding: "5px 12px", fontSize: 11, border: "none", cursor: "pointer", fontFamily: "inherit",
                  background: view === v ? "#6366f1" : "transparent",
                  color: view === v ? "#fff" : "#64748b",
                  fontWeight: view === v ? 500 : 400, transition: "all 0.15s",
                  textTransform: "capitalize",
                }}>{v}</button>
              ))}
            </div>

            {/* Slots/week toggle */}
            <div style={{ display: "flex", background: "#0f172a", borderRadius: 6, overflow: "hidden", border: "1px solid #334155" }}>
              {[2, 3].map(n => (
                <button key={n} onClick={() => setSlots(n)} style={{
                  padding: "5px 12px", fontSize: 11, border: "none", cursor: "pointer", fontFamily: "inherit",
                  background: slotsPerWeek === n ? "#6366f1" : "transparent",
                  color: slotsPerWeek === n ? "#fff" : "#64748b",
                  fontWeight: slotsPerWeek === n ? 500 : 400, transition: "all 0.15s",
                }}>{n}/wk</button>
              ))}
            </div>

            <button onClick={autoDistribute} style={{
              padding: "5px 14px", background: "#6366f1", color: "#fff", border: "none",
              borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: "inherit", fontWeight: 500,
            }}>⚡ Auto-Distribute</button>

            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ fontSize: 10, color: "#64748b", whiteSpace: "nowrap" }}>Wk 1 start:</span>
              <input
                type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                style={{
                  padding: "4px 8px", background: "#0f172a", border: "1px solid #334155",
                  borderRadius: 6, color: "#e2e8f0", fontSize: 11, fontFamily: "inherit", colorScheme: "dark",
                }}
              />
            </div>

            <button onClick={resetAll} style={{
              padding: "5px 12px", background: "transparent", color: "#f87171",
              border: "1px solid #f87171", borderRadius: 6, fontSize: 11,
              cursor: "pointer", fontFamily: "inherit", fontWeight: 500,
            }}>↺ Reset</button>

            {/* Import CSV — hidden file input triggered by button */}
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv"
              style={{ display: "none" }}
              onChange={onCsvInputChange}
            />
            <button onClick={() => csvInputRef.current?.click()} style={{
              padding: "5px 12px", background: "#0f172a", color: "#a78bfa",
              border: "1px solid #a78bfa", borderRadius: 6, fontSize: 11,
              cursor: "pointer", fontFamily: "inherit", fontWeight: 500,
            }}>⬆ Import CSV</button>

            <button onClick={openExport} style={{
              padding: "5px 12px", background: "#0f172a", color: "#34d399",
              border: "1px solid #34d399", borderRadius: 6, fontSize: 11,
              cursor: "pointer", fontFamily: "inherit", fontWeight: 500,
            }}>⬇ Export JSON</button>

            <div style={{ display: "flex", gap: 4 }}>
              <input
                value={snapName} onChange={e => setSnapName(e.target.value)}
                placeholder="snapshot name…"
                style={{
                  padding: "5px 10px", background: "#0f172a", border: "1px solid #334155",
                  borderRadius: 6, color: "#e2e8f0", fontSize: 11, fontFamily: "inherit", width: 130,
                }}
              />
              <button onClick={saveSnapshot} disabled={!snapName.trim()} style={{
                padding: "5px 10px", background: snapName.trim() ? "#059669" : "#1e293b",
                color: snapName.trim() ? "#fff" : "#475569", border: "1px solid #334155",
                borderRadius: 6, fontSize: 11, cursor: snapName.trim() ? "pointer" : "not-allowed", fontFamily: "inherit",
              }}>Save</button>
            </div>

            {Object.keys(snapshots).length > 0 && (
              <div style={{ display: "flex", gap: 4 }}>
                <select value={loadSnap} onChange={e => setLoadSnap(e.target.value)} style={{
                  padding: "5px 8px", background: "#0f172a", border: "1px solid #334155",
                  borderRadius: 6, color: "#e2e8f0", fontSize: 11, fontFamily: "inherit",
                }}>
                  <option value="">load…</option>
                  {Object.keys(snapshots).map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <button onClick={applySnapshot} disabled={!loadSnap} style={{
                  padding: "5px 8px", background: loadSnap ? "#0369a1" : "#1e293b",
                  color: loadSnap ? "#fff" : "#475569", border: "1px solid #334155",
                  borderRadius: 6, fontSize: 11, cursor: loadSnap ? "pointer" : "not-allowed", fontFamily: "inherit",
                }}>↩</button>
                <button onClick={deleteSnapshot} disabled={!loadSnap} style={{
                  padding: "5px 8px", background: "transparent", color: loadSnap ? "#f87171" : "#475569",
                  border: "1px solid #334155", borderRadius: 6, fontSize: 11,
                  cursor: loadSnap ? "pointer" : "not-allowed", fontFamily: "inherit",
                }}>✕</button>
              </div>
            )}
          </div>
        </div>

        {/* Legend */}
        <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
          {[1,2,3,4,5].map(p => (
            <span key={p} style={{
              fontSize: 10, padding: "2px 8px", borderRadius: 99,
              background: PCOLORS[p].chip, border: `1px solid ${PCOLORS[p].border}`,
              color: PCOLORS[p].text, fontWeight: 500,
            }}>{PCOLORS[p].label}</span>
          ))}
          <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, background: "#dcfce7", border: "1px solid #4ade80", color: "#14532d", fontWeight: 500 }}>✓ Done</span>
          <span style={{ fontSize: 10, color: "#475569", marginLeft: 6 }}>Status dots:</span>
          {ALL_STATUSES.map(s => (
            <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, color: "#64748b" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: STATUS_COLORS[s], display: "inline-block", flexShrink: 0 }} />
              {STATUS_LABELS[s]}
            </span>
          ))}
        </div>
      </div>

      {/* ─── Grid View ────────────────────────────────────────────────────────── */}
      {view === 'grid' && (
        <>
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
                      {getWeekRange(week) && (
                        <span style={{ fontSize: 9, color: "#334155", whiteSpace: "nowrap" }}>{getWeekRange(week)}</span>
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
                          onDragLeave={() => setDropTarget(null)}
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
                                onToggleDone={toggleDone}
                                onSetPriority={setPriority}
                                onReturn={returnToPool}
                                onSetStatus={setStatus}
                                onOpenNote={openNoteModal}
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

          {/* Unassigned Pool */}
          <div
            style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, overflow: "hidden" }}
            onDragOver={e => { e.preventDefault(); setDropTarget({ week: "pool", slot: 0 }) }}
            onDrop={onDropPool}
            onDragLeave={() => setDropTarget(null)}
          >
            <div style={{
              display: "flex", alignItems: "center", gap: 8, padding: "9px 14px",
              background: "#0f172a", borderBottom: unassigned.length > 0 ? "1px solid #334155" : "none",
            }}>
              <span style={{ fontSize: 10, fontWeight: 500, color: "#64748b", letterSpacing: "0.08em", textTransform: "uppercase" }}>Unassigned</span>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 99,
                background: unassigned.length > 0 ? "#334155" : "#14532d",
                color: unassigned.length > 0 ? "#94a3b8" : "#4ade80",
              }}>
                {unassigned.length > 0 ? unassigned.length : "✓ all assigned"}
              </span>
            </div>
            {unassigned.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: 12 }}>
                {unassigned.map(c => (
                  <Chip
                    key={c.id}
                    id={c.id}
                    fromWeek={null}
                    client={c}
                    done={completed.has(c.id)}
                    isDragging={dragging?.id === c.id}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                    onToggleDone={toggleDone}
                    onSetPriority={setPriority}
                    onReturn={returnToPool}
                    onSetStatus={setStatus}
                    onOpenNote={openNoteModal}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ─── Gantt View ───────────────────────────────────────────────────────── */}
      {view === 'gantt' && (
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
                const range = getWeekRange(w)
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
                const colors = isDone
                  ? { chip: "#dcfce7", border: "#4ade80", text: "#14532d", badge: "#22c55e" }
                  : PCOLORS[c.priority]
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
              background: unassigned.length > 0 ? "#334155" : "#14532d",
              color: unassigned.length > 0 ? "#94a3b8" : "#4ade80",
            }}>
              {unassigned.length > 0 ? `${unassigned.length} clients unassigned` : "✓ all assigned"}
            </span>
          </div>
        </div>
      )}

      {/* ─── Note Modal ───────────────────────────────────────────────────────── */}
      {noteModal && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
          onClick={() => setNoteModal(null)}
        >
          <div
            style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, width: "100%", maxWidth: 400, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 64px rgba(0,0,0,0.6)" }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid #334155", background: "#0f172a" }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: "#f1f5f9", fontFamily: "'DM Mono',monospace" }}>
                {clients.find(cl => cl.id === noteModal.id)?.name ?? 'Client'}
              </span>
              <button onClick={() => setNoteModal(null)} style={{ padding: "3px 8px", background: "transparent", color: "#64748b", border: "1px solid #334155", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>✕</button>
            </div>
            {/* Textarea */}
            <div style={{ padding: 16 }}>
              <textarea
                value={noteDraft}
                onChange={e => setNoteDraft(e.target.value.slice(0, 120))}
                maxLength={120}
                rows={4}
                placeholder="Add a short note (max 120 chars)…"
                autoFocus
                style={{
                  width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 6,
                  color: "#e2e8f0", fontSize: 11, fontFamily: "'DM Mono',monospace",
                  padding: "8px 10px", resize: "vertical", boxSizing: "border-box",
                  lineHeight: 1.5, outline: "none",
                }}
              />
              <div style={{ fontSize: 9, color: "#475569", marginTop: 4, textAlign: "right" }}>{noteDraft.length}/120</div>
            </div>
            {/* Actions */}
            <div style={{ display: "flex", gap: 8, padding: "10px 16px", borderTop: "1px solid #334155", background: "#0f172a", justifyContent: "flex-end" }}>
              <button onClick={() => setNoteModal(null)} style={{
                padding: "5px 14px", background: "transparent", color: "#64748b",
                border: "1px solid #334155", borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: "'DM Mono',monospace",
              }}>Cancel</button>
              <button onClick={handleNoteSave} style={{
                padding: "5px 14px", background: "#059669", color: "#fff",
                border: "none", borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: "'DM Mono',monospace", fontWeight: 500,
              }}>Save Note</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Export Modal ─────────────────────────────────────────────────────── */}
      {exportModal && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
          onClick={() => setExportModal(false)}
        >
          <div
            style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, width: "100%", maxWidth: 680, maxHeight: "80vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 64px rgba(0,0,0,0.6)" }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid #334155", background: "#0f172a" }}>
              <div>
                <span style={{ fontSize: 13, fontWeight: 500, color: "#f1f5f9", fontFamily: "'DM Mono',monospace" }}>Export — Teamwork-Ready JSON</span>
                <div style={{ fontSize: 10, color: "#475569", marginTop: 2, fontFamily: "'DM Mono',monospace" }}>
                  Fields: client · priority · status · note · week · weekStart · weekEnd · slotDay · dueDate · completed
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={copyExport} style={{ padding: "5px 14px", background: "#059669", color: "#fff", border: "none", borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: "'DM Mono',monospace", fontWeight: 500 }}>📋 Copy</button>
                <button onClick={() => setExportModal(false)} style={{ padding: "5px 10px", background: "transparent", color: "#64748b", border: "1px solid #334155", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>✕</button>
              </div>
            </div>
            <pre style={{ flex: 1, overflowY: "auto", margin: 0, padding: 16, fontSize: 11, lineHeight: 1.6, color: "#a3e635", background: "#0a0f1a", fontFamily: "'DM Mono','Courier New',monospace", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {exportText}
            </pre>
            <div style={{ padding: "10px 18px", borderTop: "1px solid #334155", background: "#0f172a", fontSize: 10, color: "#475569", fontFamily: "'DM Mono',monospace" }}>
              Tip: paste this into a new chat with the Teamwork MCP connected — ask it to create tasklists from a template under each client&apos;s SEO project, using <code style={{ color: "#94a3b8" }}>dueDate</code> for due dates and <code style={{ color: "#94a3b8" }}>client</code> to match the project name.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
