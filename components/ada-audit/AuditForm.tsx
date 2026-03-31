'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

interface Client {
  id: number
  name: string
  domains: string[]
}

export default function AuditForm() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [url, setUrl] = useState('')
  const [urlTouched, setUrlTouched] = useState(false) // true once user manually edits the URL
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [clientsLoading, setClientsLoading] = useState(true)
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wcagLevel, setWcagLevel] = useState<'wcag21aa' | 'wcag22aa'>('wcag21aa')

  // Combobox state
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const comboRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/clients')
      .then((r) => r.json())
      .then((data: Client[]) => {
        const list = Array.isArray(data) ? data : []
        setClients(list)

        // Pre-select client from ?clientId= query param
        const qc = searchParams.get('clientId')
        if (qc) {
          const match = list.find((c) => c.id === parseInt(qc, 10))
          if (match) selectClient(match)
        }
      })
      .catch(() => setClients([]))
      .finally(() => setClientsLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setOpen(false)
        // Reset query to selected client name if one is selected
        if (selectedClient) setQuery(selectedClient.name)
        else setQuery('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [selectedClient])

  function selectClient(client: Client | null) {
    setSelectedClient(client)
    setOpen(false)
    if (client) {
      setQuery(client.name)
      // Auto-populate URL from first domain, unless user has manually typed a URL
      if (!urlTouched && client.domains.length > 0) {
        setUrl(`https://${client.domains[0]}`)
      }
    } else {
      setQuery('')
    }
  }

  function handleQueryChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value)
    setOpen(true)
    // If user clears the field, deselect client
    if (e.target.value === '') selectClientSilent(null)
  }

  // Select without triggering URL auto-fill (used for clearing)
  function selectClientSilent(client: Client | null) {
    setSelectedClient(client)
    if (!client) setQuery('')
  }

  const filtered = query === '' || (selectedClient && query === selectedClient.name)
    ? clients
    : clients.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setIsRunning(true)

    try {
      const res = await fetch('/api/ada-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url.trim(),
          clientId: selectedClient?.id ?? null,
          wcagLevel,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Request failed')
        setIsRunning(false)
        return
      }

      router.push(`/ada-audit/${data.id}`)
    } catch {
      setError('Network error — please try again')
      setIsRunning(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Client combobox — intentionally above URL so selection can pre-fill it */}
      <div>
        <label className="block text-[13px] font-body font-semibold text-navy/70 mb-1.5">
          Client <span className="text-navy/40 font-normal">(optional)</span>
        </label>
        <div ref={comboRef} className="relative">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleQueryChange}
            onFocus={() => setOpen(true)}
            placeholder={clientsLoading ? 'Loading clients…' : 'Search clients…'}
            disabled={isRunning || clientsLoading}
            autoComplete="off"
            className="w-full px-3.5 py-2.5 text-[14px] font-body text-navy border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange/40 focus:border-orange disabled:opacity-50 disabled:bg-gray-50 transition-colors"
          />
          {/* Clear button */}
          {selectedClient && !isRunning && (
            <button
              type="button"
              onClick={() => { selectClient(null); setUrlTouched(false); setUrl(''); inputRef.current?.focus() }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-navy/30 hover:text-navy/70 transition-colors"
              aria-label="Clear client"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}

          {/* Dropdown */}
          {open && !clientsLoading && (
            <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="px-4 py-3 text-[13px] font-body text-navy/40">No clients match</div>
              ) : (
                <>
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); selectClient(null) }}
                    className="w-full text-left px-4 py-2.5 text-[13px] font-body text-navy/40 hover:bg-gray-50 transition-colors border-b border-gray-100"
                  >
                    No client
                  </button>
                  {filtered.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); selectClient(c) }}
                      className={`w-full text-left px-4 py-2.5 text-[13px] font-body transition-colors hover:bg-gray-50 ${
                        selectedClient?.id === c.id ? 'text-orange font-semibold bg-orange/5' : 'text-navy'
                      }`}
                    >
                      <span>{c.name}</span>
                      {c.domains.length > 0 && (
                        <span className="ml-2 text-[11px] text-navy/35">{c.domains[0]}</span>
                      )}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* URL input */}
      <div>
        <label htmlFor="audit-url" className="block text-[13px] font-body font-semibold text-navy/70 mb-1.5">
          Page URL to audit
        </label>
        <input
          id="audit-url"
          type="url"
          required
          value={url}
          onChange={(e) => { setUrl(e.target.value); setUrlTouched(true) }}
          placeholder="https://example.edu"
          disabled={isRunning}
          className="w-full px-3.5 py-2.5 text-[14px] font-body text-navy border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange/40 focus:border-orange disabled:opacity-50 disabled:bg-gray-50 transition-colors"
        />
      </div>

      {/* WCAG level selector */}
      <div>
        <label className="block text-[13px] font-body font-semibold text-navy/70 mb-1.5">
          WCAG Level
        </label>
        <div className="flex gap-2">
          {([
            { value: 'wcag21aa', label: 'WCAG 2.1 AA', badge: 'Required' },
            { value: 'wcag22aa', label: 'WCAG 2.2 AA', badge: 'Recommended' },
          ] as const).map(({ value, label, badge }) => (
            <button
              key={value}
              type="button"
              onClick={() => setWcagLevel(value)}
              disabled={isRunning}
              className={`flex-1 flex flex-col items-center px-3 py-2 rounded-lg border text-[13px] font-body transition-colors disabled:opacity-50 ${
                wcagLevel === value
                  ? 'border-orange bg-orange/5 text-orange font-semibold'
                  : 'border-gray-300 text-navy hover:border-gray-400'
              }`}
            >
              <span>{label}</span>
              <span className={`text-[11px] font-normal mt-0.5 ${wcagLevel === value ? 'text-orange/70' : 'text-navy/40'}`}>{badge}</span>
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-[13px] font-body text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isRunning || !url.trim()}
        className="w-full flex items-center justify-center gap-2 px-5 py-2.5 bg-orange hover:bg-orange-light text-white font-body font-semibold text-[14px] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isRunning ? (
          <>
            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Starting audit…
          </>
        ) : (
          'Run Audit'
        )}
      </button>
    </form>
  )
}
