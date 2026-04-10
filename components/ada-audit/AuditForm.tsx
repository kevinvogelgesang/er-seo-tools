'use client'

import { useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { useRouter } from 'next/navigation'

function normalizeUrl(raw: string): { url: string; error: string | null } {
  const trimmed = raw.trim()
  if (!trimmed) return { url: '', error: null }

  // Reject obviously invalid inputs early
  if (trimmed.includes(' ')) {
    return { url: trimmed, error: 'URLs can\'t contain spaces — did you mean to enter a single URL?' }
  }

  // Prepend https:// if no protocol present
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`

  try {
    const parsed = new URL(withProtocol)

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { url: trimmed, error: 'Only http:// and https:// URLs are supported.' }
    }

    if (!parsed.hostname.includes('.')) {
      return { url: trimmed, error: `"${parsed.hostname}" doesn't look like a valid domain — try something like federico.edu` }
    }

    return { url: parsed.toString(), error: null }
  } catch {
    return { url: trimmed, error: `"${trimmed}" isn't a valid URL — try federico.edu or https://federico.edu/programs` }
  }
}

export default function AuditForm() {
  const router = useRouter()

  const [url, setUrl] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wcagLevel, setWcagLevel] = useState<'wcag21aa' | 'wcag22aa'>('wcag21aa')
  const [captureScreenshots, setCaptureScreenshots] = useState(false)

  function handleUrlChange(e: React.ChangeEvent<HTMLInputElement>) {
    setUrl(e.target.value)
    setUrlError(null)
    setError(null)
  }

  function handleUrlBlur() {
    if (!url.trim()) return
    const { error } = normalizeUrl(url)
    setUrlError(error)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const { url: normalized, error: validationError } = normalizeUrl(url)
    if (validationError) {
      setUrlError(validationError)
      return
    }
    if (!normalized) return

    setIsRunning(true)

    try {
      const res = await fetch('/api/ada-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: normalized,
          wcagLevel,
          captureScreenshots,
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

  const normalizedPreview = url.trim() && !urlError
    ? (() => {
        const { url: n } = normalizeUrl(url)
        return n !== url.trim() ? n : null
      })()
    : null

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* URL input */}
      <div>
        <label htmlFor="audit-url" className="block text-[13px] font-body font-semibold text-navy/70 dark:text-white/70 mb-1.5">
          Page URL to audit
        </label>
        <input
          id="audit-url"
          type="text"
          required
          value={url}
          onChange={handleUrlChange}
          onBlur={handleUrlBlur}
          placeholder="federico.edu or https://federico.edu/programs"
          disabled={isRunning}
          className={`w-full px-3.5 py-2.5 text-[14px] font-body text-navy dark:text-white border rounded-lg focus:outline-none focus:ring-2 focus:border-orange disabled:opacity-50 disabled:bg-gray-50 dark:bg-navy-card dark:disabled:bg-navy-deep transition-colors ${
            urlError
              ? 'border-red-400 dark:border-red-500 focus:ring-red-400/40'
              : 'border-gray-300 dark:border-navy-border focus:ring-orange/40'
          }`}
        />
        {urlError && (
          <p className="text-[12px] font-body text-red-600 dark:text-red-400 mt-1.5 flex items-start gap-1.5">
            <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            {urlError}
          </p>
        )}
        {normalizedPreview && !urlError && (
          <p className="text-[12px] font-body text-navy/40 dark:text-white/40 mt-1.5">
            Will audit: <span className="text-navy/60 dark:text-white/60 font-medium">{normalizedPreview}</span>
          </p>
        )}
      </div>

      {/* WCAG level selector */}
      <div>
        <p id="wcag-level-label" className="block text-[13px] font-body font-semibold text-navy/70 dark:text-white/70 mb-1.5">
          WCAG Level
        </p>
        <div role="group" aria-labelledby="wcag-level-label" className="flex gap-2">
          {([
            { value: 'wcag21aa', label: 'WCAG 2.1 AA', badge: 'Required' },
            { value: 'wcag22aa', label: '+ Best Practices', badge: 'Aspirational' },
          ] as const).map(({ value, label, badge }) => (
            <button
              key={value}
              type="button"
              aria-pressed={wcagLevel === value}
              onClick={() => setWcagLevel(value)}
              disabled={isRunning}
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

      {/* Screenshot toggle */}
      <label className="flex items-start gap-3 cursor-pointer group">
        <input
          type="checkbox"
          checked={captureScreenshots}
          onChange={(e) => setCaptureScreenshots(e.target.checked)}
          disabled={isRunning}
          className="mt-0.5 w-4 h-4 rounded border-gray-300 dark:border-navy-border text-orange focus:ring-orange/40 disabled:opacity-50"
        />
        <div>
          <span className="text-[13px] font-body font-semibold text-navy/70 dark:text-white/70 group-hover:text-navy dark:group-hover:text-white transition-colors">
            Capture element screenshots
          </span>
          <p className="text-[11px] font-body text-navy/40 dark:text-white/40 mt-0.5">
            Saves a PNG for the first failing element of each violation. Adds a few seconds to the audit.
          </p>
        </div>
      </label>

      {error && (
        <p className="text-[13px] font-body text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg px-4 py-2.5">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isRunning || !url.trim() || !!urlError}
        className="w-full flex items-center justify-center gap-2 px-5 py-2.5 bg-orange hover:bg-orange-light text-white font-body font-semibold text-[14px] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isRunning ? (
          <>
            <Spinner className="w-4 h-4" />
            Starting audit…
          </>
        ) : (
          'Run Audit'
        )}
      </button>
    </form>
  )
}
