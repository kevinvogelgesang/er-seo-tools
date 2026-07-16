'use client'

import { useState } from 'react'

export interface AdminFeedbackThread {
  reviewLinkId: number
  label: string
  feedback: Array<{
    id: number
    body: string
    authorName: string | null
    authorKind: string
    createdAt: string | Date
    resolvedAt: string | Date | null
    resolvedBy: string | null
  }>
}

export function FeedbackTab({ viewbookId, threads }: { viewbookId: number; threads: AdminFeedbackThread[] }) {
  const [rows, setRows] = useState(threads)
  const [busyId, setBusyId] = useState<number | null>(null)

  async function resolve(feedbackId: number) {
    setBusyId(feedbackId)
    try {
      const response = await fetch(`/api/viewbooks/${viewbookId}/feedback/${feedbackId}/resolve`, { method: 'POST' })
      if (!response.ok) throw new Error('resolve failed')
      const { feedback } = await response.json()
      setRows((current) => current.map((thread) => ({
        ...thread,
        feedback: thread.feedback.map((item) => item.id === feedbackId
          ? { ...item, resolvedAt: feedback.resolvedAt, resolvedBy: feedback.resolvedBy }
          : item),
      })))
    } finally {
      setBusyId(null)
    }
  }

  return <div className="space-y-5">
    {rows.length === 0 && <p className="text-sm text-gray-600 dark:text-white/70">No review feedback yet.</p>}
    {rows.map((thread) => <section key={thread.reviewLinkId} className="rounded-xl border border-gray-200 bg-white p-4 dark:border-navy-border dark:bg-navy-card">
      <h3 className="font-semibold text-gray-900 dark:text-white">{thread.label}</h3>
      <div className="mt-3 space-y-3">
        {thread.feedback.map((item) => <article key={item.id} className="rounded-lg bg-gray-50 p-3 dark:bg-navy-light">
          <p className="whitespace-pre-wrap text-sm text-gray-800 dark:text-white/90">{item.body}</p>
          <div className="mt-2 flex items-center justify-between gap-3 text-xs text-gray-500 dark:text-white/60">
            <span>{item.authorName ? `${item.authorName} (as reported)` : item.authorKind}</span>
            {item.resolvedAt
              ? <span>Resolved by {item.resolvedBy ?? 'operator'}</span>
              : <button disabled={busyId === item.id} onClick={() => resolve(item.id)} className="font-semibold text-blue-700 dark:text-blue-300">Resolve</button>}
          </div>
        </article>)}
      </div>
    </section>)}
  </div>
}
