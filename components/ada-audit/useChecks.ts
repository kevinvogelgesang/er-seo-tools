'use client'

import { useCallback, useEffect, useState } from 'react'

export interface CheckRow { scope: string; key: string }

interface UseChecksArgs {
  endpoint: string  // e.g. /api/ada-audit/<id>/checks or /api/ada-audit/share/<token>/checks
  enabled: boolean
  readOnly?: boolean
}

export function useChecks({ endpoint, enabled, readOnly = false }: UseChecksArgs) {
  const [checks, setChecks] = useState<CheckRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    fetch(endpoint).then(async (r) => {
      if (!r.ok) throw new Error(`Failed to load checks: ${r.status}`)
      const j = await r.json()
      if (!cancelled) { setChecks(j.checks ?? []); setLoaded(true) }
    }).catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [enabled, endpoint])

  const has = useCallback((scope: string, key: string) =>
    checks.some((c) => c.scope === scope && c.key === key)
  , [checks])

  // setCheck waits for the server response before mutating local state.
  // The UI shows the pre-click state until the PUT resolves; consumers
  // can use `pending` to disable controls briefly.
  const setCheck = useCallback(async (scope: string, key: string, checked: boolean): Promise<void> => {
    if (readOnly) return
    setPending(true)
    try {
      const r = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, key, checked }),
      })
      if (!r.ok) throw new Error(`PUT failed: ${r.status}`)
      const j = await r.json()
      setChecks(j.checks ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      throw e
    } finally {
      setPending(false)
    }
  }, [endpoint, readOnly])

  // Sequential fan-out — used when the rule checkbox toggles all nodes.
  // Sequential (not parallel) avoids the response-ordering race that would
  // otherwise let the last-received PUT overwrite earlier writes' results.
  const setManyChecks = useCallback(async (entries: { scope: string; key: string; checked: boolean }[]): Promise<void> => {
    if (readOnly) return
    setPending(true)
    try {
      let last: CheckRow[] | null = null
      for (const e of entries) {
        const r = await fetch(endpoint, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(e),
        })
        if (!r.ok) throw new Error(`PUT failed: ${r.status}`)
        const j = await r.json()
        last = j.checks ?? []
      }
      if (last) setChecks(last)
    } catch (e) {
      // A PUT in the middle of the sequence may have failed AFTER earlier
      // PUTs succeeded on the server. Local state from before the call no
      // longer reflects the server. Refetch the canonical set so the UI
      // recovers, then still surface the original error.
      try {
        const r = await fetch(endpoint)
        if (r.ok) {
          const j = await r.json()
          setChecks(j.checks ?? [])
        }
      } catch { /* refetch failed — keep prior state */ }
      setError(e instanceof Error ? e.message : String(e))
      throw e
    } finally {
      setPending(false)
    }
  }, [endpoint, readOnly])

  return { checks, loaded, pending, error, has, setCheck, setManyChecks }
}

export type UseChecksReturn = ReturnType<typeof useChecks>
