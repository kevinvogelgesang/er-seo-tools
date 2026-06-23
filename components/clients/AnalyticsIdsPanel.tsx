'use client'

// C10: Per-client Analytics ID mapping. Dropdowns from GA4 + GSC picker APIs,
// PLUS a manual free-text fallback for BOTH fields (HARD requirement — GA4
// Admin listing can be incomplete; operator must always be able to type ids).
// Save via PATCH /api/clients/[id]/analytics.
//
// CRITICAL: propertyId from /api/google/properties is a NUMBER. The PATCH
// endpoint expects a STRING. Send String(propertyId) (bare numeric id, e.g.
// "123456") — NOT "properties/123456".
// gscSiteUrl is sent VERBATIM (sc-domain: prefix preserved).

import { useState, useEffect, useCallback } from 'react'

interface Ga4Property { propertyId: number; displayName: string }
interface GscSite { siteUrl: string }
interface AnalyticsData {
  ga4PropertyId: string | null
  gscSiteUrl: string | null
  crmClientRef: string | null
}

interface Props {
  clientId: number
}

const inputCls =
  'w-full border border-gray-300 dark:border-navy-border rounded px-2 py-1.5 bg-white dark:bg-navy-deep text-gray-800 dark:text-white/90 text-xs'

const labelCls = 'block text-xs text-gray-500 dark:text-white/50 mb-1'

export function AnalyticsIdsPanel({ clientId }: Props) {
  const [current, setCurrent] = useState<AnalyticsData | null>(null)
  const [ga4Props, setGa4Props] = useState<Ga4Property[]>([])
  const [gscSites, setGscSites] = useState<GscSite[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  // Form state
  const [ga4Mode, setGa4Mode] = useState<'pick' | 'manual'>('pick')
  const [gscMode, setGscMode] = useState<'pick' | 'manual'>('pick')
  const [ga4Pick, setGa4Pick] = useState<string>('')       // String(propertyId) from dropdown
  const [ga4Manual, setGa4Manual] = useState<string>('')   // free text
  const [gscPick, setGscPick] = useState<string>('')       // verbatim siteUrl from dropdown
  const [gscManual, setGscManual] = useState<string>('')   // free text
  const [crmRef, setCrmRef] = useState<string>('')

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const loadAll = useCallback(async () => {
    setLoadError(null)
    try {
      const [analyticsRes, propsRes, sitesRes] = await Promise.all([
        fetch(`/api/clients/${clientId}/analytics`),
        fetch('/api/google/properties'),
        fetch('/api/google/gsc-sites'),
      ])

      if (!analyticsRes.ok) throw new Error('Failed to load analytics mapping')
      const analytics = await analyticsRes.json() as AnalyticsData
      setCurrent(analytics)
      setCrmRef(analytics.crmClientRef ?? '')

      // Populate GA4 props list (503 = key not configured — show empty)
      if (propsRes.ok) {
        const props = await propsRes.json() as Ga4Property[]
        setGa4Props(props)
        // Pre-select current value if it's in the list
        if (analytics.ga4PropertyId) {
          const found = props.find((p) => String(p.propertyId) === analytics.ga4PropertyId)
          if (found) {
            setGa4Pick(String(found.propertyId))
          } else {
            // Current id not in list → fall back to manual
            setGa4Mode('manual')
            setGa4Manual(analytics.ga4PropertyId)
          }
        }
      }

      // Populate GSC sites list
      if (sitesRes.ok) {
        const sites = await sitesRes.json() as GscSite[]
        setGscSites(sites)
        if (analytics.gscSiteUrl) {
          const found = sites.find((s) => s.siteUrl === analytics.gscSiteUrl)
          if (found) {
            setGscPick(found.siteUrl)
          } else {
            setGscMode('manual')
            setGscManual(analytics.gscSiteUrl)
          }
        }
      }
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load')
    }
  }, [clientId])

  useEffect(() => { void loadAll() }, [loadAll])

  async function save() {
    setSaving(true)
    setSaveError(null)
    setSaved(false)

    // Resolve final values
    const ga4PropertyId: string | null = ga4Mode === 'pick'
      ? (ga4Pick ? ga4Pick : null)
      : (ga4Manual.trim() || null)

    const gscSiteUrl: string | null = gscMode === 'pick'
      ? (gscPick || null)
      : (gscManual.trim() || null)

    const crmClientRef: string | null = crmRef.trim() || null

    try {
      const res = await fetch(`/api/clients/${clientId}/analytics`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ga4PropertyId, gscSiteUrl, crmClientRef }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        setSaveError(body.error ?? `Save failed (${res.status})`)
        return
      }
      const updated = await res.json() as AnalyticsData
      setCurrent(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      setSaveError('Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white dark:bg-navy-card rounded-xl border border-gray-200 dark:border-navy-border p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-white/80">Analytics IDs</h2>
        {current && (
          <span className="text-xs text-gray-400 dark:text-white/30">
            {[current.ga4PropertyId ? 'GA4' : null, current.gscSiteUrl ? 'GSC' : null]
              .filter(Boolean)
              .join(' + ') || 'Not mapped'}
          </span>
        )}
      </div>

      {loadError && <p className="text-xs text-red-600 dark:text-red-400 mb-3">{loadError}</p>}

      <div className="space-y-4">
        {/* GA4 Property */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-gray-500 dark:text-white/50">GA4 Property</label>
            <button
              type="button"
              onClick={() => setGa4Mode((m) => (m === 'pick' ? 'manual' : 'pick'))}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              {ga4Mode === 'pick' ? 'Enter manually' : 'Pick from list'}
            </button>
          </div>
          {ga4Mode === 'pick' ? (
            <select value={ga4Pick} onChange={(e) => setGa4Pick(e.target.value)} className={inputCls}>
              <option value="">— not mapped —</option>
              {ga4Props.map((p) => (
                <option key={p.propertyId} value={String(p.propertyId)}>
                  {p.displayName} ({p.propertyId})
                </option>
              ))}
            </select>
          ) : (
            <div>
              <input
                type="text"
                value={ga4Manual}
                onChange={(e) => setGa4Manual(e.target.value)}
                placeholder="e.g. 123456789"
                className={inputCls}
              />
              <p className="mt-0.5 text-xs text-gray-400 dark:text-white/30">
                Enter the numeric property id (without &ldquo;properties/&rdquo; prefix)
              </p>
            </div>
          )}
        </div>

        {/* GSC Site */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-gray-500 dark:text-white/50">Search Console Site</label>
            <button
              type="button"
              onClick={() => setGscMode((m) => (m === 'pick' ? 'manual' : 'pick'))}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              {gscMode === 'pick' ? 'Enter manually' : 'Pick from list'}
            </button>
          </div>
          {gscMode === 'pick' ? (
            <select value={gscPick} onChange={(e) => setGscPick(e.target.value)} className={inputCls}>
              <option value="">— not mapped —</option>
              {gscSites.map((s) => (
                <option key={s.siteUrl} value={s.siteUrl}>
                  {s.siteUrl}
                </option>
              ))}
            </select>
          ) : (
            <div>
              <input
                type="text"
                value={gscManual}
                onChange={(e) => setGscManual(e.target.value)}
                placeholder="e.g. sc-domain:example.com"
                className={inputCls}
              />
              <p className="mt-0.5 text-xs text-gray-400 dark:text-white/30">
                Enter verbatim (sc-domain: prefix is preserved as-is)
              </p>
            </div>
          )}
        </div>

        {/* CRM ref */}
        <div>
          <label className={labelCls}>CRM Client Reference (optional)</label>
          <input
            type="text"
            value={crmRef}
            onChange={(e) => setCrmRef(e.target.value)}
            placeholder="e.g. client-abc-123"
            className={inputCls}
          />
        </div>
      </div>

      {saveError && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{saveError}</p>}

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={() => void save()}
          disabled={saving}
          className="px-4 py-1.5 rounded bg-blue-600 text-white text-xs font-semibold disabled:opacity-50 hover:bg-blue-700 transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="text-xs text-green-600 dark:text-green-400 font-semibold">Saved</span>}
      </div>
    </div>
  )
}
