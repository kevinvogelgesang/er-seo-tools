'use client'

// components/site-audit/ContentAuditCard.tsx
//
// C12 D1 — results-page SEO-tab card for the cat_ content-audit bridge. Mints
// a cat_ token + composes the clipboard prompt for the er-handoff-memo skill,
// then bounded-polls the cookie-gated GET route until the skill's PATCH lands
// ingested findings (mirrors the kst_ card's poller, simplified — no
// visibilitychange machine needed since this poll is short-lived and stops on
// arrival).
import { useEffect, useState } from 'react'
import { buildContentAuditPrompt } from '@/lib/content-audit-prompt'

interface CardProps {
  siteAuditId: string
  hasLiveScanRun: boolean
  initialContentAuditJson: string | null
}

type Finding = {
  type: string
  severity: string
  title: string
  detail: string
  evidence: { url: string; snippet: string }[]
  recommendation: string
}

const TYPE_LABEL: Record<string, string> = {
  data_inconsistency: 'Data inconsistency',
  stale_claim: 'Stale claim',
  quality_issue: 'Content quality',
}

// NEXT_PUBLIC_APP_URL is inlined at build (client-safe). Repo rule: share/handoff
// URLs use NEXT_PUBLIC_APP_URL, never window.location.origin (reverse-proxy trap).
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? ''

const POLL_INTERVAL_MS = 8000

export function ContentAuditCard({ siteAuditId, hasLiveScanRun, initialContentAuditJson }: CardProps) {
  const [prompt, setPrompt] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [json, setJson] = useState<string | null>(initialContentAuditJson)
  const [polling, setPolling] = useState(false)

  const findings: Finding[] = (() => {
    if (!json) return []
    try {
      const parsed = JSON.parse(json)
      return Array.isArray(parsed?.findings) ? (parsed.findings as Finding[]) : []
    } catch {
      return []
    }
  })()

  // Bounded poll after mint until findings arrive (surfaces the skill's PATCH
  // without a reload). Stops as soon as findings land; the interval is torn
  // down on unmount or when polling flips off.
  useEffect(() => {
    if (!polling || findings.length > 0) return
    let cancelled = false
    const iv = setInterval(async () => {
      if (cancelled) return
      try {
        const res = await fetch(`/api/site-audit/${siteAuditId}/content-audit`)
        if (!res.ok) return
        const body = await res.json()
        if (!cancelled && body.minted && body.contentAuditJson) {
          setJson(body.contentAuditJson)
          setPolling(false)
        }
      } catch {
        // Network errors are silent — the next tick retries.
      }
    }, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(iv)
    }
  }, [polling, siteAuditId, findings.length])

  if (!hasLiveScanRun) return null

  async function mint() {
    setError(null)
    try {
      const res = await fetch(`/api/site-audit/${siteAuditId}/content-audit/mint-token`, { method: 'POST' })
      if (!res.ok) {
        setError('Could not start a content audit.')
        return
      }
      const body = await res.json()
      setPrompt(buildContentAuditPrompt({ siteAuditId, token: body.token, appUrl: APP_URL }))
      setNote(body.textAvailable === false ? 'Retained page text expired — the analysis will fetch pages live.' : null)
      setPolling(true)
    } catch {
      setError('Could not start a content audit.')
    }
  }

  async function copy() {
    if (!prompt) return
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access denied/unavailable — the prompt is still visible to copy manually.
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-navy-border dark:bg-navy-card">
      <h3 className="font-semibold text-gray-900 dark:text-white">Content audit</h3>
      <p className="mt-1 text-sm text-gray-600 dark:text-white/70">
        Hand off this audit&apos;s page content to a Claude session for consistency, stale-claim, and quality review.
      </p>
      <button
        type="button"
        onClick={() => void mint()}
        className="mt-3 rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 dark:bg-blue-600 dark:hover:bg-blue-500"
      >
        Start content audit
      </button>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {note && <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">{note}</p>}
      {prompt && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => void copy()}
            className="mb-2 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 dark:border-navy-border dark:text-white/80 dark:hover:bg-navy-800"
          >
            {copied ? 'Copied' : 'Copy prompt'}
          </button>
          <pre className="overflow-x-auto rounded bg-gray-50 p-3 text-xs text-gray-800 dark:bg-navy-950 dark:text-white/80">
            {prompt}
          </pre>
          {polling && findings.length === 0 && (
            <p className="mt-2 text-xs text-gray-500 dark:text-white/50">
              Waiting for the skill to post findings back…
            </p>
          )}
        </div>
      )}
      {findings.length > 0 && (
        <div className="mt-4 space-y-3">
          {findings.map((f, i) => (
            <div key={i} className="rounded border border-gray-100 p-3 dark:border-navy-border">
              <div className="flex items-center gap-2">
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700 dark:bg-navy-800 dark:text-white/80">
                  {TYPE_LABEL[f.type] ?? f.type}
                </span>
                <span className="text-xs uppercase text-gray-500 dark:text-white/50">{f.severity}</span>
              </div>
              <p className="mt-1 font-medium text-gray-900 dark:text-white">{f.title}</p>
              <p className="text-sm text-gray-600 dark:text-white/70">{f.detail}</p>
              <ul className="mt-1 text-xs text-gray-500 dark:text-white/50">
                {f.evidence.map((e, j) => (
                  <li key={j}>{e.url}</li>
                ))}
              </ul>
              <p className="mt-1 text-sm text-gray-700 dark:text-white/80">
                <strong>Recommendation:</strong> {f.recommendation}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
