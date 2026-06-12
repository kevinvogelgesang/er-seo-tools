'use client'

// C2: per-client scan-schedule management. Mutations hit the schedule CRUD
// routes and re-fetch GET to refresh local state. Delta chip reuses the
// Scorecard delta styling (green up / red down).

import { useCallback, useState } from 'react'
import type { ClientScheduleRow } from '@/lib/services/client-schedules'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function humanizeCadence(cadence: string): string {
  const weekly = /^weekly:([0-6])@(\d{2}:\d{2})$/.exec(cadence)
  if (weekly) return `Weekly · ${DOW[Number(weekly[1])]} ${weekly[2]}`
  const monthly = /^monthly:(\d{1,2})@(\d{2}:\d{2})$/.exec(cadence)
  if (monthly) return `Monthly · day ${monthly[1]} ${monthly[2]}`
  return cadence
}

interface Props {
  clientId: number
  domains: string[]
  archived: boolean
  initial: ClientScheduleRow[]
}

const inputCls =
  'border border-gray-300 dark:border-navy-border rounded px-2 py-1 bg-white dark:bg-navy-deep text-gray-800 dark:text-white/90'

export function ScheduledScansCard({ clientId, domains, archived, initial }: Props) {
  const [schedules, setSchedules] = useState<ClientScheduleRow[]>(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [domain, setDomain] = useState(domains[0] ?? '')
  const [freq, setFreq] = useState<'weekly' | 'monthly'>('weekly')
  const [day, setDay] = useState('1')
  const [time, setTime] = useState('06:00')
  const [level, setLevel] = useState('wcag21aa')

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/clients/${clientId}/schedules`)
    if (res.ok) setSchedules((await res.json()).schedules)
  }, [clientId])

  async function mutate(run: () => Promise<Response>): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      const res = await run()
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? `Request failed (${res.status})`)
        return false
      }
      await refresh()
      return true
    } catch {
      setError('Network error')
      return false
    } finally {
      setBusy(false)
    }
  }

  const create = async () => {
    const ok = await mutate(() =>
      fetch(`/api/clients/${clientId}/schedules`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          domain,
          cadence: freq === 'weekly' ? `weekly:${day}@${time}` : `monthly:${day}@${time}`,
          wcagLevel: level,
        }),
      }),
    )
    if (ok) setShowForm(false)
  }

  const setEnabled = (id: string, enabled: boolean) =>
    mutate(() =>
      fetch(`/api/clients/${clientId}/schedules/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      }),
    )

  const remove = (id: string) => {
    if (!window.confirm('Delete this schedule? Past scheduled audits are kept as manual history.')) return
    void mutate(() => fetch(`/api/clients/${clientId}/schedules/${id}`, { method: 'DELETE' }))
  }

  return (
    <div className="bg-white dark:bg-navy-card rounded-xl border border-gray-200 dark:border-navy-border p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-white/80">Scheduled scans</h2>
        {!archived && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
          >
            {showForm ? 'Cancel' : '+ Add schedule'}
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-600 dark:text-red-400 mb-2">{error}</p>}

      {showForm && (
        <div className="flex flex-wrap items-end gap-2 mb-4 text-xs">
          <label className="flex flex-col gap-1">
            <span className="text-gray-500 dark:text-white/50">Domain</span>
            <select value={domain} onChange={(e) => setDomain(e.target.value)} className={inputCls}>
              {domains.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-gray-500 dark:text-white/50">Frequency</span>
            <select
              value={freq}
              onChange={(e) => { setFreq(e.target.value as 'weekly' | 'monthly'); setDay('1') }}
              className={inputCls}
            >
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-gray-500 dark:text-white/50">{freq === 'weekly' ? 'Day of week' : 'Day of month'}</span>
            <select value={day} onChange={(e) => setDay(e.target.value)} className={inputCls}>
              {freq === 'weekly'
                ? DOW.map((label, i) => (
                    <option key={i} value={String(i)}>{label}</option>
                  ))
                : Array.from({ length: 28 }, (_, i) => (
                    <option key={i + 1} value={String(i + 1)}>{i + 1}</option>
                  ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-gray-500 dark:text-white/50">Time</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-gray-500 dark:text-white/50">WCAG level</span>
            <select value={level} onChange={(e) => setLevel(e.target.value)} className={inputCls}>
              <option value="wcag21aa">Required (2.1 AA)</option>
              <option value="wcag22aa">Aspirational (2.2 AA)</option>
            </select>
          </label>
          <button
            onClick={() => void create()}
            disabled={busy || !domain}
            className="px-3 py-1.5 rounded bg-blue-600 text-white font-semibold disabled:opacity-50"
          >
            Create
          </button>
        </div>
      )}

      {schedules.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-white/40">No scheduled scans.</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-navy-border">
          {schedules.map((s) => (
            <li key={s.id} className="py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="font-semibold text-gray-800 dark:text-white/90">{s.domain || '(unknown domain)'}</span>
              <span className="text-gray-500 dark:text-white/50">{humanizeCadence(s.cadence)}</span>
              <span className="text-gray-400 dark:text-white/40">{s.wcagLevel === 'wcag22aa' ? 'WCAG 2.2 AA' : 'WCAG 2.1 AA'}</span>
              {s.enabled ? (
                <span className="text-gray-400 dark:text-white/40">next {new Date(s.nextRunAt).toLocaleString()}</span>
              ) : (
                <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-white/50 font-semibold">Paused</span>
              )}
              {s.lastRun && (
                <span className="text-gray-500 dark:text-white/50">
                  last:{' '}
                  <a href={`/ada-audit/site/${s.lastRun.id}`} className="text-blue-600 dark:text-blue-400 hover:underline">
                    {s.lastRun.status}
                    {s.lastRun.score !== null ? ` · ${s.lastRun.score}` : ''}
                  </a>
                  {s.lastDelta !== null && s.lastDelta !== 0 && (
                    <span
                      className={`ml-1 font-semibold ${s.lastDelta > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
                    >
                      {s.lastDelta > 0 ? `▲ ${s.lastDelta}` : `▼ ${Math.abs(s.lastDelta)}`}
                    </span>
                  )}
                  {((s.lastRun.newCount ?? 0) > 0 || (s.lastRun.resolvedCount ?? 0) > 0) && (
                    <span title="new / resolved violations vs the previous scheduled run">
                      {s.lastRun.newCount !== null && s.lastRun.newCount > 0 && (
                        <span className="ml-1 font-semibold text-red-600 dark:text-red-400">+{s.lastRun.newCount}</span>
                      )}
                      {s.lastRun.resolvedCount !== null && s.lastRun.resolvedCount > 0 && (
                        <span className="ml-1 font-semibold text-green-600 dark:text-green-400">−{s.lastRun.resolvedCount}</span>
                      )}
                    </span>
                  )}
                </span>
              )}
              <span className="ml-auto flex gap-2">
                <button
                  onClick={() => void setEnabled(s.id, !s.enabled)}
                  disabled={busy}
                  className="text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                >
                  {s.enabled ? 'Pause' : 'Resume'}
                </button>
                <button
                  onClick={() => remove(s.id)}
                  disabled={busy}
                  className="text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
