'use client'
import { useEffect, useState } from 'react'
import { DEFAULT_ADA_V4_WEIGHTS, type AdaV4Weights } from '@/lib/scoring/ada-v4'
import { ADA_WEIGHT_LABELS } from '@/lib/scoring/ada-weights'

const KEYS: readonly (keyof AdaV4Weights)[] = ['critical', 'serious', 'moderate', 'minor', 'needsReview', 'advisoryDiscount']

export function AdaScoringWeightsCard() {
  const [weights, setWeights] = useState<AdaV4Weights | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => { fetch('/api/settings/ada-scoring-weights').then(r => r.json()).then(d => setWeights(d.weights)).catch(() => {}) }, [])
  if (!weights) return null
  async function save() {
    setError(null); setSaved(false)
    const res = await fetch('/api/settings/ada-scoring-weights', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(weights) })
    if (res.ok) setSaved(true); else setError((await res.json()).error ?? 'Save failed.')
  }
  return (
    <section className="mt-6 bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-6">
      <h2 className="text-[15px] font-heading font-semibold text-navy dark:text-white mb-1">ADA scoring weights</h2>
      <p className="text-[12px] font-body text-gray-500 dark:text-white/50 mb-4">Caps are absolute deductions per severity category (they must sum to at most 100); the advisory discount (0–1) reduces best-practice-only rules. Weights apply to future scans only; existing audits keep their scored breakdown.</p>
      <div className="grid grid-cols-2 gap-4">
        {KEYS.map((k) => (
          <label key={k} className="text-[13px] font-body text-navy dark:text-white">{ADA_WEIGHT_LABELS[k]}
            <input type="number" min={0} max={k === 'advisoryDiscount' ? 1 : 100} step={k === 'advisoryDiscount' ? 0.05 : 1} value={weights[k]} onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg border border-gray-300 dark:border-navy-border bg-white dark:bg-navy-deep px-3 py-2 text-navy dark:text-white" />
          </label>
        ))}
      </div>
      {error && <p className="mt-3 text-[13px] text-red-600 dark:text-red-400">{error}</p>}
      {saved && <p className="mt-3 text-[13px] text-green-700 dark:text-green-400">Saved.</p>}
      <div className="mt-4 flex gap-3">
        <button onClick={save} className="rounded-lg bg-navy text-white dark:bg-white dark:text-navy px-4 py-2 text-[13px] font-heading font-semibold">Save</button>
        <button onClick={() => { setWeights(DEFAULT_ADA_V4_WEIGHTS); setSaved(false); setError(null) }} className="rounded-lg border border-gray-300 dark:border-navy-border px-4 py-2 text-[13px] font-body text-navy dark:text-white">Reset to defaults</button>
      </div>
    </section>
  )
}
