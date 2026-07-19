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
    // A HARD pin on the SAME section is never downgraded by a weaker
    // (manual-nav) select: keep the hard pin and do NOT arm the soft-release
    // timer, so e.g. an outline click on the section being actively edited
    // can't drop its pin and let scroll-spy swap the pane away mid-edit. Focus
    // still moves to it below.
    const keepHard = !!cur && cur.kind === 'activity' && cur.key === key && kind === 'manual-nav'
    if (!keepHard) {
      // Only replace the pin when it actually changes. Re-pinning the SAME
      // key+kind must NOT produce a new object: the activity bridge calls
      // select() from an effect that depends on this provider's context value,
      // so a fresh identical pin would re-render → re-run the effect → loop.
      if (!cur || cur.key !== key || cur.kind !== kind) setPinBoth({ key, kind })
      clearTimer()
      if (kind === 'manual-nav') {
        timer.current = setTimeout(() => release(key, 'manual-nav'), MANUAL_NAV_PIN_MS)
      }
    }
    setSelectedKey(key)
    if (group) setSelectedGroup(group)
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
