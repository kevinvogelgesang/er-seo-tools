'use client'
// C14 intake: deliberately minimal — one form + one list. Polls the list
// endpoint while any prospect has a transient scan (C17-style smart polling,
// list endpoint reused instead of a bespoke status route).
//
// A5 Task 19: mount-scoped `prospect-list` subscription (unconditional — a
// prospect created/deleted/settled elsewhere must be picked up even when
// nothing in THIS component's last-fetched list is currently transient) +
// health-gated cadence on the existing bounded poll: original 8s fast cadence
// while SSE is absent/unhealthy, demoting to a 60s safety cadence once SSE is
// confirmed healthy, re-arming fast on drop. Bounded-poll semantics (only
// polls at all while some prospect is transient/not-yet-reportable) unchanged
// — see the ReportLibrary migration (Task 18) for the same pattern.
import { useCallback, useEffect, useState } from 'react'
import type { ProspectRow } from '@/lib/services/prospects'
import { subscribeTopic, subscribeHealth } from '@/lib/events/client'
import { prospectListTopic } from '@/lib/events/topics'

const TRANSIENT = new Set(['queued', 'running', 'pdfs-running', 'lighthouse-running'])
const FAST_MS = 8000
const SAFETY_MS = 60_000

export function ProspectDashboard(props: { initialProspects: ProspectRow[] }) {
  const [prospects, setProspects] = useState(props.initialProspects)
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/sales/prospects')
      if (res.ok) setProspects((await res.json()).prospects)
    } catch { /* transient poll failure — keep last state */ }
  }, [])

  const anyInFlight = prospects.some(
    (p) => p.latestAudit && (TRANSIENT.has(p.latestAudit.status) || (p.latestAudit.status === 'complete' && !p.latestAudit.reportable)),
  )

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

  function statusLabel(p: ProspectRow): string {
    if (!p.latestAudit) return 'Not scanned yet'
    if (TRANSIENT.has(p.latestAudit.status)) return 'Scanning…'
    if (p.latestAudit.status === 'complete' && !p.latestAudit.reportable) return 'Report building…'
    if (p.latestAudit.status === 'complete') return 'Report ready'
    return `Scan ${p.latestAudit.status}`
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
          <div key={p.id} className="p-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[14px] font-heading font-semibold text-navy dark:text-white">{p.name}</p>
              <p className="text-[12px] font-body text-navy/50 dark:text-white/50">
                {p.domain} · {statusLabel(p)}
                {p.latestAudit?.adaScore != null && ` · ADA ${p.latestAudit.adaScore}/100`}
              </p>
            </div>
            <div className="flex gap-2">
              {p.latestAudit?.reportable && (
                <button onClick={() => copyLink(p.id)}
                  className="rounded-lg border border-gray-200 dark:border-navy-border px-3 py-1.5 text-[12px] font-heading font-semibold text-navy dark:text-white">
                  Copy sales link
                </button>
              )}
              <button onClick={() => startScan(p.id)}
                className="rounded-lg border border-gray-200 dark:border-navy-border px-3 py-1.5 text-[12px] font-heading font-semibold text-navy dark:text-white">
                {p.latestAudit ? 'Re-scan' : 'Scan now'}
              </button>
              <button onClick={() => remove(p.id)}
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
