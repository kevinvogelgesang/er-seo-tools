'use client'

import { useCallback, useSyncExternalStore } from 'react'
import type { ViewbookTheme } from '@/lib/viewbook/theme'

type ThemeState = {
  committed: ViewbookTheme
  draft: ViewbookTheme
}

const states = new Map<number, ThemeState>()
const listeners = new Map<number, Set<() => void>>()

function notify(viewbookId: number): void {
  for (const listener of Array.from(listeners.get(viewbookId) ?? [])) listener()
}

export function initializeThemeDraft(viewbookId: number, theme: ViewbookTheme): void {
  if (states.has(viewbookId)) return
  states.set(viewbookId, { committed: theme, draft: theme })
  notify(viewbookId)
}

export function getThemeDraft(viewbookId: number): ViewbookTheme | null {
  return states.get(viewbookId)?.draft ?? null
}

export function getCommittedTheme(viewbookId: number): ViewbookTheme | null {
  return states.get(viewbookId)?.committed ?? null
}

export function setThemeDraft(viewbookId: number, partial: Partial<ViewbookTheme>): void {
  const current = states.get(viewbookId)
  if (!current) return
  states.set(viewbookId, { ...current, draft: { ...current.draft, ...partial } })
  notify(viewbookId)
}

export function commitThemeDraft(viewbookId: number, theme: ViewbookTheme): void {
  states.set(viewbookId, { committed: theme, draft: theme })
  notify(viewbookId)
}

export function restoreCommittedTheme(viewbookId: number): void {
  const current = states.get(viewbookId)
  if (!current || current.draft === current.committed) return
  states.set(viewbookId, { ...current, draft: current.committed })
  notify(viewbookId)
}

export function subscribe(viewbookId: number, listener: () => void): () => void {
  let viewbookListeners = listeners.get(viewbookId)
  if (!viewbookListeners) {
    viewbookListeners = new Set()
    listeners.set(viewbookId, viewbookListeners)
  }
  viewbookListeners.add(listener)
  return () => {
    viewbookListeners.delete(listener)
    if (viewbookListeners.size === 0) listeners.delete(viewbookId)
  }
}

export function useThemeDraft(viewbookId: number | undefined, fallback: ViewbookTheme): ViewbookTheme {
  const subscribeToViewbook = useCallback(
    (listener: () => void) => viewbookId === undefined ? () => {} : subscribe(viewbookId, listener),
    [viewbookId],
  )
  const getSnapshot = useCallback(
    () => viewbookId === undefined ? fallback : getThemeDraft(viewbookId) ?? fallback,
    [fallback, viewbookId],
  )
  return useSyncExternalStore(subscribeToViewbook, getSnapshot, getSnapshot)
}

/** Test-only reset for module-scoped drafts and subscribers. */
export function __resetThemeDraftStore(): void {
  states.clear()
  listeners.clear()
}
