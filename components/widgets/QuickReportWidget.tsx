// components/widgets/QuickReportWidget.tsx
'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { WidgetSize } from '@/lib/widgets/types'

interface ClientItem { id: number; name: string }
interface Period { periodStart: string; periodEnd: string }

// Last complete calendar month, computed in UTC to match GenerateReportForm
// (GenerateReportForm.tsx:38 uses Date.UTC). NOT called during render — a
// render-time `new Date()` would risk a server/client hydration divergence
// across a month boundary (Codex fix 2); computed once on mount instead.
function lastCompleteMonthUTC(): Period {
  const now = new Date()
  // First day of the previous month, and the last day of the previous month.
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return { periodStart: iso(start), periodEnd: iso(end) }
}

export function QuickReportWidget({ size }: { size: WidgetSize }) {
  const router = useRouter()
  const [clients, setClients] = useState<ClientItem[]>([])
  const [clientId, setClientId] = useState('')
  const [comparisonMode, setComparisonMode] = useState<'prev_period' | 'prev_year'>('prev_period')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Period is computed after mount (stable null placeholder for SSR/first paint).
  const [period, setPeriod] = useState<Period | null>(null)

  useEffect(() => { setPeriod(lastCompleteMonthUTC()) }, [])

  useEffect(() => {
    let live = true
    fetch('/api/clients')
      .then((r) => (r.ok ? r.json() : []))
      .then((d: unknown) => {
        if (!live || !Array.isArray(d)) return
        setClients((d as ClientItem[]).filter((c) => typeof c.id === 'number' && typeof c.name === 'string'))
      })
      .catch(() => {})
    return () => { live = false }
  }, [])

  async function generate() {
    if (!clientId || !period || busy) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId: Number(clientId), periodStart: period.periodStart, periodEnd: period.periodEnd, comparisonMode }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 201) { router.push('/reports'); return }
      if (res.status === 422 && Array.isArray(data.ineligibleClients)) {
        const reasons = data.ineligibleClients.map((c: { name: string; reason: string }) => `${c.name}: ${c.reason}`).join('; ')
        setError(`Not eligible — ${reasons}`)
      } else {
        setError(data.error || 'Could not generate the report.')
      }
    } catch {
      setError('Could not generate the report.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="flex h-full flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void generate() }}>
      <label className="sr-only" htmlFor="qr-client">Client</label>
      <select
        id="qr-client"
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-[14px] text-navy dark:border-navy-border dark:bg-navy-deep dark:text-white"
      >
        <option value="">Select a client…</option>
        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      {size !== 'sm' && (
        <select
          aria-label="Comparison"
          value={comparisonMode}
          onChange={(e) => setComparisonMode(e.target.value as 'prev_period' | 'prev_year')}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13px] text-navy dark:border-navy-border dark:bg-navy-deep dark:text-white"
        >
          <option value="prev_period">vs previous period</option>
          <option value="prev_year">vs previous year</option>
        </select>
      )}
      <p className="text-[11px] font-body text-gray-400 dark:text-white/40">
        {period ? `${period.periodStart} → ${period.periodEnd}` : '—'}
      </p>
      {error && <p className="text-[12px] font-body text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={busy || !clientId || !period}
        className="mt-auto rounded-lg bg-orange px-4 py-2 text-[14px] font-display font-bold text-navy hover:bg-orange-light disabled:opacity-50"
      >
        {busy ? 'Generating…' : 'Generate report'}
      </button>
    </form>
  )
}
