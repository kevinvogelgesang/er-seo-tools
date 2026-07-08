// components/widgets/QuickSiteAuditWidget.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { WidgetSize } from '@/lib/widgets/types'

export function QuickSiteAuditWidget({ size }: { size: WidgetSize }) {
  const router = useRouter()
  const [domain, setDomain] = useState('')
  const [wcagLevel, setWcagLevel] = useState<'wcag21aa' | 'wcag22aa'>('wcag21aa')
  const [intent, setIntent] = useState<'ada' | 'seo'>('ada')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    const value = domain.trim()
    if (!value || busy) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/site-audit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain: value, wcagLevel, clientId: null, seoOnly: intent === 'seo' }),
      })
      const data = await res.json().catch(() => ({}))
      // 202 → queued (no seoOnly in body — route by local intent); 409 → existing
      // in-flight audit (seoOnly present as a fallback in case intent drifted).
      if ((res.status === 202 || res.status === 409) && data.id) {
        const seo = intent === 'seo' || data.seoOnly === true
        router.push(seo ? `/seo-parser?scan=${data.id}` : `/ada-audit/site/${data.id}`)
        return
      }
      setError(data.error || 'Could not start the audit.')
    } catch {
      setError('Could not start the audit.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="flex h-full flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void start() }}>
      <input
        value={domain}
        onChange={(e) => setDomain(e.target.value)}
        placeholder="example.com"
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-[14px] text-navy dark:border-navy-border dark:bg-navy-deep dark:text-white"
      />
      <div role="group" aria-label="Scan type" className="flex gap-1 text-[12px]">
        {(['ada', 'seo'] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={intent === v}
            onClick={() => setIntent(v)}
            className={`flex-1 rounded-lg border px-2 py-1 font-semibold transition-colors ${
              intent === v
                ? 'border-orange bg-orange/5 text-orange'
                : 'border-gray-300 text-navy dark:border-navy-border dark:text-white'
            }`}
          >
            {v === 'ada' ? 'Accessibility' : 'SEO'}
          </button>
        ))}
      </div>
      {size !== 'sm' && intent === 'ada' && (
        <select
          value={wcagLevel}
          onChange={(e) => setWcagLevel(e.target.value as 'wcag21aa' | 'wcag22aa')}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13px] text-navy dark:border-navy-border dark:bg-navy-deep dark:text-white"
        >
          <option value="wcag21aa">WCAG 2.1 AA (Required)</option>
          <option value="wcag22aa">WCAG 2.2 AA (Aspirational)</option>
        </select>
      )}
      {error && <p className="text-[12px] font-body text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={busy || !domain.trim()}
        className="mt-auto rounded-lg bg-orange px-4 py-2 text-[14px] font-display font-bold text-navy hover:bg-orange-light disabled:opacity-50"
      >
        {busy ? 'Starting…' : 'Start audit'}
      </button>
    </form>
  )
}
