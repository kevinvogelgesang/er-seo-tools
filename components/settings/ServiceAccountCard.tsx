'use client'

import { useState, useEffect } from 'react'

interface StatusData {
  loaded: boolean
  email: string | null
  ga4Count?: number
  gscCount?: number
  errors?: string[]
}

const inputCls =
  'border border-gray-300 dark:border-navy-border rounded px-2 py-1 bg-white dark:bg-navy-deep text-gray-800 dark:text-white/90'

export function ServiceAccountCard() {
  const [status, setStatus] = useState<StatusData | null>(null)
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void fetch('/api/google/status')
      .then((r) => r.json())
      .then((d: StatusData) => setStatus(d))
      .catch(() => setError('Failed to load status'))
      .finally(() => setLoading(false))
  }, [])

  async function runTest() {
    setTesting(true)
    setError(null)
    try {
      const res = await fetch('/api/google/status?test=1')
      const d = await res.json() as StatusData
      setStatus(d)
    } catch {
      setError('Test connection failed')
    } finally {
      setTesting(false)
    }
  }

  const showGrantHint =
    status?.loaded &&
    status.ga4Count !== undefined &&
    status.gscCount !== undefined &&
    (status.ga4Count === 0 || status.gscCount === 0)

  return (
    <div className="bg-white dark:bg-navy-card rounded-xl border border-gray-200 dark:border-navy-border p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-white/80">
          Google Service Account
        </h2>
        <button
          onClick={() => void runTest()}
          disabled={testing || loading || !status?.loaded}
          className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-40 disabled:no-underline"
        >
          {testing ? 'Testing…' : 'Test connection'}
        </button>
      </div>

      {loading && (
        <p className="text-xs text-gray-400 dark:text-white/40">Loading…</p>
      )}

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400 mb-2">{error}</p>
      )}

      {status && !loading && (
        <dl className="space-y-3 text-xs">
          <div className="flex items-center gap-3">
            <dt className="w-28 text-gray-500 dark:text-white/50 flex-shrink-0">Key file</dt>
            <dd className="flex items-center gap-1.5">
              {status.loaded ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                  <span className="text-green-700 dark:text-green-400 font-semibold">Loaded</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                  <span className="text-red-700 dark:text-red-400 font-semibold">Not found</span>
                </>
              )}
            </dd>
          </div>

          <div className="flex items-center gap-3">
            <dt className="w-28 text-gray-500 dark:text-white/50 flex-shrink-0">SA email</dt>
            <dd className="text-gray-800 dark:text-white/90 font-mono break-all">
              {status.email ?? <span className="text-gray-400 dark:text-white/30 italic">—</span>}
            </dd>
          </div>

          {status.ga4Count !== undefined && (
            <div className="flex items-center gap-3">
              <dt className="w-28 text-gray-500 dark:text-white/50 flex-shrink-0">GA4 properties</dt>
              <dd className="text-gray-800 dark:text-white/90 font-semibold tabular-nums">
                {status.ga4Count}
              </dd>
            </div>
          )}

          {status.gscCount !== undefined && (
            <div className="flex items-center gap-3">
              <dt className="w-28 text-gray-500 dark:text-white/50 flex-shrink-0">GSC sites</dt>
              <dd className="text-gray-800 dark:text-white/90 font-semibold tabular-nums">
                {status.gscCount}
              </dd>
            </div>
          )}
        </dl>
      )}

      {showGrantHint && (
        <div className="mt-4 p-3 rounded-lg bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-200 dark:border-yellow-500/20">
          <p className="text-xs text-yellow-800 dark:text-yellow-300 mb-1 font-semibold">Access not granted yet</p>
          <p className="text-xs text-yellow-700 dark:text-yellow-400 mb-2">
            Copy the service-account email above and grant access in both platforms:
          </p>
          <code className="block text-xs bg-yellow-100 dark:bg-yellow-500/20 text-yellow-900 dark:text-yellow-200 rounded px-2 py-1.5 select-all">
            Grant this service-account email access in GA4 → Property Access Management and Search Console → Users and permissions
          </code>
        </div>
      )}

      {status && !status.loaded && (
        <div className="mt-4 p-3 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
          <p className="text-xs text-red-700 dark:text-red-400">
            Set <code className="font-mono bg-red-100 dark:bg-red-500/20 px-1 rounded">GOOGLE_SA_KEY_FILE</code> to
            the path of your service-account JSON key file. The key is never committed to the repo.
          </p>
        </div>
      )}
    </div>
  )
}
