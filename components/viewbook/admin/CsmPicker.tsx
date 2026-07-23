'use client'

// CSM assignment picker — moved out of GlobalContentEditor.tsx (F1b Task 9,
// Codex fix #9) into its own module so the global-content editor can be
// deleted without orphaning this control (still used by ViewbookEditor).
import { useEffect, useState } from 'react'
import { jsonFetch } from './viewbook-admin-shared'
import { editorInputClass, editorLabelClass } from '@/components/viewbook/editor'
import type { TeamMember } from '@/lib/viewbook/global-content-keys'

export function CsmPicker({
  viewbookId,
  csmName,
  onChanged,
}: {
  viewbookId: number
  csmName: string | null
  onChanged: () => void
}) {
  const [roster, setRoster] = useState<TeamMember[]>([])
  const [selected, setSelected] = useState(csmName ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => setSelected(csmName ?? ''), [csmName])
  useEffect(() => {
    let active = true
    void jsonFetch<{ content: unknown }>('/api/viewbook-content/team')
      .then(({ content }) => { if (active) setRoster(Array.isArray(content) ? content as TeamMember[] : []) })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'load_failed') })
    return () => { active = false }
  }, [])

  const choices = roster.filter((member) => member.isCsm === true)
  const isDangling = selected !== '' && !choices.some((member) => member.name === selected)

  async function assign(value: string) {
    const previous = selected
    setSelected(value)
    setBusy(true)
    setError(null)
    try {
      await jsonFetch(`/api/viewbooks/${viewbookId}/csm`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csmName: value || null }),
      })
      onChanged()
    } catch (caught) {
      setSelected(previous)
      setError(caught instanceof Error ? caught.message : 'save_failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-1">
      <label htmlFor={`viewbook-csm-${viewbookId}`} className={editorLabelClass}>Assigned CSM</label>
      <select id={`viewbook-csm-${viewbookId}`} aria-label="Assigned CSM" value={selected} disabled={busy} onChange={(event) => void assign(event.target.value)} className={editorInputClass}>
        <option value="">Unassigned</option>
        {isDangling && <option value={selected}>{`${selected} — no longer a CSM`}</option>}
        {choices.map((member) => <option key={member.name} value={member.name}>{member.name}</option>)}
      </select>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
