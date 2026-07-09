'use client'

// C10 /reports generate+download form — extended in Task 24:
//   - Multi-select client picker with "All active" option
//   - 422 ineligible list with "Generate anyway" button
//   - Batch progress banner (polls GET /api/reports/batch/[batchId] every 3s)
//   - Single-report status still polled when a single reportId is available

import { useState, useEffect } from 'react'
import { StatusPill } from '@/components/ui/StatusPill'
import { reportStatusTone } from './status-tone'

interface ClientItem { id: number; name: string }
interface ReportStatus {
  status: string
  ga4Status: string
  gscStatus: string
  prospectsStatus: string
  generatedAt: string | null
}

interface BatchStatus {
  status: 'running' | 'complete' | 'error'
  counts: { queued: number; rendering: number; ready: number; error: number }
  total?: number
  done?: number
}

const inputCls =
  'border border-gray-300 dark:border-navy-border rounded px-2 py-1.5 bg-white dark:bg-navy-deep text-gray-800 dark:text-white/90 text-sm'

export function GenerateReportForm() {
  const [clients, setClients] = useState<ClientItem[]>([])

  // Multi-select state: 'all' | number[]
  const [selectedAll, setSelectedAll] = useState(false)
  const [selectedIds, setSelectedIds] = useState<number[]>([])

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
  const [batchId, setBatchId] = useState<string | null>(null)
  const [reportStatus, setReportStatus] = useState<ReportStatus | null>(null)
  const [batchStatus, setBatchStatus] = useState<BatchStatus | null>(null)
  const [genError, setGenError] = useState<string | null>(null)

  // 422 ineligible
  const [ineligibleClients, setIneligibleClients] = useState<string[] | null>(null)
  const [pendingConfirmBody, setPendingConfirmBody] = useState<Record<string, unknown> | null>(null)

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

  // Poll single report status
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

  // Poll batch status every 3s
  useEffect(() => {
    if (!batchId) return
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/reports/batch/${batchId}`)
        if (!res.ok) { clearInterval(poll); return }
        const data = await res.json() as BatchStatus
        setBatchStatus(data)
        if (data.status === 'complete' || data.status === 'error') {
          clearInterval(poll)
        }
      } catch {
        // ignore transient errors
      }
    }, 3000)
    return () => clearInterval(poll)
  }, [batchId])

  // Build POST body from current selection
  function buildBody(confirm = false): Record<string, unknown> {
    const body: Record<string, unknown> = {
      periodStart,
      periodEnd,
      comparisonMode,
    }
    if (selectedAll) {
      body.clientIds = 'all'
    } else {
      body.clientIds = selectedIds
    }
    if (confirm) body.confirm = true
    return body
  }

  async function doGenerate(body: Record<string, unknown>) {
    setGenerating(true)
    setGenError(null)
    setReportId(null)
    setBatchId(null)
    setReportStatus(null)
    setBatchStatus(null)
    setIneligibleClients(null)
    setPendingConfirmBody(null)

    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.status === 422) {
        const d = await res.json().catch(() => ({})) as { ineligible?: string[] }
        setIneligibleClients(d.ineligible ?? [])
        // Store the body for a "generate anyway" re-submit
        setPendingConfirmBody(body)
        return
      }

      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string }
        setGenError(d.error ?? `Generate failed (${res.status})`)
        return
      }

      const data = await res.json() as { reportIds?: string[]; batchId?: string }

      if (data.batchId) {
        setBatchId(data.batchId)
        // Kick off batch status immediately
        const bRes = await fetch(`/api/reports/batch/${data.batchId}`)
        if (bRes.ok) {
          const bs = await bRes.json() as BatchStatus
          setBatchStatus(bs)
        }
      }

      // If only one report, also set reportId for the single-report status panel
      if (data.reportIds && data.reportIds.length === 1) {
        setReportId(data.reportIds[0])
      }
    } catch {
      setGenError('Network error')
    } finally {
      setGenerating(false)
    }
  }

  function generate() {
    void doGenerate(buildBody())
  }

  function generateAnyway() {
    if (!pendingConfirmBody) return
    void doGenerate({ ...pendingConfirmBody, confirm: true })
  }

  // ── Client selection helpers ────────────────────────────────────────────────

  function toggleAll() {
    if (selectedAll) {
      setSelectedAll(false)
    } else {
      setSelectedAll(true)
      setSelectedIds([])
    }
  }

  function toggleClient(id: number) {
    setSelectedAll(false)
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const canGenerate = !generating && (selectedAll || selectedIds.length > 0) && !!periodStart && !!periodEnd

  // ── Labels ─────────────────────────────────────────────────────────────────

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

  const batchStatusLabel: Record<string, string> = {
    running: 'Running…',
    complete: 'Complete',
    error: 'Error',
  }

  return (
    <div className="space-y-6">
      {/* Generate form */}
      <div className="bg-white dark:bg-navy-card rounded-xl border border-gray-200 dark:border-navy-border p-6">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-white/80 mb-4">Generate Report</h2>

        <div className="flex flex-wrap gap-6 mb-4">
          {/* Multi-select client picker */}
          <div className="flex flex-col gap-1 min-w-[220px]">
            <span className="text-xs text-gray-500 dark:text-white/50">Clients</span>

            {/* All active toggle */}
            <label className="flex items-center gap-2 mb-1 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedAll}
                onChange={toggleAll}
                className="rounded border-gray-300 dark:border-navy-border"
              />
              <span className="text-sm text-gray-700 dark:text-white/80 font-semibold">All active</span>
            </label>

            {/* Individual clients */}
            {!selectedAll && (
              <div className="max-h-40 overflow-y-auto border border-gray-200 dark:border-navy-border rounded px-2 py-1 space-y-0.5 bg-white dark:bg-navy-deep">
                {clients.length === 0 && (
                  <p className="text-xs text-gray-400 dark:text-white/30 py-1">Loading clients…</p>
                )}
                {clients.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 py-0.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(c.id)}
                      onChange={() => toggleClient(c.id)}
                      className="rounded border-gray-300 dark:border-navy-border"
                    />
                    <span className="text-sm text-gray-700 dark:text-white/80">{c.name}</span>
                  </label>
                ))}
              </div>
            )}

            {selectedAll && (
              <p className="text-xs text-gray-500 dark:text-white/40 italic">All active clients will be included.</p>
            )}
          </div>

          {/* Period + comparison */}
          <div className="flex flex-wrap gap-4">
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
        </div>

        {genError && <p className="text-xs text-red-600 dark:text-red-400 mb-3">{genError}</p>}

        {/* 422 ineligible banner */}
        {ineligibleClients && ineligibleClients.length > 0 && (
          <div className="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-1">
              Some clients are not eligible for report generation:
            </p>
            <ul className="list-disc list-inside text-xs text-amber-700 dark:text-amber-400 mb-2 space-y-0.5">
              {ineligibleClients.map((name, i) => (
                <li key={i}>{name}</li>
              ))}
            </ul>
            <button
              onClick={generateAnyway}
              disabled={generating}
              className="text-xs font-semibold text-amber-700 dark:text-amber-300 hover:underline disabled:opacity-50"
            >
              Generate anyway (skip ineligible clients)
            </button>
          </div>
        )}

        <button
          onClick={generate}
          disabled={!canGenerate}
          className="px-5 py-2 rounded bg-orange text-navy font-display font-bold text-sm disabled:opacity-50 hover:bg-orange-light transition-colors"
        >
          {generating ? 'Generating…' : 'Generate Report'}
        </button>
      </div>

      {/* Batch progress banner */}
      {batchId && batchStatus && (
        <div className="bg-white dark:bg-navy-card rounded-xl border border-gray-200 dark:border-navy-border p-6">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-white/80 mb-3">Batch Progress</h2>
          <div className="flex items-center gap-3 mb-2">
            <StatusPill
              label={batchStatusLabel[batchStatus.status] ?? batchStatus.status}
              tone={reportStatusTone(batchStatus.status)}
            />
            <span className="text-xs text-gray-500 dark:text-white/40">
              {batchStatus.counts.ready} ready · {batchStatus.counts.rendering} rendering · {batchStatus.counts.queued} queued · {batchStatus.counts.error} error
            </span>
          </div>
          {batchStatus.status === 'running' && (
            <p className="text-xs text-gray-400 dark:text-white/30">Checking every 3 seconds…</p>
          )}
        </div>
      )}

      {/* Single report status — shown when exactly one reportId is active */}
      {reportId && !batchId && (
        <div className="bg-white dark:bg-navy-card rounded-xl border border-gray-200 dark:border-navy-border p-6">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-white/80 mb-3">Report Status</h2>

          {reportStatus ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-sm">
                <span className="text-gray-500 dark:text-white/50 text-xs w-16 flex-shrink-0">Status</span>
                <StatusPill
                  label={statusLabel[reportStatus.status] ?? reportStatus.status}
                  tone={reportStatusTone(reportStatus.status)}
                />
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
