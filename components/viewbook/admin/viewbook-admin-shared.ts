'use client'

// Shared client-side helpers for the viewbook admin components.

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
  activityCount: number
  dataLockedAt: string | null
  createdAt: string
}
