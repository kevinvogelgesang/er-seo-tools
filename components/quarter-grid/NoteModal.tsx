// components/quarter-grid/NoteModal.tsx
'use client'

import { useState, useEffect } from 'react'

interface NoteModalProps {
  id: number
  note: string
  clientName: string
  onSave: (id: number, note: string) => void
  onClose: () => void
}

export function NoteModal({ id, note, clientName, onSave, onClose }: NoteModalProps) {
  const [noteDraft, setNoteDraft] = useState(note)
  // Re-sync when another chip's note opens while the modal is mounted —
  // mirrors the old openNoteModal setting both states on every open.
  useEffect(() => { setNoteDraft(note) }, [id, note])

  const handleSave = () => { onSave(id, noteDraft.slice(0, 120)); onClose() }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      onClick={onClose}
    >
      <div
        style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, width: "100%", maxWidth: 400, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 64px rgba(0,0,0,0.6)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Modal header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid #334155", background: "#0f172a" }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: "#f1f5f9", fontFamily: "'DM Mono',monospace" }}>
            {clientName}
          </span>
          <button onClick={onClose} style={{ padding: "3px 8px", background: "transparent", color: "#64748b", border: "1px solid #334155", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>✕</button>
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
          <button onClick={onClose} style={{
            padding: "5px 14px", background: "transparent", color: "#64748b",
            border: "1px solid #334155", borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: "'DM Mono',monospace",
          }}>Cancel</button>
          <button onClick={handleSave} style={{
            padding: "5px 14px", background: "#059669", color: "#fff",
            border: "none", borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: "'DM Mono',monospace", fontWeight: 500,
          }}>Save Note</button>
        </div>
      </div>
    </div>
  )
}
