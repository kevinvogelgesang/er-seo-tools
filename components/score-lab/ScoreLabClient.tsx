'use client'
// C19 PR3 Score Lab. All recomputes happen IN THE BROWSER through the pure
// scorers — the API only ships compact input snapshots. Never hash weights
// client-side (weights-hash.ts is server-only); a what-if breakdown renders
// as "unhashed"/hash-free by design.
import { useEffect, useMemo, useState } from 'react'
import { computeAdaScoreV4, DEFAULT_ADA_V4_WEIGHTS, type AdaV4Inputs, type AdaV4Weights } from '@/lib/scoring/ada-v4'
import { ADA_WEIGHT_LABELS, validateAdaWeights } from '@/lib/scoring/ada-weights'
import { DEFAULT_WEIGHTS, WEIGHT_LABELS, PERSISTABLE_WEIGHT_KEYS, serializeBreakdown, type ScoringWeights } from '@/lib/scoring/weights'
import type { SeoInputsSnapshot } from '@/lib/scoring/seo-core'
import { recomputeSeoScore } from '@/lib/scoring/seo-recompute'
import { AdaScoreExplanation } from '@/components/scoring/AdaScoreExplanation'
import { ScoreExplanation } from '@/components/scoring/ScoreExplanation'

interface RunListItem { id: string; domain: string | null; tool: string; source: string; score: number | null; createdAt: string }
interface CurrentMeta { score: number | null; version: number; weightsHash: string | null; domain: string | null; tool: string; source: string }
type LabPayload =
  | { kind: 'ada'; inputs: AdaV4Inputs; current: CurrentMeta }
  | { kind: 'seo'; scorer: 'health' | 'live-seo'; snapshot: SeoInputsSnapshot; current: CurrentMeta }
  | { kind: 'unavailable'; reason: string; current: CurrentMeta }

const ADA_KEYS: readonly (keyof AdaV4Weights)[] = ['critical', 'serious', 'moderate', 'minor', 'needsReview', 'advisoryDiscount']

export function ScoreLabClient() {
  const [runs, setRuns] = useState<RunListItem[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [payload, setPayload] = useState<LabPayload | null>(null)
  const [adaWeights, setAdaWeights] = useState<AdaV4Weights>(DEFAULT_ADA_V4_WEIGHTS)
  const [seoWeights, setSeoWeights] = useState<ScoringWeights>(DEFAULT_WEIGHTS)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/scoring/lab-inputs?list=1').then(r => r.json()).then(d => setRuns(d.runs)).catch(() => setRuns([]))
    fetch('/api/settings/ada-scoring-weights').then(r => r.json()).then(d => { if (d.weights) setAdaWeights(d.weights) }).catch(() => {})
    fetch('/api/settings/scoring-weights').then(r => r.json()).then(d => { if (d.weights) setSeoWeights(d.weights) }).catch(() => {})
  }, [])

  async function selectRun(id: string) {
    setSelectedId(id); setPayload(null); setSaveMsg(null)
    try {
      const res = await fetch(`/api/scoring/lab-inputs?runId=${encodeURIComponent(id)}`)
      setPayload(await res.json())
    } catch { setPayload(null) }
  }

  const adaWhatIf = useMemo(() => {
    if (payload?.kind !== 'ada') return null
    try { return computeAdaScoreV4(payload.inputs, adaWeights) } catch { return null }
  }, [payload, adaWeights])

  // Codex #5: never offer a Save for a profile the settings endpoint would
  // reject — validate client-side with the same function the PUT route uses.
  const adaValidationError = useMemo(() => {
    const v = validateAdaWeights(adaWeights)
    return 'error' in v ? v.error : null
  }, [adaWeights])

  const seoWhatIf = useMemo(() => {
    if (payload?.kind !== 'seo') return null
    return recomputeSeoScore(payload.snapshot, seoWeights)
  }, [payload, seoWeights])

  async function save(url: string, body: unknown, label: string) {
    setSaveMsg(null)
    const res = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (res.ok) setSaveMsg(`${label} saved — future scans use these weights.`)
    else setSaveMsg((await res.json()).error ?? 'Save failed.')
  }

  return (
    <div className="grid gap-6 md:grid-cols-[280px_1fr]">
      <section className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-4">
        <h2 className="text-[13px] font-heading font-semibold text-navy dark:text-white mb-2">Recent runs</h2>
        {runs === null && <p className="text-[12px] font-body text-gray-500 dark:text-white/50">Loading…</p>}
        {runs?.length === 0 && <p className="text-[12px] font-body text-gray-500 dark:text-white/50">No completed runs yet.</p>}
        <ul className="space-y-1">
          {runs?.map((r) => (
            <li key={r.id}>
              <button onClick={() => selectRun(r.id)}
                className={`w-full text-left rounded-lg px-2 py-1.5 text-[12px] font-body ${selectedId === r.id ? 'bg-navy text-white dark:bg-white dark:text-navy' : 'text-navy dark:text-white hover:bg-gray-100 dark:hover:bg-navy-deep'}`}>
                <span className="block truncate font-semibold">{r.domain ?? '(no domain)'}</span>
                <span className="block opacity-70">{r.tool === 'ada-audit' ? 'ADA' : 'SEO'} · {r.source} · {r.score ?? '—'} · {r.createdAt.slice(0, 10)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-6">
        <p className="mb-4 rounded-lg bg-blue-50 dark:bg-blue-500/10 px-3 py-2 text-[12px] font-body text-blue-900 dark:text-blue-300">
          Historical scores keep the weights they were scored with — saving here only affects future scans, and trend deltas across a weights change are suppressed automatically.
        </p>
        {!payload && <p className="text-[13px] font-body text-gray-500 dark:text-white/50">Pick a run to start experimenting.</p>}

        {payload?.kind === 'unavailable' && (
          <p className="text-[13px] font-body text-navy/70 dark:text-white/70">
            {payload.reason} <span className="text-navy/45 dark:text-white/45">(current score: {payload.current.score ?? '—'})</span>
          </p>
        )}

        {payload?.kind === 'ada' && adaWhatIf && (
          <div>
            <ScorePair current={payload.current.score} whatIf={adaWhatIf.score} note={payload.current.version !== 4 ? 'stored score used an older formula — what-if recomputes under v4' : null} />
            <div className="mt-4 grid grid-cols-2 gap-4">
              {ADA_KEYS.map((k) => (
                <label key={k} className="text-[13px] font-body text-navy dark:text-white">{ADA_WEIGHT_LABELS[k]} — {adaWeights[k]}
                  <input type="range" min={0} max={k === 'advisoryDiscount' ? 1 : 100} step={k === 'advisoryDiscount' ? 0.05 : 1}
                    value={adaWeights[k]} onChange={(e) => setAdaWeights({ ...adaWeights, [k]: Number(e.target.value) })} className="mt-1 w-full" />
                </label>
              ))}
            </div>
            <p className="mt-3 text-[11px] font-body text-navy/50 dark:text-white/50">The breakdown below reflects the what-if sliders above, not the weights the run was scored with.</p>
            <AdaScoreExplanation breakdown={JSON.stringify(adaWhatIf.breakdown)} />
            {adaValidationError && <p className="mt-3 text-[13px] font-body text-amber-700 dark:text-amber-400">{adaValidationError}</p>}
            <div className="mt-4 flex items-center gap-3">
              <button onClick={() => save('/api/settings/ada-scoring-weights', adaWeights, 'ADA weights')} disabled={!!adaValidationError}
                className="rounded-lg bg-navy text-white dark:bg-white dark:text-navy px-4 py-2 text-[13px] font-heading font-semibold disabled:opacity-40 disabled:cursor-not-allowed">Save as ADA defaults</button>
              <button onClick={() => setAdaWeights(DEFAULT_ADA_V4_WEIGHTS)}
                className="rounded-lg border border-gray-300 dark:border-navy-border px-4 py-2 text-[13px] font-body text-navy dark:text-white">Reset</button>
            </div>
          </div>
        )}

        {payload?.kind === 'seo' && seoWhatIf && (
          <div>
            <ScorePair current={payload.current.score} whatIf={seoWhatIf.score} note={null} />
            <div className="mt-4 grid grid-cols-2 gap-4">
              {PERSISTABLE_WEIGHT_KEYS.map((k) => (
                <label key={k} className="text-[13px] font-body text-navy dark:text-white">{WEIGHT_LABELS[k]}
                  {/* Codex #5: number inputs, not a capped range — the settings API accepts any
                      non-negative value, and a saved value above an arbitrary slider max would
                      render misrepresented. Mirrors the settings card's input. */}
                  <input type="number" min={0} step={1}
                    value={seoWeights[k]} onChange={(e) => setSeoWeights({ ...seoWeights, [k]: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-gray-300 dark:border-navy-border bg-white dark:bg-navy-deep px-3 py-2 text-navy dark:text-white" />
                </label>
              ))}
            </div>
            <p className="mt-3 text-[11px] font-body text-navy/50 dark:text-white/50">The breakdown below reflects the what-if weights above, not the weights the run was scored with.</p>
            <ScoreExplanation breakdown={serializeBreakdown(payload.scorer, seoWhatIf)} />
            <div className="mt-4 flex items-center gap-3">
              <button onClick={() => save('/api/settings/scoring-weights', seoWeights, 'SEO weights')}
                className="rounded-lg bg-navy text-white dark:bg-white dark:text-navy px-4 py-2 text-[13px] font-heading font-semibold">Save as SEO defaults</button>
              <button onClick={() => setSeoWeights(DEFAULT_WEIGHTS)}
                className="rounded-lg border border-gray-300 dark:border-navy-border px-4 py-2 text-[13px] font-body text-navy dark:text-white">Reset</button>
            </div>
          </div>
        )}

        {saveMsg && <p className="mt-3 text-[13px] font-body text-navy dark:text-white">{saveMsg}</p>}
      </section>
    </div>
  )
}

function ScorePair({ current, whatIf, note }: { current: number | null; whatIf: number | null; note: string | null }) {
  return (
    <div>
      <div className="flex items-baseline gap-6">
        <div>
          <div className="text-[11px] font-body uppercase tracking-wide text-gray-500 dark:text-white/50">Current</div>
          <div className="text-3xl font-display font-extrabold text-navy dark:text-white">{current ?? '—'}</div>
        </div>
        <div>
          <div className="text-[11px] font-body uppercase tracking-wide text-gray-500 dark:text-white/50">What-if</div>
          <div className="text-3xl font-display font-extrabold text-orange-600 dark:text-orange-400">{whatIf ?? '—'}</div>
        </div>
      </div>
      {note && <p className="mt-1 text-[11px] font-body text-navy/50 dark:text-white/50">{note}</p>}
    </div>
  )
}
