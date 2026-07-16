'use client'

import { useEffect, useState } from 'react'

interface ActivityItem {
  id: number
  kind: string
  actor: string
  summary: string
  createdAt: string | Date
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

  return <div className="space-y-3">
    {items.map((item) => <article key={item.id} className="rounded-lg border border-gray-200 bg-white p-3 dark:border-navy-border dark:bg-navy-card">
      <p className="text-sm text-gray-900 dark:text-white">{item.summary}</p>
      <p className="mt-1 text-xs text-gray-500 dark:text-white/60">{item.actor}</p>
    </article>)}
    {!loading && items.length === 0 && <p className="text-sm text-gray-600 dark:text-white/70">No activity yet.</p>}
    {cursor && <button disabled={loading} onClick={() => load(cursor)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-navy-border dark:text-white">Load more</button>}
    {loading && <p className="text-sm text-gray-500 dark:text-white/60">Loading…</p>}
  </div>
}
