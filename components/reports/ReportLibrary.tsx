'use client'

// ReportLibrary — polls GET /api/reports every 5s while any report is in a
// non-terminal state. Shows a table of reports with status chips, per-source
// badges, download links, and inline manual-prospects entry.

import { useState, useEffect, useCallback } from 'react'
import { StatusPill } from '@/components/ui/StatusPill'
import { reportStatusTone } from './status-tone'
import { subscribeTopic, subscribeHealth } from '@/lib/events/client'
import { reportListTopic } from '@/lib/events/topics'

// A5: original 5s cadence kept as-is whenever SSE is absent/unhealthy — never
// slower than pre-A5. Demotes to the 60s safety cadence once SSE is confirmed
// healthy. The periodic interval still only runs while some report is
// transient (bounded-poll semantics preserved) — the report-list subscription
// itself is unconditional (mount-scoped) so a report created/deleted
// elsewhere on the page (GenerateReportForm) is picked up immediately even
// when nothing in this component's own list is currently transient.
const FAST_MS = 5000
const SAFETY_MS = 60_000

interface ReportRow {
  id: string
  batchId: string | null
  clientId: number
  status: string
  ga4Status: string
  gscStatus: string
  prospectsStatus: string
  prospectsTotal: number | null
  prospectsOrganic: number | null
  periodStart: string
  periodEnd: string
  generatedAt: string | null
  createdAt: string
}

interface ClientItem {
  id: number
  name: string
}

// Non-terminal statuses that trigger continued polling
const TRANSIENT_STATUSES = new Set(['queued', 'fetching', 'rendering'])

// ── Style helpers ─────────────────────────────────────────────────────────────

// Per-source badges keep their bespoke styling: they are a smaller (10px)
// scale, their label is the source name (GA4/GSC/Pros) not the status, and the
// `manual` (teal) state has no StatusPill tone — excluded from the A8 pass.
function sourceBadgeCls(s: string): string {
  if (s === 'ok') return 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400'
  if (s === 'skipped') return 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/40'
  if (s === 'error') return 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400'
  if (s === 'missing') return 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400'
  if (s === 'manual') return 'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-400'
  // pending / unknown
  return 'bg-gray-100 text-gray-400 dark:bg-white/10 dark:text-white/30'
}

// Format ISO date string as YYYY-MM-DD
function fmtDate(iso: string): string {
  return iso.slice(0, 10)
}

// ── Inline prospects form (per-row) ──────────────────────────────────────────

function ProspectsForm({
  reportId,
  initialTotal,
  initialOrganic,
  onSaved,
}: {
  reportId: string
  initialTotal: number | null
  initialOrganic: number | null
  onSaved: () => void
}) {
  const [total, setTotal] = useState(initialTotal != null ? String(initialTotal) : '')
  const [organic, setOrganic] = useState(initialOrganic != null ? String(initialOrganic) : '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    const totalNum = parseInt(total, 10)
    if (!Number.isInteger(totalNum) || totalNum < 0) {
      setErr('Total must be a non-negative integer')
      return
    }
    const body: Record<string, unknown> = { total: totalNum }
    if (organic.trim() !== '') {
      const orgNum = parseInt(organic, 10)
      if (!Number.isInteger(orgNum) || orgNum < 0) {
        setErr('Organic must be a non-negative integer or blank')
        return
      }
      body.organic = orgNum
    }
    setSaving(true)
    setErr(null)
    try {
      const res = await fetch(`/api/reports/${reportId}/prospects`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string }
        setErr(d.error ?? `Save failed (${res.status})`)
        return
      }
      onSaved()
    } catch {
      setErr('Network error')
    } finally {
      setSaving(false)
    }
  }

  const inputCls =
    'border border-gray-300 dark:border-navy-border rounded px-2 py-1 bg-white dark:bg-navy-deep text-gray-800 dark:text-white/90 text-xs w-20'

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          min={0}
          placeholder="Total"
          value={total}
          onChange={(e) => setTotal(e.target.value)}
          className={inputCls}
        />
        <input
          type="number"
          min={0}
          placeholder="Organic"
          value={organic}
          onChange={(e) => setOrganic(e.target.value)}
          className={inputCls}
        />
        <button
          onClick={() => void save()}
          disabled={saving || !total}
          className="px-2 py-1 rounded bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold disabled:opacity-50 transition-colors"
        >
          {saving ? '…' : 'Save'}
        </button>
      </div>
      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function ReportLibrary() {
  const [reports, setReports] = useState<ReportRow[]>([])
  const [clients, setClients] = useState<ClientItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const clientMap = new Map(clients.map((c) => [c.id, c.name]))

  const fetchAll = useCallback(async () => {
    try {
      const [rRes, cRes] = await Promise.all([
        fetch('/api/reports'),
        fetch('/api/clients'),
      ])
      if (rRes.ok) {
        const d = await rRes.json() as { reports: ReportRow[] }
        setReports(d.reports)
      } else {
        setError('Failed to load reports')
      }
      if (cRes.ok) {
        const d = await cRes.json() as ClientItem[]
        if (Array.isArray(d)) setClients(d)
      }
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }, [])

  const deleteReport = useCallback(
    async (id: string) => {
      if (typeof window !== 'undefined' && !window.confirm('Delete this report? This removes the PDF and cannot be undone.')) {
        return
      }
      setDeletingId(id)
      try {
        const res = await fetch(`/api/reports/${id}`, { method: 'DELETE' })
        if (res.ok || res.status === 404) {
          // Optimistically drop the row; 404 means it's already gone.
          setReports((prev) => prev.filter((r) => r.id !== id))
        } else {
          setError(`Delete failed (${res.status})`)
        }
      } catch {
        setError('Network error')
      } finally {
        setDeletingId(null)
      }
    },
    [],
  )

  // Initial fetch
  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  // SSE (A5): report-list invalidate → immediate refetch, unconditionally —
  // a report created/deleted elsewhere on the page must be picked up even
  // when nothing in the currently-rendered list is transient.
  useEffect(() => {
    return subscribeTopic(reportListTopic(), () => void fetchAll())
  }, [fetchAll])

  // Poll while any report is transient (bounded-poll semantics preserved);
  // cadence is health-gated: 5s fast while SSE is absent/unhealthy, demoting
  // to the 60s safety cadence once SSE is confirmed healthy.
  useEffect(() => {
    const hasTransient = reports.some((r) => TRANSIENT_STATUSES.has(r.status))
    if (!hasTransient) return
    let timer: ReturnType<typeof setInterval> | null = null
    const restartTimer = (healthy: boolean) => {
      if (timer) clearInterval(timer)
      timer = setInterval(() => void fetchAll(), healthy ? SAFETY_MS : FAST_MS)
    }
    restartTimer(false)
    const unsubHealth = subscribeHealth((h) => {
      restartTimer(h)
      if (h) void fetchAll()
    })
    return () => {
      if (timer) clearInterval(timer)
      unsubHealth()
    }
  }, [reports, fetchAll])

  if (loading) {
    return (
      <p className="text-xs text-gray-400 dark:text-white/40 py-4">Loading reports…</p>
    )
  }

  if (error) {
    return (
      <p className="text-xs text-red-600 dark:text-red-400 py-4">{error}</p>
    )
  }

  if (reports.length === 0) {
    return (
      <div className="bg-white dark:bg-navy-card rounded-xl border border-gray-200 dark:border-navy-border p-6">
        <p className="text-xs text-gray-400 dark:text-white/40">No reports generated yet.</p>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-navy-card rounded-xl border border-gray-200 dark:border-navy-border overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 dark:border-navy-border">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-white/80">Report Library</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-100 dark:border-navy-border">
              <th className="text-left px-4 py-2.5 text-gray-500 dark:text-white/40 font-medium">Client</th>
              <th className="text-left px-4 py-2.5 text-gray-500 dark:text-white/40 font-medium">Period</th>
              <th className="text-left px-4 py-2.5 text-gray-500 dark:text-white/40 font-medium">Status</th>
              <th className="text-left px-4 py-2.5 text-gray-500 dark:text-white/40 font-medium">Sources</th>
              <th className="text-left px-4 py-2.5 text-gray-500 dark:text-white/40 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr
                key={r.id}
                className="border-b border-gray-50 dark:border-navy-border/50 last:border-0 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
              >
                {/* Client */}
                <td className="px-4 py-3 text-gray-800 dark:text-white/90 font-medium">
                  {clientMap.get(r.clientId) ?? String(r.clientId)}
                </td>

                {/* Period */}
                <td className="px-4 py-3 text-gray-600 dark:text-white/60 whitespace-nowrap font-mono">
                  {fmtDate(r.periodStart)} — {fmtDate(r.periodEnd)}
                </td>

                {/* Status chip */}
                <td className="px-4 py-3">
                  <StatusPill label={r.status} tone={reportStatusTone(r.status)} />
                </td>

                {/* Per-source badges */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${sourceBadgeCls(r.ga4Status)}`}
                      title={`GA4: ${r.ga4Status}`}
                    >
                      GA4
                    </span>
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${sourceBadgeCls(r.gscStatus)}`}
                      title={`GSC: ${r.gscStatus}`}
                    >
                      GSC
                    </span>
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${sourceBadgeCls(r.prospectsStatus)}`}
                      title={`Prospects: ${r.prospectsStatus}`}
                    >
                      Pros
                    </span>
                  </div>
                </td>

                {/* Actions */}
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-2">
                    {/* Download link — only when ready */}
                    {r.status === 'ready' && (
                      <a
                        href={`/api/reports/${r.id}?file=1`}
                        download
                        className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline font-semibold"
                      >
                        Download PDF
                      </a>
                    )}

                    {/* Per-report prospects entry — settable when missing or
                        already manually set (so each report can be edited
                        independently). */}
                    {(r.prospectsStatus === 'missing' || r.prospectsStatus === 'manual') && (
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-white/40 font-medium">
                          {r.prospectsStatus === 'manual' ? 'Prospects (edit)' : 'Set prospects'}
                        </span>
                        <ProspectsForm
                          reportId={r.id}
                          initialTotal={r.prospectsTotal}
                          initialOrganic={r.prospectsOrganic}
                          onSaved={() => void fetchAll()}
                        />
                      </div>
                    )}

                    {/* Delete */}
                    <button
                      onClick={() => void deleteReport(r.id)}
                      disabled={deletingId === r.id}
                      className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400 hover:underline font-semibold disabled:opacity-50 self-start"
                    >
                      {deletingId === r.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
