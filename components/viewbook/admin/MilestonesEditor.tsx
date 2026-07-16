'use client'

import { useEffect, useState } from 'react'
import { jsonFetch } from './viewbook-admin-shared'
import { registerEditorActivity, useFocusWithin } from '@/components/viewbook/public/useViewbookSync'

interface MilestoneRow {
  id: number
  title: string
  blurb: string | null
  sortOrder: number
  status: string
  targetDate: string | null
}

export function MilestonesEditor({
  viewbookId,
  milestones,
  onChanged,
}: {
  viewbookId: number
  milestones: MilestoneRow[]
  onChanged: () => void
}) {
  const [title, setTitle] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { focused, onFocus, onBlur } = useFocusWithin()

  // PR2 Task 6: active while a new-milestone title is drafted, an edit row
  // is open (its own EditFields registration also fires — belt and
  // suspenders), a save is in flight, or focus remains within this list.
  useEffect(() => {
    registerEditorActivity('admin-new-milestone', title.trim() !== '' || editingId !== null || busy || focused)
    return () => registerEditorActivity('admin-new-milestone', false)
  }, [title, editingId, busy, focused])

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save_failed')
    } finally {
      setBusy(false)
    }
  }

  const nextOrder = Math.max(0, ...milestones.map((m) => m.sortOrder)) + 1

  return (
    <div className="space-y-4 text-sm" onFocus={onFocus} onBlur={onBlur}>
      {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
      <ol className="space-y-2">
        {milestones.map((m) => (
          <li
            key={m.id}
            className="flex flex-wrap items-center gap-2 rounded border border-gray-200 p-2 dark:border-navy-border"
          >
            <span
              className={
                m.status === 'current'
                  ? 'rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-800 dark:bg-teal-500/20 dark:text-teal-300'
                  : m.status === 'done'
                    ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-500/20 dark:text-green-300'
                    : 'rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-white/10 dark:text-white/60'
              }
            >
              {m.status}
            </span>
            {editingId === m.id ? (
              <EditFields
                milestone={m}
                onCancel={() => setEditingId(null)}
                onSave={(patch) =>
                  void run(async () => {
                    await jsonFetch(`/api/viewbooks/${viewbookId}/milestones/${m.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(patch),
                    })
                    setEditingId(null)
                  })
                }
              />
            ) : (
              <>
                <span className="font-medium text-gray-900 dark:text-white">{m.title}</span>
                {m.blurb && <span className="text-gray-500 dark:text-white/50">{m.blurb}</span>}
                {m.targetDate && (
                  <span className="text-xs text-gray-400 dark:text-white/40">
                    due {new Date(m.targetDate).toLocaleDateString()}
                  </span>
                )}
              </>
            )}
            <span className="ml-auto flex gap-2">
              {editingId !== m.id && (
                <button onClick={() => setEditingId(m.id)} className="text-xs text-gray-600 underline dark:text-white/60">
                  Edit
                </button>
              )}
              {m.status !== 'current' && (
                <button
                  onClick={() =>
                    void run(() =>
                      jsonFetch(`/api/viewbooks/${viewbookId}/milestones/${m.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: 'current' }),
                      }),
                    )
                  }
                  className="text-xs text-teal-700 underline dark:text-teal-400"
                >
                  Make current
                </button>
              )}
              {m.status !== 'done' && (
                <button
                  onClick={() =>
                    void run(() =>
                      jsonFetch(`/api/viewbooks/${viewbookId}/milestones/${m.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: 'done' }),
                      }),
                    )
                  }
                  className="text-xs text-green-700 underline dark:text-green-400"
                >
                  Mark done
                </button>
              )}
              <button
                onClick={() =>
                  void run(() =>
                    jsonFetch(`/api/viewbooks/${viewbookId}/milestones/${m.id}`, { method: 'DELETE' }),
                  )
                }
                className="text-xs text-red-600 underline dark:text-red-400"
              >
                Delete
              </button>
            </span>
          </li>
        ))}
      </ol>
      <div className="flex gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New milestone title"
          className="rounded border border-gray-300 bg-white px-2 py-1 dark:border-navy-border dark:bg-navy-card dark:text-white"
        />
        <button
          onClick={() =>
            void run(async () => {
              await jsonFetch(`/api/viewbooks/${viewbookId}/milestones`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, sortOrder: nextOrder }),
              })
              setTitle('')
            })
          }
          disabled={!title}
          className="rounded bg-teal-600 px-3 py-1 text-white hover:bg-teal-700 disabled:opacity-50"
        >
          Add milestone
        </button>
      </div>
    </div>
  )
}

function EditFields({
  milestone,
  onSave,
  onCancel,
}: {
  milestone: MilestoneRow
  onSave: (patch: { title: string; blurb: string | null; sortOrder: number; targetDate: string | null }) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(milestone.title)
  const [blurb, setBlurb] = useState(milestone.blurb ?? '')
  const [sortOrder, setSortOrder] = useState(String(milestone.sortOrder))
  const [targetDate, setTargetDate] = useState(milestone.targetDate ? milestone.targetDate.slice(0, 10) : '')
  const { focused, onFocus, onBlur } = useFocusWithin()

  // PR2 Task 6: active while this edit row's drafts differ from the loaded
  // milestone, or focus remains within the row (it's already open — any
  // input differing counts, per the "err on active" fallback).
  useEffect(() => {
    const dirty =
      title !== milestone.title ||
      blurb !== (milestone.blurb ?? '') ||
      sortOrder !== String(milestone.sortOrder) ||
      targetDate !== (milestone.targetDate ? milestone.targetDate.slice(0, 10) : '')
    const registryId = `admin-milestone-edit-${milestone.id}`
    registerEditorActivity(registryId, dirty || focused)
    return () => registerEditorActivity(registryId, false)
  }, [title, blurb, sortOrder, targetDate, milestone, focused])

  return (
    <span className="flex flex-wrap items-center gap-1" onFocus={onFocus} onBlur={onBlur}>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Title"
        className="w-36 rounded border border-gray-300 bg-white px-1.5 py-0.5 dark:border-navy-border dark:bg-navy-card dark:text-white"
      />
      <input
        value={blurb}
        onChange={(e) => setBlurb(e.target.value)}
        placeholder="Blurb"
        aria-label="Blurb"
        className="w-52 rounded border border-gray-300 bg-white px-1.5 py-0.5 dark:border-navy-border dark:bg-navy-card dark:text-white"
      />
      <input
        value={sortOrder}
        onChange={(e) => setSortOrder(e.target.value)}
        aria-label="Order"
        className="w-12 rounded border border-gray-300 bg-white px-1.5 py-0.5 dark:border-navy-border dark:bg-navy-card dark:text-white"
      />
      <input
        type="date"
        value={targetDate}
        onChange={(e) => setTargetDate(e.target.value)}
        aria-label="Target date"
        className="rounded border border-gray-300 bg-white px-1.5 py-0.5 dark:border-navy-border dark:bg-navy-card dark:text-white"
      />
      <button
        onClick={() =>
          onSave({
            title,
            blurb: blurb || null,
            sortOrder: parseInt(sortOrder, 10) || milestone.sortOrder,
            targetDate: targetDate || null,
          })
        }
        disabled={!title}
        className="rounded bg-teal-600 px-2 py-0.5 text-xs text-white hover:bg-teal-700 disabled:opacity-50"
      >
        Save
      </button>
      <button onClick={onCancel} className="text-xs text-gray-500 underline dark:text-white/50">
        Cancel
      </button>
    </span>
  )
}
