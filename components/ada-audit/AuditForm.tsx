'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

interface Client {
  id: number
  name: string
}

export default function AuditForm() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [url, setUrl] = useState('')
  const [clientId, setClientId] = useState<number | ''>('')
  const [clients, setClients] = useState<Client[]>([])
  const [clientsLoading, setClientsLoading] = useState(true)
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Pre-select client from ?clientId= query param
  useEffect(() => {
    const qc = searchParams.get('clientId')
    if (qc) setClientId(parseInt(qc, 10))
  }, [searchParams])

  useEffect(() => {
    fetch('/api/clients')
      .then((r) => r.json())
      .then((data: Client[]) => setClients(Array.isArray(data) ? data : []))
      .catch(() => setClients([]))
      .finally(() => setClientsLoading(false))
  }, [])

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
          clientId: clientId !== '' ? clientId : null,
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
      <div>
        <label htmlFor="audit-url" className="block text-[13px] font-body font-semibold text-navy/70 mb-1.5">
          Page URL to audit
        </label>
        <input
          id="audit-url"
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.edu"
          disabled={isRunning}
          className="w-full px-3.5 py-2.5 text-[14px] font-body text-navy border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange/40 focus:border-orange disabled:opacity-50 disabled:bg-gray-50 transition-colors"
        />
      </div>

      <div>
        <label htmlFor="audit-client" className="block text-[13px] font-body font-semibold text-navy/70 mb-1.5">
          Client <span className="text-navy/40 font-normal">(optional)</span>
        </label>
        <select
          id="audit-client"
          value={clientId}
          onChange={(e) => setClientId(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
          disabled={isRunning || clientsLoading}
          className="w-full px-3.5 py-2.5 text-[14px] font-body text-navy border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange/40 focus:border-orange disabled:opacity-50 disabled:bg-gray-50 transition-colors bg-white"
        >
          {clientsLoading ? (
            <option value="">Loading clients…</option>
          ) : (
            <>
              <option value="">No client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </>
          )}
        </select>
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
