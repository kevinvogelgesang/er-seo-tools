// components/quarter-grid/GridHeader.tsx
'use client'

import { useRef } from 'react'
import Papa from 'papaparse'
import { ALL_STATUSES, type PushSummary, type Snapshots } from '@/lib/quarter-grid/state'
import type { SaveState } from './useQuarterPlan'
import { PCOLORS, STATUS_COLORS, STATUS_LABELS } from './theme'
import { LayoutManager } from './LayoutManager'
import { PushToTeamworkButton } from './PushToTeamworkButton'

interface GridHeaderProps {
  totalClients: number
  doneCount: number
  unassignedCount: number
  pct: number
  loaded: boolean
  canPersist: boolean
  saveState: SaveState
  view: 'grid' | 'gantt'
  setView: (v: 'grid' | 'gantt') => void
  slotsPerWeek: number
  setSlotsPerWeek: (n: number) => void
  startDate: string
  setStartDate: (d: string) => void
  onAutoDistribute: () => void
  onReset: () => void
  onCsvRows: (rows: Record<string, string>[]) => void
  layouts: Snapshots
  saveLayout: (name: string) => void
  applyLayout: (name: string) => void
  deleteLayout: (name: string) => void
  pushMeta: { pushedAt: string; summary: PushSummary | null } | null
}

export function GridHeader({
  totalClients, doneCount, unassignedCount, pct, loaded, canPersist, saveState,
  view, setView, slotsPerWeek, setSlotsPerWeek, startDate, setStartDate,
  onAutoDistribute, onReset, onCsvRows, layouts, saveLayout, applyLayout, deleteLayout,
  pushMeta,
}: GridHeaderProps) {
  const csvInputRef = useRef<HTMLInputElement | null>(null)

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
      onCsvRows(parsed.data)
    }
    reader.readAsText(file)
  }

  const onCsvInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleCsvFile(file)
    e.target.value = '' // reset so same file can be re-imported
  }

  return (
    <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: "14px 18px", marginBottom: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 12, justifyContent: "space-between" }}>

        {/* Title + progress */}
        <div style={{ minWidth: 200 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 15, fontWeight: 500, color: "#f1f5f9", letterSpacing: "-0.3px" }}>SEO Quarter Grid <span style={{ fontSize: 10, color: "#6366f1", background: "#1e1b4b", padding: "1px 6px", borderRadius: 4, marginLeft: 4 }}>V3</span></span>
            <span style={{ fontSize: 11, color: "#64748b" }}>{totalClients} clients · 13 wks · {pct}%</span>
            <span style={{ fontSize: 10, color: saveState === 'error' ? '#f87171' : '#475569' }}>
              {loaded && !canPersist ? '⚠ not saved — reload to reconnect'
                : saveState === 'saving' ? '● saving…'
                : saveState === 'saved' ? '✓ saved'
                : saveState === 'error' ? '⚠ not saved — retrying on next change' : ''}
            </span>
          </div>
          <div style={{ height: 5, background: "#0f172a", borderRadius: 99, width: 240, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: "linear-gradient(90deg,#22c55e,#4ade80)", borderRadius: 99, transition: "width 0.3s" }} />
          </div>
          <div style={{ marginTop: 4, fontSize: 10, color: "#475569" }}>{doneCount}/{totalClients} done · {unassignedCount} unassigned</div>
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
              <button key={n} onClick={() => setSlotsPerWeek(n)} style={{
                padding: "5px 12px", fontSize: 11, border: "none", cursor: "pointer", fontFamily: "inherit",
                background: slotsPerWeek === n ? "#6366f1" : "transparent",
                color: slotsPerWeek === n ? "#fff" : "#64748b",
                fontWeight: slotsPerWeek === n ? 500 : 400, transition: "all 0.15s",
              }}>{n}/wk</button>
            ))}
          </div>

          <button onClick={onAutoDistribute} style={{
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

          <button onClick={onReset} style={{
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

          <PushToTeamworkButton />

          {/* ── Layouts ──────────────────────────────────────────────── */}
          <LayoutManager layouts={layouts} saveLayout={saveLayout} applyLayout={applyLayout} deleteLayout={deleteLayout} />
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
        {pushMeta && (
          <span style={{ fontSize: 10, color: "#475569", marginLeft: "auto" }}>
            Last pushed {new Date(pushMeta.pushedAt).toLocaleDateString()}
            {pushMeta.summary ? ` · ${pushMeta.summary.created} task${pushMeta.summary.created !== 1 ? 's' : ''}` : ''}
          </span>
        )}
      </div>
    </div>
  )
}
