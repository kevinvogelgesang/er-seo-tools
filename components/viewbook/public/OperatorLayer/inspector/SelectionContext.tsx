'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { SectionKey } from '@/lib/viewbook/theme'

export type InspectorGroup = 'content' | 'status' | 'assets' | 'data' | 'documents'
export type PinReason = 'dirty' | 'focus' | 'manual-nav'
export type PinKind = 'activity' | 'manual-nav'

const MANUAL_NAV_PIN_MS = 4000

export interface SelectionState {
  selectedKey: SectionKey | null
  selectedGroup: InspectorGroup | null
  select: (key: SectionKey, reason?: PinReason, group?: InspectorGroup) => boolean
  observe: (key: SectionKey) => void
  release: (key: SectionKey, kind: PinKind) => void
  isPinned: boolean
  pinnedKey: SectionKey | null
  pinnedKind: PinKind | null
}

const NOOP: SelectionState = {
  selectedKey: null, selectedGroup: null,
  select: () => false, observe: () => {}, release: () => {},
  isPinned: false, pinnedKey: null, pinnedKind: null,
}

const Ctx = createContext<SelectionState | null>(null)

interface Pin { key: SectionKey; kind: PinKind }

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selectedKey, setSelectedKey] = useState<SectionKey | null>(null)
  const [selectedGroup, setSelectedGroup] = useState<InspectorGroup | null>(null)
  const [pin, setPin] = useState<Pin | null>(null)
  // Mirrors `pin` synchronously so `select()` can make its fail-closed decision
  // in the same tick it's called — a setState functional updater's callback
  // isn't guaranteed to run synchronously, so `pin` state alone can't back it.
  const pinRef = useRef<Pin | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }
  const setPinBoth = (next: Pin | null) => { pinRef.current = next; setPin(next) }

  const release = useCallback((key: SectionKey, kind: PinKind) => {
    const cur = pinRef.current
    if (cur && cur.key === key && cur.kind === kind) {
      clearTimer()
      setPinBoth(null)
    }
  }, [])

  const select = useCallback((key: SectionKey, reason: PinReason = 'manual-nav', group?: InspectorGroup) => {
    const kind: PinKind = reason === 'dirty' || reason === 'focus' ? 'activity' : 'manual-nav'
    const cur = pinRef.current
    // A HARD pin on a DIFFERENT section fails closed.
    if (cur && cur.kind === 'activity' && cur.key !== key) return false
    setPinBoth({ key, kind })
    setSelectedKey(key)
    if (group) setSelectedGroup(group)
    clearTimer()
    if (kind === 'manual-nav') {
      timer.current = setTimeout(() => release(key, 'manual-nav'), MANUAL_NAV_PIN_MS)
    }
    return true
  }, [release])

  const observe = useCallback((key: SectionKey) => {
    if (pinRef.current === null) setSelectedKey(key)
  }, [])

  useEffect(() => clearTimer, [])

  const value = useMemo<SelectionState>(() => ({
    selectedKey, selectedGroup, select, observe, release,
    isPinned: pin !== null, pinnedKey: pin?.key ?? null, pinnedKind: pin?.kind ?? null,
  }), [selectedKey, selectedGroup, select, observe, release, pin])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSelectionContext(): SelectionState {
  return useContext(Ctx) ?? NOOP
}
