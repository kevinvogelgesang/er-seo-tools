'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { SectionKey } from '@/lib/viewbook/theme'
import { useSelectionContext } from './SelectionContext'

export interface SectionActivitySnapshot { dirty: boolean; busy: boolean; conflict: boolean; focused: boolean }
const IDLE: SectionActivitySnapshot = { dirty: false, busy: false, conflict: false, focused: false }
const same = (a: SectionActivitySnapshot, b: SectionActivitySnapshot) =>
  a.dirty === b.dirty && a.busy === b.busy && a.conflict === b.conflict && a.focused === b.focused

export interface SectionActivityApi {
  report: (sectionKey: SectionKey, editorId: string, snap: SectionActivitySnapshot) => void
  remove: (sectionKey: SectionKey, editorId: string) => void
  aggregateFor: (sectionKey: SectionKey) => SectionActivitySnapshot
  anyActive: (sectionKey: SectionKey) => boolean
  version: number
}
const NOOP: SectionActivityApi = { report: () => {}, remove: () => {}, aggregateFor: () => IDLE, anyActive: () => false, version: 0 }

const Ctx = createContext<SectionActivityApi | null>(null)
type Store = Record<string, Record<string, SectionActivitySnapshot>>

export function SectionActivityProvider({ children }: { children: ReactNode }) {
  const store = useRef<Store>({})
  const [version, setVersion] = useState(0)

  const report = useCallback((sectionKey: SectionKey, editorId: string, snap: SectionActivitySnapshot) => {
    const sec = store.current[sectionKey] ?? (store.current[sectionKey] = {})
    if (sec[editorId] && same(sec[editorId], snap)) return
    sec[editorId] = snap
    setVersion((v) => v + 1)
  }, [])

  const remove = useCallback((sectionKey: SectionKey, editorId: string) => {
    const sec = store.current[sectionKey]
    if (!sec || !(editorId in sec)) return
    delete sec[editorId]
    setVersion((v) => v + 1)
  }, [])

  const aggregateFor = useCallback((sectionKey: SectionKey): SectionActivitySnapshot => {
    const sec = store.current[sectionKey]
    if (!sec) return IDLE
    return Object.values(sec).reduce<SectionActivitySnapshot>((acc, s) => ({
      dirty: acc.dirty || s.dirty, busy: acc.busy || s.busy, conflict: acc.conflict || s.conflict, focused: acc.focused || s.focused,
    }), IDLE)
  }, [])

  const anyActive = useCallback((sectionKey: SectionKey) => {
    const a = aggregateFor(sectionKey)
    return a.dirty || a.busy || a.conflict || a.focused
  }, [aggregateFor])

  // `version` IS in the value so consumers re-render on every change (Codex fix #3).
  const value = useMemo<SectionActivityApi>(() => ({ report, remove, aggregateFor, anyActive, version }), [report, remove, aggregateFor, anyActive, version])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSectionActivityContext(): SectionActivityApi {
  return useContext(Ctx) ?? NOOP
}

export function useReportSectionActivity(sectionKey: SectionKey, editorId: string, snap: SectionActivitySnapshot): void {
  const activity = useSectionActivityContext()
  const selection = useSelectionContext()
  useEffect(() => { activity.report(sectionKey, editorId, snap) },
    [activity, sectionKey, editorId, snap.dirty, snap.busy, snap.conflict, snap.focused])
  useEffect(() => {
    if (activity.anyActive(sectionKey)) selection.select(sectionKey, 'focus')
    else selection.release(sectionKey, 'activity')
    // `activity` identity already changes on every version bump (its useMemo
    // depends on version), so it alone captures aggregate changes.
  }, [activity, sectionKey, selection])
  // Remove ONLY on unmount (or when the section/editor identity changes). This
  // must NOT depend on `activity`: its identity changes on every version bump,
  // so a cleanup keyed on it would remove the entry on each bump while the
  // report effect re-adds it — an unbounded report↔remove version-bump loop
  // that floods microtasks and OOMs the worker. The latest-ref keeps the
  // cleanup pinned to unmount while still calling the current `remove`.
  const removeRef = useRef(activity.remove)
  removeRef.current = activity.remove
  useEffect(() => () => removeRef.current(sectionKey, editorId), [sectionKey, editorId])
}
