'use client'

import { useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { useRouter } from 'next/navigation'

export default function AuditForm() {
  const router = useRouter()

  const [url, setUrl] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wcagLevel, setWcagLevel] = useState<'wcag21aa' | 'wcag22aa'>('wcag21aa')
  const [captureScreenshots, setCaptureScreenshots] = useState(false)

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

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* URL input */}
      <div>
        <label htmlFor="audit-url" className="block text-[13px] font-body font-semibold text-navy/70 dark:text-white/70 mb-1.5">
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
          className="w-full px-3.5 py-2.5 text-[14px] font-body text-navy dark:text-white border border-gray-300 dark:border-navy-border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange/40 focus:border-orange disabled:opacity-50 disabled:bg-gray-50 dark:bg-navy-card dark:disabled:bg-navy-deep transition-colors"
        />
      </div>

      {/* WCAG level selector */}
      <div>
        <label className="block text-[13px] font-body font-semibold text-navy/70 dark:text-white/70 mb-1.5">
          WCAG Level
        </label>
        <div className="flex gap-2">
          {([
            { value: 'wcag21aa', label: 'WCAG 2.1 AA', badge: 'Required' },
            { value: 'wcag22aa', label: '+ Best Practices', badge: 'Aspirational' },
          ] as const).map(({ value, label, badge }) => (
            <button
              key={value}
              type="button"
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
        disabled={isRunning || !url.trim()}
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
