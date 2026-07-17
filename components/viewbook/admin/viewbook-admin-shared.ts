'use client'

// Shared client-side helpers for the viewbook admin components.

import type { ViewbookTheme } from '@/lib/viewbook/theme'

export function publicViewbookUrl(token: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '')
  return `${base}/viewbook/${token}`
}

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
  client: { name: string; archivedAt: string | null }
  sections: { sectionKey: string; state: string; introNote: string | null; narrative: string | null }[]
  milestones: {
    id: number
    title: string
    blurb: string | null
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
