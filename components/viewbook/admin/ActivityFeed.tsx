'use client'

import { useEffect, useState } from 'react'
import { StatusPill, type Tone } from '@/components/ui/StatusPill'
import { editorSecondaryBtnClass } from '@/components/viewbook/editor'

interface ActivityItem {
  id: number
  kind: string
  actor: string
  summary: string
  createdAt: string | Date
}

function activityLabel(kind: string): string {
  return kind.split(/[-_]/).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ')
}

function activityTone(kind: string): Tone {
  if (kind.includes('feedback')) return 'warning'
  if (kind.includes('complete') || kind.includes('resolve')) return 'success'
  if (kind.includes('revoke') || kind.includes('delete')) return 'error'
  return 'neutral'
}

function formatDate(value: string | Date): string {
  return new Date(value).toLocaleString()
}

export function ActivityFeed({ viewbookId }: { viewbookId: number }) {
  const [items, setItems] = useState<ActivityItem[]>([])
  const [cursor, setCursor] = useState<number | null | undefined>(undefined)
  const [loading, setLoading] = useState(false)

  async function load(next?: number | null) {
    setLoading(true)
    try {
      const query = next ? `?cursor=${next}` : ''
      const response = await fetch(`/api/viewbooks/${viewbookId}/activity${query}`)
      if (!response.ok) throw new Error('activity load failed')
      const page = await response.json()
      setItems((current) => next ? [...current, ...page.items] : page.items)
      setCursor(page.nextCursor)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [viewbookId]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="font-body">
      {items.length > 0 && (
        <ol data-activity-timeline className="relative space-y-0 border-l border-gray-200 pl-5 dark:border-navy-border">
          {items.map((item) => (
            <li key={item.id} className="relative pb-5 last:pb-0">
              <span aria-hidden="true" className="absolute -left-[1.56rem] top-1.5 h-3 w-3 rounded-full border-2 border-white bg-teal-500 ring-2 ring-gray-200 dark:border-navy-card dark:ring-navy-border" />
              <article className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm dark:border-navy-border dark:bg-navy-card">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill label={activityLabel(item.kind)} tone={activityTone(item.kind)} />
                  <time dateTime={new Date(item.createdAt).toISOString()} className="text-xs text-gray-500 dark:text-white/50">{formatDate(item.createdAt)}</time>
                </div>
                <p className="mt-2 text-sm font-medium text-navy dark:text-white">{item.summary}</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-white/55">Actor: <span className="font-medium text-gray-700 dark:text-white/70">{item.actor}</span></p>
              </article>
            </li>
          ))}
        </ol>
      )}
      {!loading && items.length === 0 && <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-navy-border dark:text-white/60">No activity yet.</div>}
      {cursor && <button type="button" disabled={loading} onClick={() => void load(cursor)} className={`mt-4 ${editorSecondaryBtnClass}`}>Load more</button>}
      {loading && <p aria-live="polite" className="mt-3 text-sm text-gray-500 dark:text-white/60">Loading…</p>}
    </div>
  )
}
