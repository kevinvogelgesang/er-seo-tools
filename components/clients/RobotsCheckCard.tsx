'use client'

// D4 — client-page card for robots/sitemap checks + history.
// Server preloads the FIRST domain's summaries + latest detail; switching
// domains or expanding history fetches lazily.
// POST failure OR client-side timeout reconciles: refetch history AND the
// newest row's detail — the row may still have committed server-side
// (Codex #5 / plan-Codex #5). A generation token guards domain switches so
// a slow response never overwrites the newly selected domain.
// changed:null renders an em dash, never "unchanged" (absence != sameness).

import { useRef, useState } from 'react'
import type { RobotsCheckDetail, RobotsCheckSummary } from '@/lib/robots-check/types'
import type { RobotsChangeSummary } from '@/lib/robots-check/change-summary'
import { Explainer, ExplainerSummary } from '@/components/ui/Explainer'

interface Latest {
  summary: RobotsCheckSummary
  detail: RobotsCheckDetail
  changeSummary?: RobotsChangeSummary | null
}

interface Props {
  clientId: number
  domains: string[]
  archived: boolean
  initial: { checks: RobotsCheckSummary[]; latest: Latest | null }
}

// Client deadline sits ABOVE the documented server hard bound (~75s =
// 60s budget + one 15s in-flight fetch window) so the server finishes first.
const POST_DEADLINE_MS = 90_000

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  ok: { label: 'Robots OK', cls: 'bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400 border-green-200 dark:border-green-500/30' },
  missing: { label: 'Robots missing', cls: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/30' },
  unreachable: { label: 'Unreachable', cls: 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/30' },
}

// UTC-pinned: server-rendered initial data must format identically in the
// browser or hydration mismatches appear (plan-Codex #5).
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function ChangedBadge({ changed }: { changed: boolean | null }) {
  if (changed === null) return <span className="text-xs text-gray-400 dark:text-white/40">&mdash;</span>
  return changed ? (
    <span className="text-xs font-semibold text-orange">changed</span>
  ) : (
    <span className="text-xs text-gray-500 dark:text-white/50">no change</span>
  )
}

function ChangeSummarySection({ summary }: { summary: RobotsChangeSummary }) {
  const diff = summary.robotsDiff
  // plan-Codex #3: non-null EMPTY diff = reorder/formatting-only evidence;
  // NULL diff with a changed hash = a raw body was unavailable — say so.
  const reorderOnly = summary.robotsContentChanged && diff !== null && diff.added.length === 0 && diff.removed.length === 0
  const diffUnavailable = summary.robotsContentChanged && diff === null
  return (
    <div className="mt-1 border-l-2 border-orange/40 pl-2">
      <p className="text-[11px] font-semibold text-gray-600 dark:text-white/60">Changed vs previous</p>
      {summary.robotsStatus && (
        <p className="text-[11px] text-gray-500 dark:text-white/50">
          Robots status: {summary.robotsStatus.prev} &rarr; {summary.robotsStatus.curr}
        </p>
      )}
      {diff && diff.removed.map((l, i) => (
        <p key={`r${i}`} className="font-mono text-[11px] text-red-600 dark:text-red-400">- {l}</p>
      ))}
      {diff && diff.added.map((l, i) => (
        <p key={`a${i}`} className="font-mono text-[11px] text-green-700 dark:text-green-400">+ {l}</p>
      ))}
      {diff?.truncated && <p className="text-[11px] text-gray-400 dark:text-white/40">(diff truncated)</p>}
      {reorderOnly && (
        <p className="text-[11px] text-gray-500 dark:text-white/50">robots.txt changed (reordering or formatting only)</p>
      )}
      {diffUnavailable && (
        <p className="text-[11px] text-gray-500 dark:text-white/50">robots.txt content changed (line diff unavailable)</p>
      )}
      {summary.blockedBots?.added.length ? (
        <p className="text-[11px] text-red-600 dark:text-red-400">AI bots newly blocked: {summary.blockedBots.added.join(', ')}</p>
      ) : null}
      {summary.blockedBots?.removed.length ? (
        <p className="text-[11px] text-gray-500 dark:text-white/50">AI bots unblocked: {summary.blockedBots.removed.join(', ')}</p>
      ) : null}
      {summary.sitemaps && (
        <>
          {/* index-based keys: duplicate URLs are deliberately preserved
              upstream via (url, ordinal) pairing — URL-only keys collide
              (plan-Codex #4) */}
          {summary.sitemaps.added.map((u, i) => <p key={`sa${i}`} className="text-[11px] text-gray-500 dark:text-white/50">Sitemap added: <span className="font-mono">{u}</span></p>)}
          {summary.sitemaps.removed.map((u, i) => <p key={`sr${i}`} className="text-[11px] text-gray-500 dark:text-white/50">Sitemap removed: <span className="font-mono">{u}</span></p>)}
          {summary.sitemaps.changed.map((c, i) => (
            <p key={`sc${i}`} className="text-[11px] text-gray-500 dark:text-white/50">
              Sitemap changed: <span className="font-mono">{c.url}</span>
              {c.urlCountPrev !== c.urlCountCurr ? ` (URLs ${c.urlCountPrev ?? '?'} → ${c.urlCountCurr ?? '?'})` : ''}
              {c.childrenChanged ? ' (children changed)' : ''}
            </p>
          ))}
          {summary.sitemaps.orderChanged && <p className="text-[11px] text-gray-500 dark:text-white/50">Sitemap order changed (same set)</p>}
        </>
      )}
      {summary.sitemapUrlTotal && (
        <p className="text-[11px] text-gray-500 dark:text-white/50 tabular-nums">
          Total sitemap URLs: {summary.sitemapUrlTotal.prev ?? '—'} &rarr; {summary.sitemapUrlTotal.curr ?? '—'}
        </p>
      )}
      {summary.counts && (
        <p className="text-[11px] text-gray-500 dark:text-white/50 tabular-nums">
          Errors {summary.counts.errorsPrev} &rarr; {summary.counts.errorsCurr} · warnings {summary.counts.warningsPrev} &rarr; {summary.counts.warningsCurr}
        </p>
      )}
    </div>
  )
}

export function RobotsCheckCard({ clientId, domains, archived, initial }: Props) {
  const [domain, setDomain] = useState(domains[0] ?? '')
  const [checks, setChecks] = useState<RobotsCheckSummary[]>(initial.checks)
  const [latest, setLatest] = useState<Latest | null>(initial.latest)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [expandedStored, setExpandedStored] = useState<Latest | null>(null)
  // Generation token: bumped on every domain switch; stale async flows
  // check it before every setState (plan-Codex #5).
  const genRef = useRef(0)
  // Row id of the LATEST expand request, set synchronously on click. A late
  // detail response for a previously clicked row must never render under a
  // newer row — genRef alone can't see same-domain row switches.
  const expandedReqRef = useRef<number | null>(null)

  /** Refetch history + newest detail for `forDomain`; applies state only if
   *  the generation still matches. Failures surface inline. */
  const reconcile = async (forDomain: string, gen: number) => {
    try {
      const res = await fetch(`/api/clients/${clientId}/robots-checks?domain=${encodeURIComponent(forDomain)}`)
      if (!res.ok) {
        if (genRef.current === gen) setError('Could not load check history.')
        return
      }
      const body = await res.json()
      const list = body.checks as RobotsCheckSummary[]
      if (genRef.current !== gen) return
      setChecks(list)
      if (list.length > 0) {
        const dRes = await fetch(`/api/clients/${clientId}/robots-checks/${list[0].id}`)
        if (genRef.current !== gen) return
        if (dRes.ok) {
          setLatest((await dRes.json()) as Latest)
        } else {
          setError('Could not load the latest check detail.')
        }
      } else {
        setLatest(null)
      }
    } catch {
      if (genRef.current === gen) setError('Could not load check history.')
    }
  }

  const runCheck = async () => {
    const gen = genRef.current
    setRunning(true)
    setError(null)
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(), POST_DEADLINE_MS)
    try {
      const res = await fetch(`/api/clients/${clientId}/robots-checks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain }),
        signal: controller.signal,
      })
      if (!res.ok) {
        if (genRef.current === gen) setError('Check failed. The result may still have been recorded; refreshing history.')
        await reconcile(domain, gen)
        return
      }
      const body = (await res.json()) as Latest
      if (genRef.current !== gen) return
      setLatest(body)
      setChecks((prev) => [body.summary, ...prev])
    } catch {
      // Includes the AbortController deadline: the server may still commit
      // the row after our timeout — reconcile instead of trusting local state.
      if (genRef.current === gen) setError('Check failed. The result may still have been recorded; refreshing history.')
      await reconcile(domain, gen)
    } finally {
      clearTimeout(deadline)
      if (genRef.current === gen) setRunning(false)
    }
  }

  const switchDomain = async (next: string) => {
    genRef.current += 1
    const gen = genRef.current
    expandedReqRef.current = null
    setDomain(next)
    setLatest(null)
    // Clear the previous domain's rows immediately: if the new domain's
    // history GET fails, reconcile only sets `error` — leaving the old
    // checks in state would show cross-domain rows under the new selection.
    setChecks([])
    setExpandedId(null)
    setExpandedStored(null)
    setError(null)
    await reconcile(next, gen)
  }

  const toggleExpand = async (id: number) => {
    if (expandedId === id) {
      expandedReqRef.current = null
      setExpandedId(null)
      return
    }
    const gen = genRef.current
    expandedReqRef.current = id
    setExpandedId(id)
    setExpandedStored(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/robots-checks/${id}`)
      if (genRef.current !== gen || expandedReqRef.current !== id) return
      if (res.ok) {
        const stored = (await res.json()) as Latest
        if (genRef.current !== gen || expandedReqRef.current !== id) return
        setExpandedStored(stored)
      } else {
        setError('Could not load that check.')
      }
    } catch {
      if (genRef.current === gen && expandedReqRef.current === id) setError('Could not load that check.')
    }
  }

  if (domains.length === 0) {
    return (
      <div className="bg-white dark:bg-navy-card rounded-xl border border-gray-200 dark:border-navy-border p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-white/80 mb-2">Robots &amp; Sitemap Checks</h2>
        <p className="text-sm text-gray-500 dark:text-white/50">Add a domain to this client to run checks.</p>
      </div>
    )
  }

  const detail = latest?.detail ?? null
  const truncated = detail !== null && (
    detail.timeBudgetExhausted ||
    detail.sitemapsSkipped > 0 ||
    detail.sitemaps.some((s) => s.childrenSkipped > 0)
  )

  return (
    <div className="bg-white dark:bg-navy-card rounded-xl border border-gray-200 dark:border-navy-border p-5 mb-6">
      <div className="flex items-center justify-between mb-3 gap-3">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-white/80">Robots &amp; Sitemap Checks</h2>
        <div className="flex items-center gap-2">
          {domains.length > 1 && (
            <select
              value={domain}
              onChange={(e) => void switchDomain(e.target.value)}
              className="text-xs border border-gray-200 dark:border-navy-border rounded-md px-2 py-1 bg-white dark:bg-navy-deep text-gray-700 dark:text-white/80"
            >
              {domains.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          {!archived && (
            <button
              type="button"
              onClick={() => void runCheck()}
              disabled={running}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
            >
              {running ? 'Checking…' : 'Run Check'}
            </button>
          )}
          <a
            href={`/robots-validator?url=${encodeURIComponent(`https://${domain}`)}`}
            className="text-xs text-gray-500 dark:text-white/50 hover:underline"
          >
            Open in Validator
          </a>
        </div>
      </div>

      <Explainer label="What is this?" className="mb-3">
        <ExplainerSummary>
          Point-in-time checks of this domain&apos;s robots.txt and sitemaps: syntax problems,
          AI-crawler blocking, and whether each listed sitemap resolves and how many URLs it
          declares. A weekly scheduled check compares against the previous one and emails an alert
          only when something changed — checks run manually from this card never send alerts.
          Sitemap XML itself is never stored, so history rows carry counts and hashes rather than
          full copies.
        </ExplainerSummary>
      </Explainer>

      {error && <p className="text-xs text-red-600 dark:text-red-400 mb-3">{error}</p>}

      {detail && latest && (
        <div className="mb-4">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded border ${STATUS_BADGE[detail.robots.status].cls}`}>
              {STATUS_BADGE[detail.robots.status].label}
            </span>
            <span className="text-xs text-gray-600 dark:text-white/60 tabular-nums">
              {latest.summary.errorCount} errors · {latest.summary.warningCount} warnings
            </span>
            {detail.robots.blockedBots.length > 0 && (
              <details className="text-xs text-gray-600 dark:text-white/60">
                <summary className="cursor-pointer">{detail.robots.blockedBots.length} AI bot{detail.robots.blockedBots.length === 1 ? '' : 's'} blocked</summary>
                <span className="font-mono">{detail.robots.blockedBots.join(', ')}</span>
              </details>
            )}
            {latest.summary.sitemapUrlTotal !== null ? (
              <span className="text-xs text-gray-600 dark:text-white/60 tabular-nums">{latest.summary.sitemapUrlTotal} sitemap URLs</span>
            ) : (
              <span className="text-xs text-gray-400 dark:text-white/40">no sitemap observed</span>
            )}
          </div>
          <ul className="space-y-1">
            {detail.sitemaps.map((s) => (
              <li key={s.url} className="text-xs text-gray-600 dark:text-white/60 flex flex-wrap gap-2">
                <span className="font-mono truncate max-w-[60%]">{s.url}</span>
                {s.ok ? (
                  <span className="tabular-nums">
                    {s.urlCount} URLs{s.isIndex ? ` · ${s.childrenTotal} children (${s.childrenFailed} failed${s.childrenExcluded > 0 ? `, ${s.childrenExcluded} excluded` : ''})` : ''}
                  </span>
                ) : (
                  <span className="text-red-600 dark:text-red-400">{s.failure}</span>
                )}
              </li>
            ))}
          </ul>
          {truncated && (
            <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
              Results possibly incomplete (check hit a size or time cap).
            </p>
          )}
        </div>
      )}

      {checks.length > 0 && (
        <div className="border-t border-gray-100 dark:border-navy-border pt-3">
          <h3 className="text-[11px] uppercase tracking-wider text-gray-400 dark:text-white/40 mb-2">History</h3>
          <ul className="space-y-1">
            {checks.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => void toggleExpand(c.id)}
                  className="w-full flex items-center gap-3 text-left text-xs text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-navy-light/50 rounded px-1 py-1"
                >
                  <span className="tabular-nums">{formatDate(c.createdAt)}</span>
                  <ChangedBadge changed={c.changed} />
                  <span className="tabular-nums">{c.errorCount}E / {c.warningCount}W</span>
                  {c.source === 'scheduled' && <span className="text-gray-400 dark:text-white/40">scheduled</span>}
                </button>
                {expandedId === c.id && expandedStored && (
                  <div className="pl-4 py-1 text-[11px] text-gray-500 dark:text-white/50">
                    {expandedStored.detail.robots.issues.length + expandedStored.detail.sitemaps.reduce((n, s) => n + s.issues.length, 0)} issue(s) recorded ·{' '}
                    {expandedStored.detail.robots.blockedBots.length} AI bot(s) blocked
                    {expandedStored.summary.changed === true && expandedStored.changeSummary && (
                      <ChangeSummarySection summary={expandedStored.changeSummary} />
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {checks.length === 0 && !detail && (
        <p className="text-sm text-gray-500 dark:text-white/50">No checks yet. Run one to record the current robots.txt and sitemap state.</p>
      )}
    </div>
  )
}
