'use client'

import { useState } from 'react'
import { jsonFetch } from './viewbook-admin-shared'

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
  const [error, setError] = useState<string | null>(null)

  async function run(fn: () => Promise<unknown>) {
    setError(null)
    try {
      await fn()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save_failed')
    }
  }

  const nextOrder = Math.max(0, ...milestones.map((m) => m.sortOrder)) + 1

  return (
    <div className="space-y-4 text-sm">
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
            <span className="font-medium text-gray-900 dark:text-white">{m.title}</span>
            {m.blurb && <span className="text-gray-500 dark:text-white/50">{m.blurb}</span>}
            <span className="ml-auto flex gap-2">
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
