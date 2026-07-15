'use client'
// C14 intake + PR3 dashboard UX (2026-07-14 spec): phase-labeled progress bar
// with a startedAt-based ETA, whole-card click-through to the public sales
// report (new tab, opener nulled), and queue-position display.
//
// Poll/SSE cadence is UNCHANGED from A5 Task 19: mount-scoped `prospect-list`
// subscription + health-gated bounded poll (8s fast while SSE absent/
// unhealthy, 60s safety once healthy; only polls at all while some prospect
// is transient/not-yet-reportable). The 1s ETA tick below is a local render
// tick over last-fetched counters — it never fetches.
import { useCallback, useEffect, useState } from 'react'
import type { ProspectRow } from '@/lib/services/prospects'
import { subscribeTopic, subscribeHealth } from '@/lib/events/client'
import { prospectListTopic } from '@/lib/events/topics'
import { computeAuditProgress, computeEtaLabel } from './progress-math'

const TRANSIENT = new Set(['queued', 'running', 'pdfs-running', 'lighthouse-running'])
const FAST_MS = 8000
const SAFETY_MS = 60_000

// Module-private render helper — all math lives in progress-math.ts.
function ProgressBlock({ p, nowMs }: { p: ProspectRow; nowMs: number | null }) {
  const a = p.latestAudit
  if (!a) {
    return <p className="text-[12px] font-body text-navy/50 dark:text-white/50">Not scanned yet</p>
  }
  const progress = computeAuditProgress({
    status: a.status,
    reportable: a.reportable,
    pagesTotal: a.pagesTotal,
    pagesComplete: a.pagesComplete,
    pagesError: a.pagesError,
    pagesRedirected: a.pagesRedirected,
    pdfsTotal: a.pdfsTotal,
    pdfsComplete: a.pdfsComplete,
    pdfsError: a.pdfsError,
    pdfsSkipped: a.pdfsSkipped,
    lighthouseTotal: a.lighthouseTotal,
    lighthouseComplete: a.lighthouseComplete,
    lighthouseError: a.lighthouseError,
  })

  if (progress.kind === 'none') {
    return (
      <p className="text-[12px] font-body text-navy/50 dark:text-white/50">
        {a.status === 'complete' ? 'Report ready' : `Scan ${a.status}`}
        {a.adaScore != null && ` · ADA ${a.adaScore}/100`}
      </p>
    )
  }

  if (progress.kind === 'queued') {
    return (
      <p className="text-[12px] font-body text-amber-600 dark:text-amber-400">
        {a.queuePosition == null || a.queuePosition === 1
          ? 'Queued — next in line'
          : `Queued — position ${a.queuePosition}`}
      </p>
    )
  }

  if (progress.kind === 'discovering') {
    return (
      <div className="space-y-1">
        {/* Indeterminate progressbar: role + label but NO aria-valuenow —
            that omission is the ARIA-correct indeterminate signal. */}
        <div
          role="progressbar"
          aria-label={`Scan progress for ${p.name}: discovering pages`}
          className="w-full bg-gray-100 dark:bg-navy-light rounded-full h-1.5 overflow-hidden"
        >
          <div className="bg-blue-400 dark:bg-blue-500 h-1.5 w-1/3 rounded-full animate-pulse" />
        </div>
        <p className="text-[11px] font-body text-navy/50 dark:text-white/50">Discovering pages…</p>
      </div>
    )
  }

  const fraction = progress.fraction
  const pct = Math.round(fraction * 100)
  const label = progress.kind === 'building-report' ? 'Building report…' : progress.phaseLabel
  // ETA renders only after the post-mount tick primes nowMs — the server
  // render and first client render agree (hydration-safe, Codex fix 4).
  const eta =
    nowMs !== null && progress.kind === 'progress'
      ? computeEtaLabel({ fraction, startedAt: a.startedAt, now: nowMs })
      : null

  return (
    <div className="space-y-1">
      <div
        role="progressbar"
        aria-label={`Scan progress for ${p.name}: ${label}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="w-full bg-gray-100 dark:bg-navy-light rounded-full h-1.5 overflow-hidden"
      >
        <div
          className="bg-orange h-1.5 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[11px] font-body text-navy/50 dark:text-white/50">
        {label}
        {eta && ` · ${eta}`}
      </p>
    </div>
  )
}

export function ProspectDashboard(props: { initialProspects: ProspectRow[] }) {
  const [prospects, setProspects] = useState(props.initialProspects)
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/sales/prospects')
      if (res.ok) setProspects((await res.json()).prospects)
    } catch { /* transient poll failure — keep last state */ }
  }, [])

  const anyInFlight = prospects.some(
    (p) => p.latestAudit && (TRANSIENT.has(p.latestAudit.status) || (p.latestAudit.status === 'complete' && !p.latestAudit.reportable)),
  )

  // ETA tick: started AFTER mount so SSR markup and the first client render
  // agree (no hydration mismatch). Recomputes the ETA from last-fetched
  // counters every second; never fetches.
  useEffect(() => {
    setNowMs(Date.now())
    const timer = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  // SSE: prospect-list invalidate → immediate refetch, unconditionally — a
  // prospect created/deleted/settled elsewhere must be picked up even when
  // nothing in this component's currently-rendered list is transient.
  useEffect(() => {
    return subscribeTopic(prospectListTopic(), () => void refresh())
  }, [refresh])

  // Poll while any prospect is transient/not-yet-reportable (bounded-poll
  // semantics preserved); cadence is health-gated: 8s fast while SSE is
  // absent/unhealthy, demoting to the 60s safety cadence once SSE is
  // confirmed healthy.
  useEffect(() => {
    if (!anyInFlight) return
    let timer: ReturnType<typeof setInterval> | null = null
    const restartTimer = (healthy: boolean) => {
      if (timer) clearInterval(timer)
      timer = setInterval(() => void refresh(), healthy ? SAFETY_MS : FAST_MS)
    }
    restartTimer(false)
    const unsubHealth = subscribeHealth((h) => {
      restartTimer(h)
      if (h) void refresh()
    })
    return () => {
      if (timer) clearInterval(timer)
      unsubHealth()
    }
  }, [anyInFlight, refresh])

  async function submitNewScan(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setNotice(null)
    try {
      const createRes = await fetch('/api/sales/prospects', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, domain }),
      })
      const created = await createRes.json()
      if (!createRes.ok) { setNotice(created.error ?? 'Could not create prospect'); return }
      if (created.existing) setNotice(`Using existing prospect for ${created.prospect.domain} — re-scanning.`)
      await startScan(created.prospect.id)
      setName(''); setDomain('')
    } finally {
      setBusy(false)
    }
  }

  async function startScan(id: number) {
    const res = await fetch(`/api/sales/prospects/${id}/scan`, { method: 'POST' })
    if (res.status === 409) setNotice('A scan is already running for this prospect.')
    else if (!res.ok) setNotice('Could not start the scan.')
    await refresh()
  }

  async function copyLink(id: number) {
    const res = await fetch(`/api/sales/prospects/${id}/share`, { method: 'POST' })
    if (!res.ok) { setNotice('Could not create the sales link.'); return }
    const { salesUrl } = await res.json()
    await navigator.clipboard.writeText(salesUrl)
    setNotice('Sales link copied — valid for 30 days.')
  }

  async function remove(id: number) {
    if (!window.confirm('Delete this prospect? Its sales link stops working.')) return
    await fetch(`/api/sales/prospects/${id}`, { method: 'DELETE' })
    await refresh()
  }

  // PR3 card click-through (Codex fix 5). Opens the public sales report in a
  // new tab with opener nulled. window.open MUST run synchronously in the
  // click task (popup-blocker-safe); the share mint happens after, into the
  // pre-opened tab. NEVER pass 'noopener' as a feature — it makes window.open
  // return null, killing the blocked-popup fallback; nulling opener by hand
  // is equivalent.
  async function openReport(p: ProspectRow) {
    if (p.salesUrl) {
      const tab = window.open(p.salesUrl, '_blank')
      if (tab) tab.opener = null
      else setNotice(`Popup blocked — open the report at ${p.salesUrl}`)
      return
    }
    const pre = window.open('about:blank', '_blank')
    if (pre) pre.opener = null
    try {
      const res = await fetch(`/api/sales/prospects/${p.id}/share`, { method: 'POST' })
      if (!res.ok) throw new Error('share failed')
      const { salesUrl } = await res.json()
      if (pre) pre.location.href = salesUrl
      else setNotice(`Popup blocked — open the report at ${salesUrl}`)
      void refresh() // salesTokenActive/salesUrl now set server-side
    } catch {
      pre?.close()
      setNotice('Could not open the sales report.')
    }
  }

  function activateCard(
    e: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>,
    p: ProspectRow,
  ) {
    // Ignore activations originating inside nested interactive controls —
    // belt (this closest() guard) AND suspenders (the buttons' own
    // stopPropagation). Codex fix 5.
    const target = e.target as HTMLElement | null
    if (target && target.closest('button, a, input, [role="button"]')) return
    void openReport(p)
  }

  return (
    <div className="space-y-6">
      <form onSubmit={submitNewScan} className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-6 space-y-4">
        <h2 className="text-[15px] font-heading font-semibold text-navy dark:text-white">New prospect scan</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-[12px] font-body text-navy/60 dark:text-white/60">Prospect name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required aria-label="Prospect name"
              className="mt-1 w-full rounded-lg border border-gray-200 dark:border-navy-border bg-white dark:bg-navy-deep px-3 py-2 text-[13px] font-body text-navy dark:text-white" placeholder="Acme College" />
          </label>
          <label className="block">
            <span className="text-[12px] font-body text-navy/60 dark:text-white/60">Domain</span>
            <input value={domain} onChange={(e) => setDomain(e.target.value)} required aria-label="Domain"
              className="mt-1 w-full rounded-lg border border-gray-200 dark:border-navy-border bg-white dark:bg-navy-deep px-3 py-2 text-[13px] font-body text-navy dark:text-white" placeholder="acmecollege.edu" />
          </label>
        </div>
        <button type="submit" disabled={busy}
          className="rounded-lg bg-blue-700 px-4 py-2 text-[13px] font-heading font-semibold text-white disabled:opacity-50">
          {busy ? 'Starting…' : 'Scan'}
        </button>
        {notice && <p className="text-[12px] font-body text-navy/60 dark:text-white/60">{notice}</p>}
      </form>

      <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm divide-y divide-gray-100 dark:divide-navy-border">
        {prospects.length === 0 && (
          <p className="p-6 text-[13px] font-body text-navy/50 dark:text-white/50">No prospects yet — run your first scan above.</p>
        )}
        {prospects.map((p) => (
          <div
            key={p.id}
            role="link"
            tabIndex={0}
            aria-label={`Open sales report for ${p.name} in a new tab`}
            onClick={(e) => activateCard(e, p)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                activateCard(e, p)
              }
            }}
            className="p-5 flex flex-wrap items-center gap-x-4 gap-y-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-navy-deep/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 first:rounded-t-2xl last:rounded-b-2xl"
          >
            <div className="min-w-[180px]">
              <p className="text-[14px] font-heading font-semibold text-navy dark:text-white">{p.name}</p>
              <p className="text-[12px] font-body text-navy/50 dark:text-white/50">{p.domain}</p>
            </div>
            <div className="flex-1 basis-full sm:basis-auto min-w-[220px]">
              <ProgressBlock p={p} nowMs={nowMs} />
            </div>
            <div className="flex gap-2 ml-auto">
              {p.latestAudit?.reportable && (
                <button onClick={(e) => { e.stopPropagation(); void copyLink(p.id) }}
                  className="rounded-lg border border-gray-200 dark:border-navy-border px-3 py-1.5 text-[12px] font-heading font-semibold text-navy dark:text-white">
                  Copy sales link
                </button>
              )}
              <button onClick={(e) => { e.stopPropagation(); void startScan(p.id) }}
                className="rounded-lg border border-gray-200 dark:border-navy-border px-3 py-1.5 text-[12px] font-heading font-semibold text-navy dark:text-white">
                {p.latestAudit ? 'Re-scan' : 'Scan now'}
              </button>
              <button onClick={(e) => { e.stopPropagation(); void remove(p.id) }}
                className="rounded-lg px-3 py-1.5 text-[12px] font-heading font-semibold text-red-600 dark:text-red-400">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
