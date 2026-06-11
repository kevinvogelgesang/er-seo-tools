'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { Spinner } from '@/components/Spinner'
import { useRouter, useSearchParams } from 'next/navigation'
import { useClientCombobox } from '@/lib/hooks/useClientCombobox'
import { computeActivePhaseSummary } from '@/lib/ada-audit/queue-ui-helpers'
import type { QueueStatusWithBatch } from '@/lib/ada-audit/types'
import { parseManualUrls } from '@/lib/ada-audit/manual-urls'
import { formatInBrowserTZ } from '@/lib/ada-audit/format-date'

interface Client {
  id: number
  name: string
  domains: string[]
  seedUrls?: string[] | null
  seedUrlsUpdatedAt?: string | null
}

function formatSeedDate(dt: string | null | undefined): string {
  if (!dt) return ''
  return formatInBrowserTZ(dt, 'date')
}

interface Props {
  /** Lifted queue snapshot fed from the parent's 5s poll. `null` until the
   *  first poll resolves; banner stays hidden in that case. */
  queueStatus: QueueStatusWithBatch | null
}

export default function SiteAuditForm({ queueStatus }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [domain, setDomain] = useState('')
  const [domainTouched, setDomainTouched] = useState(false)

  // Prefill from `?prefillDomain=` (e.g., from the Clients section's "Run
  // audit" link). Reacts to URL changes too — if the user is already on the
  // /ada-audit page with the Full Site form mounted and they click a Run
  // audit link, the URL changes but the component stays mounted, so a
  // mount-only effect wouldn't pick it up.
  //
  // Guard: only apply when the prefillDomain value itself changes (tracked
  // via a ref). This prevents clobbering manual typing — typing the input
  // doesn't change the URL param, so the effect's deps don't re-fire.
  const lastAppliedPrefill = useRef<string | null>(null)
  useEffect(() => {
    const prefill = searchParams.get('prefillDomain')
    if (prefill && prefill !== lastAppliedPrefill.current) {
      setDomain(prefill)
      setDomainTouched(true)
      lastAppliedPrefill.current = prefill
    }
  }, [searchParams])

  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [clientsLoading, setClientsLoading] = useState(true)
  const [isDiscovering, setIsDiscovering] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wcagLevel, setWcagLevel] = useState<'wcag21aa' | 'wcag22aa'>('wcag21aa')

  // Discovery confirmation state
  const [discoveredUrls, setDiscoveredUrls] = useState<string[] | null>(null)
  const [discoveredDomain, setDiscoveredDomain] = useState<string | null>(null)

  // Manual URL mode (for Cloudflare-challenged sites)
  const [manualMode, setManualMode] = useState(false)
  const [manualUrlsText, setManualUrlsText] = useState('')
  // Track whether the operator has typed in the manual textarea (suppress re-prefill after edit)
  const [manualUrlsTouched, setManualUrlsTouched] = useState(false)
  // Save-to-client checkbox
  const [saveToClient, setSaveToClient] = useState(false)

  // queueStatus is owned by AuditIndexTabs and arrives via props. No local
  // poll, no setInterval.

  const inputRef = useRef<HTMLInputElement>(null)
  const { query, setQuery, open, setOpen, comboRef, filtered } = useClientCombobox(clients, selectedClient?.name ?? null)

  useEffect(() => {
    fetch('/api/clients')
      .then((r) => r.json())
      .then((data: Client[]) => setClients(Array.isArray(data) ? data : []))
      .catch(() => setClients([]))
      .finally(() => setClientsLoading(false))
  }, [])

  // Auto-prefill manual URLs from client's saved seedUrls
  useEffect(() => {
    if (!selectedClient) {
      // Selecting "No client" resets the save checkbox
      setSaveToClient(false)
      return
    }
    if (manualUrlsTouched) return
    const saved = selectedClient.seedUrls
    if (saved && saved.length > 0) {
      setManualMode(true)
      setManualUrlsText(saved.join('\n'))
      setSaveToClient(false) // don't silently overwrite an existing list
    } else {
      setSaveToClient(true) // default-checked when no list exists yet
    }
  }, [selectedClient]) // eslint-disable-line react-hooks/exhaustive-deps

  function selectClient(client: Client | null) {
    setSelectedClient(client)
    setOpen(false)
    setManualUrlsTouched(false) // reset so the effect can prefill for the new client
    if (!client) {
      setQuery('')
      // Clear manual mode state when deselecting
      setManualMode(false)
      setManualUrlsText('')
      return
    }

    setQuery(client.name)
    if (client.domains.length > 0) {
      setDomain(client.domains[0].replace(/^https?:\/\//i, '').replace(/\/.*$/, ''))
      setDomainTouched(false)
    } else {
      // Picking a client with no domain shouldn't leave the previous client's
      // domain sitting in the input. Clear it; the no-domain hint guides the
      // user to /clients to fix it.
      setDomain('')
      setDomainTouched(false)
    }
  }

  function handleQueryChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value)
    setOpen(true)
    if (e.target.value === '') { setSelectedClient(null) }
  }

  function resetDiscovery() {
    setDiscoveredUrls(null)
    setDiscoveredDomain(null)
  }

  async function handleDiscover(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    resetDiscovery()
    setIsDiscovering(true)

    try {
      const res = await fetch('/api/site-audit/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: domain.trim() }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Discovery failed')
        setIsDiscovering(false)
        return
      }

      setDiscoveredUrls(data.urls)
      setDiscoveredDomain(data.domain)
    } catch {
      setError('Network error — please try again')
    } finally {
      setIsDiscovering(false)
    }
  }

  async function handleStartAudit() {
    setError(null)
    setIsRunning(true)

    try {
      const res = await fetch('/api/site-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: discoveredDomain ?? domain.trim(),
          clientId: selectedClient?.id ?? null,
          wcagLevel,
          urls: discoveredUrls,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        if (res.status === 409 && data.id) {
          setError(`A site audit for this domain is already running.`)
          setIsRunning(false)
          router.push(`/ada-audit/site/${data.id}`)
          return
        }
        setError(data.error ?? 'Request failed')
        setIsRunning(false)
        return
      }

      router.push(`/ada-audit/site/${data.id}`)
    } catch {
      setError('Network error — please try again')
      setIsRunning(false)
    }
  }

  async function handleStartManualAudit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const urls = parseManualUrls(manualUrlsText)
    if (urls.length === 0) {
      setError('Please paste at least one URL (one per line).')
      return
    }
    if (!domain.trim()) {
      setError('Domain is required even when using manual URLs.')
      return
    }
    setIsRunning(true)

    // Save seed URLs to client before starting the audit (non-fatal)
    if (saveToClient && selectedClient) {
      try {
        await fetch(`/api/clients/${selectedClient.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seedUrls: urls }),
        })
      } catch {
        // non-fatal — log but continue with the audit
        console.warn('Failed to save seed URLs to client — continuing with audit')
      }
    }

    try {
      const res = await fetch('/api/site-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: domain.trim(),
          clientId: selectedClient?.id ?? null,
          wcagLevel,
          urls,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 409 && data.id) {
          setError('A site audit for this domain is already running.')
          setIsRunning(false)
          router.push(`/ada-audit/site/${data.id}`)
          return
        }
        setError(data.error ?? 'Request failed')
        setIsRunning(false)
        return
      }
      router.push(`/ada-audit/site/${data.id}`)
    } catch {
      setError('Network error — please try again')
      setIsRunning(false)
    }
  }

  const isBusy = isDiscovering || isRunning

  return (
    <form onSubmit={manualMode ? handleStartManualAudit : handleDiscover} className="space-y-4">
      {/* Client combobox */}
      <div>
        <label htmlFor="client-combobox" className="block text-[13px] font-body font-semibold text-navy/70 dark:text-white/70 mb-1.5">
          Client <span className="text-navy/40 dark:text-white/40 font-normal">(optional)</span>
        </label>
        <div ref={comboRef} className="relative">
          <input
            id="client-combobox"
            ref={inputRef}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            value={query}
            onChange={handleQueryChange}
            onFocus={() => setOpen(true)}
            placeholder={clientsLoading ? 'Loading clients…' : 'Search clients…'}
            disabled={isBusy || clientsLoading}
            autoComplete="off"
            className="w-full px-3.5 py-2.5 text-[14px] font-body text-navy dark:text-white border border-gray-300 dark:border-navy-border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange/40 focus:border-orange disabled:opacity-50 disabled:bg-gray-50 dark:bg-navy-card dark:disabled:bg-navy-deep transition-colors"
          />
          {selectedClient && !isBusy && (
            <button
              type="button"
              onClick={() => { selectClient(null); setDomainTouched(false); setDomain(''); inputRef.current?.focus() }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-navy/30 dark:text-white/30 hover:text-navy/70 dark:hover:text-white/70 transition-colors"
              aria-label="Clear client"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          {open && !clientsLoading && (
            <div className="absolute z-20 mt-1 w-full bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-lg shadow-lg max-h-56 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="px-4 py-3 text-[13px] font-body text-navy/40 dark:text-white/40">No clients match</div>
              ) : (
                <>
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); selectClient(null) }}
                    className="w-full text-left px-4 py-2.5 text-[13px] font-body text-navy/40 dark:text-white/40 hover:bg-gray-50 dark:hover:bg-navy-light border-b border-gray-100 dark:border-navy-border"
                  >
                    No client
                  </button>
                  {filtered.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); selectClient(c) }}
                      className={`w-full text-left px-4 py-2.5 text-[13px] font-body transition-colors hover:bg-gray-50 dark:hover:bg-navy-light ${
                        selectedClient?.id === c.id ? 'text-orange font-semibold bg-orange/5' : 'text-navy dark:text-white'
                      }`}
                    >
                      <span>{c.name}</span>
                      {c.domains.length > 0 && (
                        <span className="ml-2 text-[11px] text-navy/35 dark:text-white/35">{c.domains[0]}</span>
                      )}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Domain input */}
      <div>
        <label htmlFor="site-domain" className="block text-[13px] font-body font-semibold text-navy/70 dark:text-white/70 mb-1.5">
          Domain to audit
        </label>
        <input
          id="site-domain"
          type="text"
          required
          value={domain}
          onChange={(e) => { setDomain(e.target.value); setDomainTouched(true); resetDiscovery() }}
          placeholder="example.edu"
          disabled={isBusy}
          className="w-full px-3.5 py-2.5 text-[14px] font-body text-navy dark:text-white border border-gray-300 dark:border-navy-border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange/40 focus:border-orange disabled:opacity-50 disabled:bg-gray-50 dark:bg-navy-card dark:disabled:bg-navy-deep transition-colors"
        />
        {selectedClient && selectedClient.domains.length === 0 && (
          <p className="mt-1.5 text-[12px] font-body text-amber-700 dark:text-amber-400">
            This client has no domain configured.{' '}
            <Link href="/clients/manage" className="text-orange hover:underline">Add one →</Link>
          </p>
        )}
        <p className="text-[11px] font-body text-navy/40 dark:text-white/40 mt-1.5">
          We&apos;ll discover all pages from the sitemap and audit each one.
        </p>
      </div>

      {/* Manual URL list (for hard-to-discover sites like Cloudflare-challenged) */}
      <div>
        {!manualMode ? (
          <button
            type="button"
            onClick={() => setManualMode(true)}
            disabled={isBusy}
            className="text-[12px] font-body text-orange hover:text-orange-light underline disabled:opacity-50"
          >
            Paste URL list instead (for sites where discovery fails)
          </button>
        ) : (
          <div className="space-y-2 rounded-lg border border-gray-300 dark:border-navy-border p-4 bg-gray-50/40 dark:bg-navy-deep/30">
            <div className="flex items-center justify-between">
              <label htmlFor="manual-urls" className="block text-[13px] font-body font-semibold text-navy/70 dark:text-white/70">
                Paste URLs (one per line)
              </label>
              <button
                type="button"
                onClick={() => { setManualMode(false); setManualUrlsText('') }}
                disabled={isBusy}
                className="text-[11px] font-body text-navy/50 dark:text-white/50 hover:text-orange"
              >
                ← Back to discovery
              </button>
            </div>
            {/* Banner when prefilled from saved seedUrls */}
            {selectedClient?.seedUrls && selectedClient.seedUrls.length > 0 && !manualUrlsTouched && (
              <p className="text-[11px] font-body text-blue-700 dark:text-blue-300">
                Using saved seed URLs from {selectedClient.name}
                {selectedClient.seedUrlsUpdatedAt && <> · updated {formatSeedDate(selectedClient.seedUrlsUpdatedAt)}</>}
                <button
                  type="button"
                  onClick={() => { setManualMode(false); setManualUrlsText(''); setManualUrlsTouched(true) }}
                  className="ml-2 text-orange hover:underline"
                >
                  Use live discovery instead
                </button>
              </p>
            )}
            <textarea
              id="manual-urls"
              value={manualUrlsText}
              onChange={(e) => { setManualUrlsText(e.target.value); setManualUrlsTouched(true) }}
              disabled={isBusy}
              rows={6}
              placeholder={'https://example.edu/\nhttps://example.edu/about/\nhttps://example.edu/programs/'}
              className="w-full px-3 py-2 text-[12px] font-mono text-navy dark:text-white border border-gray-300 dark:border-navy-border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange/40 focus:border-orange disabled:opacity-50 disabled:bg-gray-50 dark:bg-navy-card dark:disabled:bg-navy-deep transition-colors"
            />
            <p className="text-[11px] font-body text-navy/50 dark:text-white/50">
              Use this when sitemap discovery fails (e.g. Cloudflare-challenged sites). URLs must be on the same domain as above; off-domain URLs are dropped server-side.
              {manualUrlsText.trim() && (
                <> · <span className="text-navy dark:text-white/70">{parseManualUrls(manualUrlsText).length}</span> URL{parseManualUrls(manualUrlsText).length !== 1 ? 's' : ''} parsed</>
              )}
            </p>
            {/* Save-to-client checkbox */}
            {selectedClient && (
              <label className="flex items-center gap-2 text-[12px] font-body text-navy/70 dark:text-white/70 mt-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={saveToClient}
                  onChange={(e) => setSaveToClient(e.target.checked)}
                  disabled={isBusy}
                />
                Save these URLs to {selectedClient.name}
                {selectedClient.seedUrls && selectedClient.seedUrls.length > 0 && (
                  <span className="text-navy/40 dark:text-white/40">(overwrites existing {selectedClient.seedUrls.length}-URL list)</span>
                )}
              </label>
            )}
          </div>
        )}
      </div>

      {/* WCAG level selector */}
      <div>
        <p id="site-wcag-level-label" className="block text-[13px] font-body font-semibold text-navy/70 dark:text-white/70 mb-1.5">
          WCAG Level
        </p>
        <div role="group" aria-labelledby="site-wcag-level-label" className="flex gap-2">
          {([
            { value: 'wcag21aa', label: 'WCAG 2.1 AA', badge: 'Required' },
            { value: 'wcag22aa', label: '+ Best Practices', badge: 'Aspirational' },
          ] as const).map(({ value, label, badge }) => (
            <button
              key={value}
              type="button"
              aria-pressed={wcagLevel === value}
              onClick={() => setWcagLevel(value)}
              disabled={isBusy}
              className={`flex-1 flex flex-col items-center px-3 py-2 rounded-lg border text-[13px] font-body transition-colors disabled:opacity-50 ${
                wcagLevel === value
                  ? 'border-orange bg-orange/5 text-orange font-semibold'
                  : 'border-gray-300 dark:border-navy-border text-navy dark:text-white hover:border-gray-400'
              }`}
            >
              <span>{label}</span>
              <span className={`text-[11px] font-normal mt-0.5 ${wcagLevel === value ? 'text-orange/70' : 'text-navy/40 dark:text-white/40'}`}>{badge}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Queue status banner */}
      {queueStatus && (queueStatus.active || queueStatus.queued.length > 0) && (
        <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-xl px-4 py-3 space-y-2">
          {queueStatus.active && (() => {
            const a = queueStatus.active
            const { label, complete, total, pct, unit } = computeActivePhaseSummary(a)
            return (
              <div className="space-y-1.5">
                <p className="text-[12px] font-body font-semibold text-blue-800 dark:text-blue-300">
                  {label}: {a.domain}
                  <span className="font-normal text-blue-600/60 dark:text-blue-400/60 ml-2">
                    {total > 0
                      ? `${complete}/${total} ${unit} (${pct}%)`
                      : unit === 'pages' ? 'Discovering pages…' : `Awaiting ${unit}…`}
                  </span>
                </p>
                {total > 0 && (
                  <div className="w-full bg-blue-200/50 dark:bg-blue-500/20 rounded-full h-1.5 overflow-hidden">
                    <div className="bg-blue-500 dark:bg-blue-400 h-1.5 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>
            )
          })()}
          {queueStatus.queued.length > 0 && (
            <p className="text-[11px] font-body text-blue-600/60 dark:text-blue-400/60">
              {queueStatus.queued.length} audit{queueStatus.queued.length !== 1 ? 's' : ''} queued
              {queueStatus.queued.length <= 3 && (
                <> — {queueStatus.queued.map(q => q.domain).join(', ')}</>
              )}
            </p>
          )}
          <p className="text-[11px] font-body text-blue-600/60 dark:text-blue-400/60">
            New audits will be queued and start automatically.
          </p>
        </div>
      )}

      {error && (
        <p className="text-[13px] font-body text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg px-4 py-2.5">
          {error}
        </p>
      )}

      {/* Discovery confirmation */}
      {discoveredUrls && !isRunning && (
        <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-xl px-4 py-3 space-y-2">
          <p className="text-[13px] font-body text-blue-800 dark:text-blue-300">
            Found <strong>{discoveredUrls.length.toLocaleString()} page{discoveredUrls.length !== 1 ? 's' : ''}</strong> on {discoveredDomain}.
            {discoveredUrls.length > 200 && (
              <> This is a large site — the audit may take a while.</>
            )}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleStartAudit}
              className="px-4 py-2 bg-orange hover:bg-orange-light text-white font-body font-semibold text-[13px] rounded-lg transition-colors"
            >
              Audit {discoveredUrls.length.toLocaleString()} pages
            </button>
            <button
              type="button"
              onClick={resetDiscovery}
              className="px-4 py-2 border border-gray-300 dark:border-navy-border text-navy dark:text-white font-body text-[13px] rounded-lg hover:bg-gray-50 dark:hover:bg-navy-light transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Submit buttons */}
      {!discoveredUrls && (
        <button
          type="submit"
          disabled={isBusy || !domain.trim() || (manualMode && parseManualUrls(manualUrlsText).length === 0)}
          className="w-full flex items-center justify-center gap-2 px-5 py-2.5 bg-orange hover:bg-orange-light text-white font-body font-semibold text-[14px] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isDiscovering ? (
            <>
              <Spinner className="w-4 h-4" />
              Discovering pages…
            </>
          ) : manualMode ? (
            `Audit ${parseManualUrls(manualUrlsText).length || ''} URL${parseManualUrls(manualUrlsText).length !== 1 ? 's' : ''}`.trim()
          ) : (
            'Discover Pages'
          )}
        </button>
      )}

      {isRunning && (
        <div className="flex items-center justify-center gap-2 px-5 py-2.5 text-[14px] font-body text-navy/50 dark:text-white/50">
          <Spinner className="w-4 h-4" />
          Starting audit…
        </div>
      )}
    </form>
  )
}
