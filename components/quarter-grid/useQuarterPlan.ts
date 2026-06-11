// components/quarter-grid/useQuarterPlan.ts
'use client'

// Quarter Grid data hook (B4 split). The init effect, persist effect, and
// pagehide flush are MOVED VERBATIM from app/quarter-grid/page.tsx — every
// comment, guard, and eslint-disable with them. Do not "improve" them; the
// skip-first-persist handshake and canPersist gate are production-load-bearing
// (the one-time localStorage import window).

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  parseStoredQuarterState,
  buildPlanPayload,
  applyPlanResponse,
  sanitizeSnapshotForApply,
  type QuarterPlanGetResponse,
  type QuarterPlanPayload,
  type ClientStateMap,
  type ScheduleMap,
  type Snapshots,
  type ClientStatus,
  type PushSummary,
  ACTIVITY_LABELS,
} from '@/lib/quarter-grid/state'
import {
  removeFromSchedule, dropChipOnSlot, frontierWeek, placeInWeek, nextPoolChipId,
  sortPool, autoDistributeSchedule, applyCsvRows, type GridClient,
} from '@/lib/quarter-grid/grid-ops'

const STORAGE_KEY = 'seo-quarter-v3'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export function useQuarterPlan({ onToast }: { onToast: (msg: string) => void }) {
  const [clients, setClients]     = useState<GridClient[]>([])
  const [schedule, setSchedule]   = useState<ScheduleMap>({})
  const [completed, setCompleted] = useState<Set<number>>(new Set())
  const [slotsPerWeek, setSlots]  = useState(2)
  const [layouts, setLayouts]     = useState<Snapshots>({})
  const [startDate, setStartDate] = useState('')
  const [loaded, setLoaded]       = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  // Persistence is enabled ONLY once we positively know the DB state: plan
  // loaded, import settled, or confirmed-empty DB. A failed /api/clients or
  // /api/quarter-plan fetch leaves this false so a debounced PUT can never
  // clobber (or pre-empt the import of) a plan we couldn't see.
  const [canPersist, setCanPersist] = useState(false)
  // Derived tool activity (clientId -> preformatted tooltip line) and Teamwork
  // push metadata — both display-only; neither participates in the persist path.
  const [activity, setActivity] = useState<Record<number, string>>({})
  const [pushMeta, setPushMeta] = useState<{ pushedAt: string; summary: PushSummary | null } | null>(null)

  // Toast callback behind a ref so the stable useCallbacks below never go stale.
  const onToastRef = useRef(onToast)
  useEffect(() => { onToastRef.current = onToast }, [onToast])

  const saveSeqRef = useRef(0)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingPayloadRef = useRef<QuarterPlanPayload | null>(null)
  // The persist effect fires once right after init (its deps change during
  // hydration). Skip that run: merely OPENING the page must never write —
  // an on-open save against an empty DB would create an empty plan and
  // 409-block the real localStorage import from the analyst's browser.
  const skipFirstPersistRef = useRef(false)
  const scheduleRef     = useRef(schedule)
  const clientsRef      = useRef(clients)
  const slotsPerWeekRef = useRef(slotsPerWeek)
  useEffect(() => { scheduleRef.current = schedule }, [schedule])
  useEffect(() => { clientsRef.current = clients }, [clients])
  useEffect(() => { slotsPerWeekRef.current = slotsPerWeek }, [slotsPerWeek])

  // Clear pending save timer on unmount
  useEffect(() => {
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [])

  // ─── Init: fetch clients + plan from DB; one-time localStorage import ────

  useEffect(() => {
    const init = async () => {
      // Canonical client list from DB
      let dbClients: { id: number; name: string }[] = []
      let clientsOk = false
      try {
        const res = await fetch('/api/clients')
        if (res.ok) { dbClients = await res.json(); clientsOk = true }
      } catch { /* ignore — show empty list */ }
      const validIds = dbClients.map((c) => c.id)

      let clientState: ClientStateMap = {}
      const hydrate = (resp: QuarterPlanGetResponse): boolean => {
        const applied = applyPlanResponse(resp, validIds)
        if (!applied) return false
        if (resp.plan && resp.plan.teamworkPushedAt) {
          setPushMeta({ pushedAt: resp.plan.teamworkPushedAt, summary: resp.plan.teamworkPushSummary ?? null })
        }
        clientState = applied.clientState
        setSchedule(applied.schedule)
        setCompleted(new Set(applied.completed))
        setSlots(applied.slotsPerWeek)
        setLayouts(applied.layouts)
        setStartDate(applied.startDate)
        return true
      }

      let resp: QuarterPlanGetResponse | null = null
      let getFailed = false
      try {
        const res = await fetch('/api/quarter-plan')
        if (res.ok) resp = await res.json()
        else getFailed = true
      } catch { getFailed = true }

      // Persistence stays disabled unless we positively know the DB state.
      // A failed clients fetch also disables it: with an empty validIds set,
      // a save/import would write (and 409-arm) an EMPTY plan.
      let persistAllowed = clientsOk && !getFailed

      if (resp && resp.plan) {
        hydrate(resp)
      } else if (!getFailed) {
        // Confirmed no DB plan: try the one-time localStorage import.
        const stored = parseStoredQuarterState(
          typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
        )
        if (stored && clientsOk) {
          const payload = buildPlanPayload(stored, validIds)
          const localResp: QuarterPlanGetResponse = {
            plan: { name: payload.name, startDate: payload.startDate, slotsPerWeek: payload.slotsPerWeek, layouts: payload.layouts, updatedAt: '', teamworkPushedAt: null, teamworkPushSummary: null },
            assignments: payload.assignments,
          }
          try {
            const res = await fetch('/api/quarter-plan/import', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            })
            if (res.ok) {
              hydrate(await res.json())
              onToastRef.current('⬆ Imported quarter plan from this browser')
            } else if (res.status === 409) {
              // Someone imported first — the DB wins.
              const again = await fetch('/api/quarter-plan')
              if (again.ok) {
                if (!hydrate(await again.json())) hydrate(localResp)
              } else {
                hydrate(localResp)
                persistAllowed = false
              }
            } else {
              // Import failed with the DB confirmed empty — show local data
              // but do NOT enable saves: a later PUT would create the plan
              // and permanently 409-block re-running this import.
              hydrate(localResp)
              persistAllowed = false
            }
          } catch {
            hydrate(localResp)
            persistAllowed = false
          }
        }
        // No stored payload: fresh empty grid; saves allowed (first PUT
        // creates the singleton plan).
      } else {
        // GET failed — can't tell whether a plan exists. Show localStorage
        // data read-only if present; never import or save blind.
        const stored = parseStoredQuarterState(
          typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
        )
        if (stored) {
          const payload = buildPlanPayload(stored, validIds)
          hydrate({
            plan: { name: payload.name, startDate: payload.startDate, slotsPerWeek: payload.slotsPerWeek, layouts: payload.layouts, updatedAt: '', teamworkPushedAt: null, teamworkPushSummary: null },
            assignments: payload.assignments,
          })
        }
      }

      // Merge DB clients with per-client plan state
      const merged: GridClient[] = dbClients.map((c) => ({
        id: c.id,
        name: c.name,
        priority: clientState[c.id]?.priority ?? 3,
        status: (clientState[c.id]?.status ?? 'not_started') as ClientStatus,
        note: clientState[c.id]?.note ?? '',
      }))
      setClients(merged)
      setCanPersist(persistAllowed)
      if (!persistAllowed) setSaveState('error')
      // Only now may the persist effect fire — flipping earlier would let a
      // debounced empty save create a plan and 409-block the real import.
      skipFirstPersistRef.current = true
      setLoaded(true)
    }
    init()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const buildCurrentPayload = (): QuarterPlanPayload => {
    const clientState: ClientStateMap = {}
    for (const c of clients) clientState[c.id] = { priority: c.priority, status: c.status, note: c.note }
    return buildPlanPayload(
      { clientState, schedule, completed, slotsPerWeek, layouts, startDate },
      clients.map((c) => c.id)
    )
  }

  // Debounced full-state save — last write wins. localStorage is no longer
  // written; the old seo-quarter-v3 key stays frozen as a pre-DB backup.
  // The generation (saveSeqRef) increments at SCHEDULING time, not when the
  // timer fires: if save A is in flight when edit B schedules, A's response
  // sees a newer generation and can't mark the indicator "saved" while B's
  // changes are still pending.
  useEffect(() => {
    if (!loaded || !canPersist) return
    if (skipFirstPersistRef.current) { skipFirstPersistRef.current = false; return } // post-init echo, not a user edit
    const seq = ++saveSeqRef.current
    const payload = buildCurrentPayload()
    pendingPayloadRef.current = payload
    setSaveState('saving')
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      pendingPayloadRef.current = null
      fetch('/api/quarter-plan', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then((res) => {
          if (seq !== saveSeqRef.current) return // newer changes pending — leave the indicator to them
          if (res.ok) setSaveState('saved')
          else { setSaveState('error'); onToastRef.current('⚠ Save failed — will retry on next change') }
        })
        .catch(() => {
          if (seq !== saveSeqRef.current) return
          setSaveState('error')
          onToastRef.current('⚠ Save failed — will retry on next change')
        })
    }, 800)
  }, [clients, schedule, completed, slotsPerWeek, layouts, startDate, loaded, canPersist]) // eslint-disable-line react-hooks/exhaustive-deps

  // Best-effort flush when the tab closes mid-debounce. keepalive bodies are
  // capped (~64 KB) so a large layouts blob may not make it — the debounced
  // save above is the real persistence path.
  useEffect(() => {
    const onPageHide = () => {
      if (saveTimerRef.current && pendingPayloadRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
        try {
          fetch('/api/quarter-plan', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pendingPayloadRef.current),
            keepalive: true,
          })
        } catch { /* best-effort */ }
      }
    }
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
  }, [])

  // Derived tool activity — fetched once after init settles. Best-effort and
  // display-only: a failure must never touch canPersist/saveState or the
  // persist effect's dep list.
  useEffect(() => {
    if (!loaded) return
    fetch('/api/quarter-plan/activity')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || !data.activity) return
        const fmt: Record<number, string> = {}
        for (const [id, a] of Object.entries(data.activity as Record<string, { latest: { kind: string; at: string } }>)) {
          const d = new Date(a.latest.at)
          fmt[Number(id)] = `${ACTIVITY_LABELS[a.latest.kind] ?? a.latest.kind} · ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
        }
        setActivity(fmt)
      })
      .catch(() => { /* best-effort — activity is decorative */ })
  }, [loaded])

  // ─── Derived values ──────────────────────────────────────────────────────

  const assignedIds  = new Set(Object.values(schedule).flat())
  const unassigned   = sortPool(clients, assignedIds)
  const getClient    = (id: number) => clients.find(c => c.id === id)
  const doneCount    = completed.size
  const totalClients = clients.length
  const pct          = totalClients > 0 ? Math.round((doneCount / totalClients) * 100) : 0

  // ─── Mutations ───────────────────────────────────────────────────────────

  // Stable: usePoolKeyboard's effect deps are [hoveredPoolChipId] only.
  const setPriority = useCallback((id: number, p: number) => {
    setClients(prev => prev.map(c => c.id === id ? { ...c, priority: p } : c))
  }, [])

  const toggleDone   = (id: number) => setCompleted(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const returnToPool = (id: number) => setSchedule(prev => removeFromSchedule(prev, id))

  const setStatus = useCallback((id: number, status: ClientStatus) => {
    setClients(prev => prev.map(c => c.id === id ? { ...c, status } : c))
  }, [])

  const saveNote = (id: number, note: string) => {
    setClients(prev => prev.map(c => c.id === id ? { ...c, note } : c))
  }

  const dropChip = (drag: { id: number; fromWeek: number | null }, week: number, slot: number) => {
    setSchedule(prev => dropChipOnSlot(prev, drag, week, slot))
  }

  // Stable for usePoolKeyboard; reads refs exactly like the old keyboard
  // effect: targetWeek + next-chip from the PRE-update schedule, placement
  // via functional update.
  const assignHoveredToFrontier = useCallback((id: number): number | null => {
    const targetWeek = frontierWeek(scheduleRef.current, slotsPerWeekRef.current)
    setSchedule(prev => placeInWeek(prev, id, targetWeek))
    const next = nextPoolChipId(clientsRef.current, scheduleRef.current, id)
    onToastRef.current(`→ Wk ${targetWeek}`)
    return next
  }, [])

  const autoDistribute = () => {
    setSchedule(autoDistributeSchedule(clients, slotsPerWeek))
    onToastRef.current('⚡ Auto-distributed across 13 weeks')
  }

  const resetAll = () => {
    setSchedule({})
    setCompleted(new Set())
    // Reset per-client state to defaults without removing clients from DB
    setClients(prev => prev.map(c => ({ ...c, priority: 3, status: 'not_started' as ClientStatus, note: '' })))
    onToastRef.current('🔄 Reset — all clients returned to pool')
  }

  const saveLayout = (name: string) => {
    if (!name.trim()) return
    const snap = {
      schedule:  JSON.parse(JSON.stringify(schedule)),
      completed: Array.from(completed),
      clients:   JSON.parse(JSON.stringify(clients)),
    }
    setLayouts(prev => ({ ...prev, [name.trim()]: snap }))
    onToastRef.current(`💾 Saved layout "${name.trim()}"`)
  }

  const applyLayout = (name: string) => {
    if (!name || !layouts[name]) return
    // A stale snapshot must not resurrect deleted clients or clobber current
    // names — patch state onto the current DB client list only.
    const sanitized = sanitizeSnapshotForApply(layouts[name], clients.map((c) => c.id))
    setSchedule(sanitized.schedule)
    setCompleted(new Set(sanitized.completed))
    setClients((prev) => prev.map((c) => {
      const patch = sanitized.clientPatches.get(c.id)
      return patch ? { ...c, priority: patch.priority, status: patch.status as ClientStatus, note: patch.note } : c
    }))
    onToastRef.current(`📂 Loaded "${name}"`)
  }

  const deleteLayout = (name: string) => {
    if (!name) return
    setLayouts(prev => { const n = { ...prev }; delete n[name]; return n })
    onToastRef.current(`🗑 Deleted layout "${name}"`)
  }

  const addClient = async (name: string): Promise<boolean> => {
    if (!name.trim()) return false
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (!res.ok) return false
      const nc = await res.json()
      const newClient: GridClient = { id: nc.id, name: nc.name, priority: 3, status: 'not_started', note: '' }
      setClients(prev => [...prev, newClient].sort((a, b) => a.name.localeCompare(b.name)))
      onToastRef.current(`+ Added "${newClient.name}"`)
      return true
    } catch { return false }
  }

  const removeClient = (id: number) => {
    // Optimistic update
    setClients(prev => prev.filter(c => c.id !== id))
    setSchedule(prev => removeFromSchedule(prev, id))
    setCompleted(prev => { const n = new Set(prev); n.delete(id); return n })
    // Archive in the background — hard DELETE now 409s (archive_first); an
    // archived client leaves /api/clients, which is all the grid needs.
    fetch(`/api/clients/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    }).catch(() => { /* ignore */ })
  }

  const applyCsv = (rows: Record<string, string>[]) => {
    const result = applyCsvRows(rows, clients, schedule)
    if (result.clientUpdates.size > 0) {
      setClients(prev => prev.map(c => {
        const upd = result.clientUpdates.get(c.id)
        return upd ? { ...c, ...upd } : c
      }))
    }
    setSchedule(result.schedule)
    const msgs: string[] = []
    if (result.assignCount > 0) msgs.push(`Imported ${result.assignCount} assignment${result.assignCount !== 1 ? 's' : ''}`)
    if (result.unrecognized.length > 0) {
      msgs.push(`Unrecognized: ${result.unrecognized.slice(0, 3).join(', ')}${result.unrecognized.length > 3 ? ` +${result.unrecognized.length - 3} more` : ''}`)
    }
    onToastRef.current(msgs.join(' · ') || 'No data found in CSV')
  }

  return {
    clients, schedule, completed, slotsPerWeek, layouts, startDate,
    loaded, canPersist, saveState, activity, pushMeta,
    assignedIds, unassigned, getClient, doneCount, totalClients, pct,
    setSlotsPerWeek: setSlots, setStartDate,
    setPriority, setStatus, saveNote, toggleDone,
    returnToPool, dropChip, assignHoveredToFrontier,
    autoDistribute, resetAll,
    saveLayout, applyLayout, deleteLayout,
    addClient, removeClient, applyCsv,
  }
}
