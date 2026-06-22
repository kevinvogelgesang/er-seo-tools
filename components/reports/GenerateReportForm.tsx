'use client'

// C10 minimal /reports generate+download form.
// Single-client picker + date range + comparison toggle → POST /api/reports
// → poll GET /api/reports/[id] status → show Download when ready.

import { useState, useEffect } from 'react'

interface ClientItem { id: number; name: string }
interface ReportStatus {
  status: string
  ga4Status: string
  gscStatus: string
  prospectsStatus: string
  generatedAt: string | null
}

const inputCls =
  'border border-gray-300 dark:border-navy-border rounded px-2 py-1.5 bg-white dark:bg-navy-deep text-gray-800 dark:text-white/90 text-sm'

export function GenerateReportForm() {
  const [clients, setClients] = useState<ClientItem[]>([])
  const [clientId, setClientId] = useState<string>('')
  // Default: last complete month
  const [periodStart, setPeriodStart] = useState<string>(() => {
    const now = new Date()
    const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    return firstOfMonth.toISOString().slice(0, 10)
  })
  const [periodEnd, setPeriodEnd] = useState<string>(() => {
    const now = new Date()
    const lastOfPrevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))
    return lastOfPrevMonth.toISOString().slice(0, 10)
  })
  const [comparisonMode, setComparisonMode] = useState<'prev_period' | 'prev_year'>('prev_period')

  const [generating, setGenerating] = useState(false)
  const [reportId, setReportId] = useState<string | null>(null)
  const [reportStatus, setReportStatus] = useState<ReportStatus | null>(null)
  const [genError, setGenError] = useState<string | null>(null)

  // Load clients list
  useEffect(() => {
    void fetch('/api/clients')
      .then((r) => r.json())
      .then((d: unknown) => {
        if (Array.isArray(d)) {
          setClients(
            (d as Array<{ id: number; name: string }>)
              .filter((c) => typeof c.id === 'number' && typeof c.name === 'string')
              .sort((a, b) => a.name.localeCompare(b.name))
          )
        }
      })
      .catch(() => {})
  }, [])

  // Poll report status when a reportId is active
  useEffect(() => {
    if (!reportId) return
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/reports/${reportId}`)
        if (!res.ok) {
          clearInterval(poll)
          setGenError('Report not found')
          return
        }
        const data = await res.json() as ReportStatus
        setReportStatus(data)
        if (data.status === 'ready' || data.status === 'error') {
          clearInterval(poll)
        }
      } catch {
        // ignore transient poll errors
      }
    }, 2000)
    return () => clearInterval(poll)
  }, [reportId])

  async function generate() {
    if (!clientId) return
    setGenerating(true)
    setGenError(null)
    setReportId(null)
    setReportStatus(null)

    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId: Number(clientId),
          periodStart,
          periodEnd,
          comparisonMode,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        setGenError(body.error ?? `Generate failed (${res.status})`)
        return
      }
      const data = await res.json() as { reportIds: string[] }
      if (data.reportIds && data.reportIds.length > 0) {
        setReportId(data.reportIds[0])
      }
    } catch {
      setGenError('Network error')
    } finally {
      setGenerating(false)
    }
  }

  const statusLabel: Record<string, string> = {
    queued: 'Queued',
    fetching: 'Fetching analytics…',
    rendering: 'Rendering PDF…',
    ready: 'Ready',
    error: 'Error',
  }

  const sourceLabel: Record<string, string> = {
    pending: '…',
    ok: 'OK',
    skipped: 'Skipped',
    error: 'Error',
    manual: 'Manual',
    missing: '—',
  }

  return (
    <div className="space-y-6">
      {/* Generate form */}
      <div className="bg-white dark:bg-navy-card rounded-xl border border-gray-200 dark:border-navy-border p-6">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-white/80 mb-4">Generate Report</h2>

        <div className="flex flex-wrap gap-4 mb-4">
          {/* Client picker */}
          <label className="flex flex-col gap-1 min-w-[200px]">
            <span className="text-xs text-gray-500 dark:text-white/50">Client</span>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className={inputCls}
            >
              <option value="">— select a client —</option>
              {clients.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          {/* Period start */}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500 dark:text-white/50">Period start</span>
            <input
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              className={inputCls}
            />
          </label>

          {/* Period end */}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500 dark:text-white/50">Period end</span>
            <input
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className={inputCls}
            />
          </label>

          {/* Comparison mode */}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500 dark:text-white/50">Compare to</span>
            <select
              value={comparisonMode}
              onChange={(e) => setComparisonMode(e.target.value as 'prev_period' | 'prev_year')}
              className={inputCls}
            >
              <option value="prev_period">Previous period</option>
              <option value="prev_year">Previous year</option>
            </select>
          </label>
        </div>

        {genError && <p className="text-xs text-red-600 dark:text-red-400 mb-3">{genError}</p>}

        <button
          onClick={() => void generate()}
          disabled={generating || !clientId || !periodStart || !periodEnd}
          className="px-5 py-2 rounded bg-orange text-navy font-display font-bold text-sm disabled:opacity-50 hover:bg-orange-light transition-colors"
        >
          {generating ? 'Generating…' : 'Generate Report'}
        </button>
      </div>

      {/* Report status */}
      {reportId && (
        <div className="bg-white dark:bg-navy-card rounded-xl border border-gray-200 dark:border-navy-border p-6">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-white/80 mb-3">Report Status</h2>

          {reportStatus ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-sm">
                <span className="text-gray-500 dark:text-white/50 text-xs w-16 flex-shrink-0">Status</span>
                <span
                  className={`text-xs font-semibold px-2 py-0.5 rounded ${
                    reportStatus.status === 'ready'
                      ? 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400'
                      : reportStatus.status === 'error'
                      ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400'
                      : 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400'
                  }`}
                >
                  {statusLabel[reportStatus.status] ?? reportStatus.status}
                </span>
              </div>

              <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-white/40">
                <span>GA4: <span className="font-semibold text-gray-700 dark:text-white/70">{sourceLabel[reportStatus.ga4Status] ?? reportStatus.ga4Status}</span></span>
                <span>GSC: <span className="font-semibold text-gray-700 dark:text-white/70">{sourceLabel[reportStatus.gscStatus] ?? reportStatus.gscStatus}</span></span>
                <span>Prospects: <span className="font-semibold text-gray-700 dark:text-white/70">{sourceLabel[reportStatus.prospectsStatus] ?? reportStatus.prospectsStatus}</span></span>
              </div>

              {reportStatus.status === 'ready' && (
                <a
                  href={`/api/reports/${reportId}?file=1`}
                  download
                  className="inline-flex items-center gap-2 mt-2 px-4 py-2 rounded bg-green-600 hover:bg-green-700 text-white text-sm font-semibold transition-colors"
                >
                  Download PDF
                </a>
              )}

              {reportStatus.status !== 'ready' && reportStatus.status !== 'error' && (
                <p className="text-xs text-gray-400 dark:text-white/30 mt-1">Checking every 2 seconds…</p>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-400 dark:text-white/40">Loading status…</p>
          )}
        </div>
      )}
    </div>
  )
}
