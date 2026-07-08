// components/widgets/QuickSiteAuditWidget.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { WidgetSize } from '@/lib/widgets/types'

export function QuickSiteAuditWidget({ size }: { size: WidgetSize }) {
  const router = useRouter()
  const [domain, setDomain] = useState('')
  const [wcagLevel, setWcagLevel] = useState<'wcag21aa' | 'wcag22aa'>('wcag21aa')
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
        body: JSON.stringify({ domain: value, wcagLevel, clientId: null }),
      })
      const data = await res.json().catch(() => ({}))
      // 202 → queued; 409 → existing in-flight audit (still land in the flow).
      if ((res.status === 202 || res.status === 409) && data.id) {
        router.push(data.seoOnly ? '/seo-parser' : `/ada-audit/site/${data.id}`)
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
      {size !== 'sm' && (
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
