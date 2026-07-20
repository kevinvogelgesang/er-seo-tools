'use client'

// PR4 Task 4: dedicated presentation-config card — deliberately NOT inline in
// ViewbookEditor (Codex FIX-10: `run` lives in ONE component here and `load`
// in the parent, so an inline sketch can't compile in either). Mirrors
// ThemeEditor's self-contained pattern: owns its own save state, calls
// onSaved after a successful PATCH; the parent's load() is passed in AS
// onSaved.

import { useState } from 'react'
import { jsonFetch, REVEAL_PACE_PRESETS } from './viewbook-admin-shared'
import {
  COLLAPSE_AFFORDANCES,
  COLLAPSE_MORPHS,
  type CollapseAffordanceKind,
  type CollapseMorphKind,
} from '@/lib/viewbook/presentation-config'

// Operator-facing labels for the collapse↔hero morph treatments (the value
// strings are the stored enum; see presentation-config.ts for what each does).
const MORPH_LABELS: Record<CollapseMorphKind, string> = {
  spread: 'Spread — one smooth morph (default)',
  bloom: 'Bloom — grows tall, then spreads wide',
  clip: 'Clip — a window opens over the full hero',
  pop: 'Pop — snappy spring with overshoot',
}
import { editorInputClass, editorLabelClass } from '@/components/viewbook/editor'

export function PresentationEditor({
  viewbookId,
  config,
  onSaved,
}: {
  viewbookId: number
  config: {
    collapseAffordance: CollapseAffordanceKind
    collapseMorph: CollapseMorphKind
    heroOverlayStrength: number
    revealDurationScale: number
    firstLoadDelayMs: number
  }
  onSaved: () => void
}) {
  // Controlled sliders seeded from the config prop — the affordance <select>
  // stays uncontrolled (defaultValue) since it commits immediately on
  // change, same as ThemeEditor's font <select>s.
  const [overlay, setOverlay] = useState(config.heroOverlayStrength)
  // Task 5 (Codex fix 7): local state on drag, PATCH only on blur/Enter/
  // preset-click — never on every drag/change event.
  const [pace, setPace] = useState(config.revealDurationScale)
  const [delayMs, setDelayMs] = useState(config.firstLoadDelayMs)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(patch: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      await jsonFetch(`/api/viewbooks/${viewbookId}`, { method: 'PATCH', body: JSON.stringify(patch) })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save_failed')
    } finally {
      setBusy(false)
    }
  }

  function commitOverlay() {
    // Send an INTEGER (Math.round already applied on every change below) —
    // matches the server's Number.isInteger gate.
    void save({ heroOverlayStrength: overlay })
  }

  function selectPacePreset(v: number) {
    // Preset buttons commit immediately (not gated behind blur/Enter).
    setPace(v)
    void save({ revealDurationScale: v })
  }

  function commitPace() {
    void save({ revealDurationScale: pace })
  }

  function commitDelay() {
    void save({ firstLoadDelayMs: delayMs })
  }

  return (
    <div className="min-w-0 max-w-full rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-navy-border dark:bg-navy-card">
      <h2 className="font-display text-base font-bold text-navy dark:text-white">Section collapse</h2>
      <p className="mt-1 text-xs text-gray-500 dark:text-white/55">
        Controls how a collapsed section's expand affordance appears and how strong the hero overlay reads over photos.
      </p>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}

      <label className={`mt-4 block min-w-0 ${editorLabelClass}`}>
        Collapse affordance
        <select
          disabled={busy}
          defaultValue={config.collapseAffordance}
          onChange={(e) => void save({ collapseAffordance: e.target.value })}
          className={`mt-1 ${editorInputClass}`}
        >
          {COLLAPSE_AFFORDANCES.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>

      <label className={`mt-4 block min-w-0 ${editorLabelClass}`}>
        Expand animation
        <select
          disabled={busy}
          defaultValue={config.collapseMorph}
          onChange={(e) => void save({ collapseMorph: e.target.value })}
          className={`mt-1 ${editorInputClass}`}
        >
          {COLLAPSE_MORPHS.map((m) => (
            <option key={m} value={m}>
              {MORPH_LABELS[m]}
            </option>
          ))}
        </select>
      </label>

      <label className={`mt-4 block min-w-0 ${editorLabelClass}`}>
        Hero overlay strength: {overlay}
        <input
          type="range"
          min={0}
          max={100}
          value={overlay}
          disabled={busy}
          onChange={(e) => setOverlay(Math.round(Number(e.target.value)))}
          onBlur={commitOverlay}
          onKeyUp={(e) => {
            if (e.key === 'Enter') commitOverlay()
          }}
          className="mt-2 block w-full"
        />
      </label>

      <div className="mt-4">
        <span className={editorLabelClass}>Reveal pace</span>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {REVEAL_PACE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              disabled={busy}
              onClick={() => selectPacePreset(preset.v)}
              className="rounded-full border border-gray-300 px-2.5 py-1 text-xs font-medium text-navy hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-navy-border dark:text-white dark:hover:bg-navy-light"
            >
              {preset.label}
            </button>
          ))}
        </div>
        <label className={`mt-2 block min-w-0 ${editorLabelClass}`}>
          Reveal pace: {pace}x
          <input
            type="range"
            min={0.4}
            max={1.6}
            step={0.05}
            value={pace}
            disabled={busy}
            onChange={(e) => setPace(Number(e.target.value))}
            onBlur={commitPace}
            onKeyUp={(e) => {
              if (e.key === 'Enter') commitPace()
            }}
            className="mt-2 block w-full"
          />
          <div className="mt-1 flex justify-between text-[10px] text-gray-400 dark:text-white/40">
            <span>Faster</span>
            <span>Slower</span>
          </div>
        </label>
      </div>

      <label className={`mt-4 block min-w-0 ${editorLabelClass}`}>
        First-load delay (welcome): {(delayMs / 1000).toFixed(2)}s
        <input
          type="range"
          min={0}
          max={6000}
          step={250}
          value={delayMs}
          disabled={busy}
          onChange={(e) => setDelayMs(Number(e.target.value))}
          onBlur={commitDelay}
          onKeyUp={(e) => {
            if (e.key === 'Enter') commitDelay()
          }}
          className="mt-2 block w-full"
        />
      </label>
    </div>
  )
}
