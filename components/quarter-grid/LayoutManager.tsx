// components/quarter-grid/LayoutManager.tsx
'use client'

import { useState } from 'react'
import type { Snapshots } from '@/lib/quarter-grid/state'

interface LayoutManagerProps {
  layouts: Snapshots
  saveLayout: (name: string) => void
  applyLayout: (name: string) => void
  deleteLayout: (name: string) => void
}

export function LayoutManager({ layouts, saveLayout, applyLayout, deleteLayout }: LayoutManagerProps) {
  // Leaf UI state — nothing outside the layout controls reads these (B4
  // relocation from page state; observationally identical).
  const [layoutName, setLayoutName] = useState('')
  const [activeLayout, setActiveLayout] = useState('')

  const handleApply = (name: string) => {
    if (!name || !layouts[name]) return // '' = the "— select —" option
    applyLayout(name)
    setActiveLayout(name)
  }
  const handleDelete = () => {
    if (!activeLayout) return
    deleteLayout(activeLayout)
    setActiveLayout('')
  }
  const handleSave = () => {
    if (!layoutName.trim()) return
    saveLayout(layoutName)
    setLayoutName('')
  }

  return (
    <>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "#64748b", whiteSpace: "nowrap" }}>Layout:</span>
        <select
          value={activeLayout}
          onChange={e => handleApply(e.target.value)}
          style={{
            padding: "5px 8px", background: "#0f172a", border: "1px solid #334155",
            borderRadius: 6, color: "#e2e8f0", fontSize: 11, fontFamily: "inherit", maxWidth: 160,
          }}
        >
          <option value="">— select —</option>
          {Object.keys(layouts).map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        {activeLayout && (
          <button onClick={handleDelete} title="Delete this layout" style={{
            padding: "5px 8px", background: "transparent", color: "#f87171",
            border: "1px solid #334155", borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
          }}>✕</button>
        )}
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <input
          value={layoutName}
          onChange={e => setLayoutName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
          placeholder="save as layout…"
          style={{
            padding: "5px 10px", background: "#0f172a", border: "1px solid #334155",
            borderRadius: 6, color: "#e2e8f0", fontSize: 11, fontFamily: "inherit", width: 140,
          }}
        />
        <button onClick={handleSave} disabled={!layoutName.trim()} style={{
          padding: "5px 10px", background: layoutName.trim() ? "#059669" : "#1e293b",
          color: layoutName.trim() ? "#fff" : "#475569", border: "1px solid #334155",
          borderRadius: 6, fontSize: 11, cursor: layoutName.trim() ? "pointer" : "not-allowed", fontFamily: "inherit",
        }}>💾</button>
      </div>
    </>
  )
}
