'use client'

// Shared client-side helpers for the viewbook admin components.

import type { ViewbookTheme } from '@/lib/viewbook/theme'

export function publicViewbookUrl(token: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '')
  return `${base}/viewbook/${token}`
}

// Reveal-pace presets for PresentationEditor's operator control (PR1 Task
// 5) — labels map to `revealDurationScale` multipliers (0.4..1.6, higher =
// slower). Kept here alongside the other admin-shared metadata.
export const REVEAL_PACE_PRESETS = [
  { label: 'Grand', v: 1.4 },
  { label: 'Standard', v: 1.0 },
  { label: 'Brisk', v: 0.7 },
  { label: 'Snappy', v: 0.5 },
] as const

export async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(body.error || `request_failed_${res.status}`)
  return body
}

export interface ViewbookListRow {
  id: number
  clientName: string
  clientArchived: boolean
  kind: string
  token: string
  revoked: boolean
  currentMilestone: string | null
  stage: string
  pcCompletedAt: string | null
  activityCount: number
  dataLockedAt: string | null
  createdAt: string
}

export interface ViewbookDetail {
  id: number
  kind: string
  token: string
  revokedAt: string | null
  welcomeNote: string | null
  notifyEmail: string | null
  dataLockedAt: string | null
  dataLockedBy: string | null
  stage: string
  pcCompletedAt: string | null
  csmName: string | null
  syncVersion: number // PR2 live sync: poll /sync and refetch when it advances
  theme: ViewbookTheme
  collapseAffordance: string // 'pill' | 'chevron' (presentation config, PR4; 'bar' dropped 2026-07-19)
  collapseMorph: string // 'spread' | 'bloom' | 'clip' | 'pop' — collapse↔hero morph treatment
  heroOverlayStrength: number // 0..100
  revealDurationScale: number // 0.4..1.6, per-viewbook reveal-animation pacing multiplier
  firstLoadDelayMs: number // 0..6000, delay before the welcome auto-reveal fires on first load
  client: { name: string; archivedAt: string | null }
  sections: { sectionKey: string; state: string; introNote: string | null; narrative: string | null }[]
  milestones: {
    id: number
    title: string
    blurb: string | null
    description: string | null
    sortOrder: number
    status: string
    targetDate: string | null
    reviewLinks: {
      id: number
      label: string
      url: string
      kind: string
      feedback: {
        id: number
        body: string
        authorName: string | null
        authorKind: string
        createdAt: string
        resolvedAt: string | null
        resolvedBy: string | null
        images: { filename: string }[]
      }[]
    }[]
  }[]
  contentOverrides: { contentKey: string; body: string }[]
  fields: {
    id: number
    defKey: string | null
    category: string
    label: string
    fieldType: string
    sortOrder: number
    value: string | null
    version: number
    valueUpdatedBy: string | null
    valueUpdatedAt: string | null
    archivedAt: string | null
    createdAt: string
    amendments: { id: number; value: string; author: string; createdAt: string }[]
  }[]
}
