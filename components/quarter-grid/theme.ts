// components/quarter-grid/theme.ts
// Visual constants for the Quarter Grid (moved verbatim from page.tsx in B4).
import type { ClientStatus } from '@/lib/quarter-grid/state'

export const PCOLORS: Record<number, { chip: string; border: string; text: string; badge: string; label: string }> = {
  1: { chip: "#fee2e2", border: "#f87171", text: "#991b1b", badge: "#ef4444", label: "P1 · High" },
  2: { chip: "#ffedd5", border: "#fb923c", text: "#9a3412", badge: "#f97316", label: "P2" },
  3: { chip: "#fef9c3", border: "#facc15", text: "#713f12", badge: "#eab308", label: "P3 · Med" },
  4: { chip: "#dbeafe", border: "#60a5fa", text: "#1e3a8a", badge: "#3b82f6", label: "P4" },
  5: { chip: "#f1f5f9", border: "#94a3b8", text: "#334155", badge: "#94a3b8", label: "P5 · Low" },
}

export const DONE_COLORS = { chip: "#dcfce7", border: "#4ade80", text: "#14532d", badge: "#22c55e" }

export const STATUS_COLORS: Record<ClientStatus, string> = {
  not_started: '#94a3b8',
  in_progress:  '#3b82f6',
  on_hold:      '#eab308',
  blocked:      '#ef4444',
  complete:     '#22c55e',
}

export const STATUS_LABELS: Record<ClientStatus, string> = {
  not_started: 'Not Started',
  in_progress:  'In Progress',
  on_hold:      'On Hold',
  blocked:      'Blocked',
  complete:     'Complete',
}

export const SLOT_LABELS = ["Mon", "Wed", "Fri"]
