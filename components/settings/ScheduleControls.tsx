'use client'

// ScheduleControls — GET/PUT /api/reports/schedule.
// Shows enabled toggle, day of month, time (HH:MM), comparison mode.
// Matches dark-mode idiom from ServiceAccountCard.tsx.

import { useState, useEffect } from 'react'

interface ScheduleData {
  id: string
  enabled: boolean
  cadence: string
  day: number | null
  time: string | null
  comparisonMode: 'prev_period' | 'prev_year'
  nextRunAt: string | null
  lastRunAt: string | null
}

const inputCls =
  'border border-gray-300 dark:border-navy-border rounded px-2 py-1.5 bg-white dark:bg-navy-deep text-gray-800 dark:text-white/90 text-sm'

export function ScheduleControls() {
  const [schedule, setSchedule] = useState<ScheduleData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Form state (derived from schedule on load)
  const [enabled, setEnabled] = useState(false)
  const [day, setDay] = useState<string>('1')
  const [time, setTime] = useState<string>('09:00')
  const [comparisonMode, setComparisonMode] = useState<'prev_period' | 'prev_year'>('prev_period')

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Load schedule on mount
  useEffect(() => {
    void fetch('/api/reports/schedule')
      .then((r) => r.json())
      .then((d: { schedule: ScheduleData | null }) => {
        if (d.schedule) {
          setSchedule(d.schedule)
          setEnabled(d.schedule.enabled)
          setDay(d.schedule.day != null ? String(d.schedule.day) : '1')
          setTime(d.schedule.time ?? '09:00')
          setComparisonMode(d.schedule.comparisonMode)
        }
        // If schedule is null, keep defaults (enabled=false, day=1, time=09:00, prev_period)
      })
      .catch(() => setLoadError('Failed to load schedule'))
      .finally(() => setLoading(false))
  }, [])

  async function save() {
    const dayNum = parseInt(day, 10)
    if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 28) {
      setSaveError('Day must be an integer between 1 and 28')
      return
    }

    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)

    try {
      const res = await fetch('/api/reports/schedule', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled, day: dayNum, time, comparisonMode }),
      })

      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string; detail?: string }
        setSaveError(d.detail ?? d.error ?? `Save failed (${res.status})`)
        return
      }

      setSaveSuccess(true)
      // Reload the schedule to get updated nextRunAt
      const rRes = await fetch('/api/reports/schedule')
      if (rRes.ok) {
        const rData = await rRes.json() as { schedule: ScheduleData | null }
        if (rData.schedule) setSchedule(rData.schedule)
      }
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch {
      setSaveError('Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white dark:bg-navy-card rounded-xl border border-gray-200 dark:border-navy-border p-6">
      <h2 className="text-sm font-semibold text-gray-700 dark:text-white/80 mb-4">
        Monthly Report Schedule
      </h2>

      {loading && (
        <p className="text-xs text-gray-400 dark:text-white/40">Loading…</p>
      )}

      {loadError && (
        <p className="text-xs text-red-600 dark:text-red-400">{loadError}</p>
      )}

      {!loading && !loadError && (
        <div className="space-y-4">
          {/* Enabled toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="rounded border-gray-300 dark:border-navy-border"
            />
            <span className="text-sm text-gray-700 dark:text-white/80">Enabled</span>
          </label>

          <div className="flex flex-wrap gap-4">
            {/* Day of month */}
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500 dark:text-white/50">Day of month (1–28)</span>
              <input
                type="number"
                min={1}
                max={28}
                value={day}
                onChange={(e) => setDay(e.target.value)}
                disabled={!enabled}
                className={`${inputCls} w-20 disabled:opacity-50`}
              />
            </label>

            {/* Time */}
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500 dark:text-white/50">Time (HH:MM, 24h)</span>
              <input
                type="text"
                pattern="[0-2][0-9]:[0-5][0-9]"
                placeholder="09:00"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                disabled={!enabled}
                className={`${inputCls} w-24 disabled:opacity-50`}
              />
            </label>

            {/* Comparison mode */}
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500 dark:text-white/50">Comparison mode</span>
              <select
                value={comparisonMode}
                onChange={(e) => setComparisonMode(e.target.value as 'prev_period' | 'prev_year')}
                disabled={!enabled}
                className={`${inputCls} disabled:opacity-50`}
              >
                <option value="prev_period">Previous period</option>
                <option value="prev_year">Previous year</option>
              </select>
            </label>
          </div>

          {/* Next/last run info */}
          {schedule && (
            <dl className="space-y-1 text-xs text-gray-500 dark:text-white/40">
              {schedule.nextRunAt && (
                <div className="flex gap-2">
                  <dt className="w-20 flex-shrink-0">Next run</dt>
                  <dd className="font-mono">{new Date(schedule.nextRunAt).toLocaleString()}</dd>
                </div>
              )}
              {schedule.lastRunAt && (
                <div className="flex gap-2">
                  <dt className="w-20 flex-shrink-0">Last run</dt>
                  <dd className="font-mono">{new Date(schedule.lastRunAt).toLocaleString()}</dd>
                </div>
              )}
            </dl>
          )}

          {saveError && (
            <p className="text-xs text-red-600 dark:text-red-400">{saveError}</p>
          )}

          {saveSuccess && (
            <p className="text-xs text-green-600 dark:text-green-400">Schedule saved.</p>
          )}

          <button
            onClick={() => void save()}
            disabled={saving}
            className="px-4 py-2 rounded bg-orange text-navy font-display font-bold text-sm disabled:opacity-50 hover:bg-orange-light transition-colors"
          >
            {saving ? 'Saving…' : 'Save Schedule'}
          </button>
        </div>
      )}
    </div>
  )
}
