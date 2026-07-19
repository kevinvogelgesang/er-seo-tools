'use client'

// PR4 Task 4: dedicated presentation-config card — deliberately NOT inline in
// ViewbookEditor (Codex FIX-10: `run` lives in ONE component here and `load`
// in the parent, so an inline sketch can't compile in either). Mirrors
// ThemeEditor's self-contained pattern: owns its own save state, calls
// onSaved after a successful PATCH; the parent's load() is passed in AS
// onSaved.

import { useState } from 'react'
import { jsonFetch } from './viewbook-admin-shared'
import { COLLAPSE_AFFORDANCES, type CollapseAffordanceKind } from '@/lib/viewbook/presentation-config'
import { editorInputClass, editorLabelClass } from '@/components/viewbook/editor'

export function PresentationEditor({
  viewbookId,
  config,
  onSaved,
}: {
  viewbookId: number
  config: { collapseAffordance: CollapseAffordanceKind; heroOverlayStrength: number }
  onSaved: () => void
}) {
  // Controlled slider seeded from the config prop — the affordance <select>
  // stays uncontrolled (defaultValue) since it commits immediately on
  // change, same as ThemeEditor's font <select>s.
  const [overlay, setOverlay] = useState(config.heroOverlayStrength)
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

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-navy-border dark:bg-navy-card">
      <h2 className="font-display text-base font-bold text-navy dark:text-white">Section collapse</h2>
      <p className="mt-1 text-xs text-gray-500 dark:text-white/55">
        Controls how a collapsed section's expand affordance appears and how strong the hero overlay reads over photos.
      </p>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}

      <label className={`mt-4 block ${editorLabelClass}`}>
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

      <label className={`mt-4 block ${editorLabelClass}`}>
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
    </div>
  )
}
