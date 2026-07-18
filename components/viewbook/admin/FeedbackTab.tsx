'use client'

import { useEffect, useState } from 'react'
import { StatusPill } from '@/components/ui/StatusPill'
import { editorSecondaryBtnClass } from '@/components/viewbook/editor'

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

function formatDate(value: string | Date): string {
  return new Date(value).toLocaleString()
}

function feedbackAuthor(item: { authorName: string | null; authorKind: string }): string {
  return item.authorName ?? item.authorKind
}

function resolveLabel(item: { body: string; authorName: string | null; authorKind: string }): string {
  const snippet = item.body.replace(/\s+/g, ' ').trim().slice(0, 80)
  return `Resolve feedback from ${feedbackAuthor(item)}: ${snippet}`
}

export function FeedbackTab({ viewbookId, threads }: { viewbookId: number; threads: AdminFeedbackThread[] }) {
  const [rows, setRows] = useState(threads)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const threadsKey = threads.flatMap((thread) => thread.feedback.map((feedback) => `${feedback.id}:${feedback.resolvedAt ?? ''}`)).join('|')
  useEffect(() => {
    setRows(threads)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadsKey])

  async function resolve(feedbackId: number, body: string) {
    if (!confirm(`Resolve this feedback?\n\n“${body}”\n\nIt will move to Resolved feedback.`)) return
    setBusyId(feedbackId)
    setError(null)
    try {
      const response = await fetch(`/api/viewbooks/${viewbookId}/feedback/${feedbackId}/resolve`, { method: 'POST' })
      const responseBody = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(responseBody.error || 'resolve_failed')
      const { feedback } = responseBody
      setRows((current) => current.map((thread) => ({
        ...thread,
        feedback: thread.feedback.map((item) => item.id === feedbackId
          ? { ...item, resolvedAt: feedback.resolvedAt, resolvedBy: feedback.resolvedBy }
          : item),
      })))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'resolve_failed')
    } finally {
      setBusyId(null)
    }
  }

  const feedback = rows.flatMap((thread) => thread.feedback.map((item) => ({ ...item, threadLabel: thread.label })))
  const open = feedback.filter((item) => !item.resolvedAt)
  const resolved = feedback.filter((item) => item.resolvedAt)
  const busyFeedback = feedback.find((item) => item.id === busyId)

  function renderItem(item: (typeof feedback)[number]) {
    return (
      <article key={item.id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-navy-border dark:bg-navy-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill label={item.threadLabel} tone="neutral" />
              <span className="text-xs text-gray-500 dark:text-white/55">{formatDate(item.createdAt)}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-navy dark:text-white/90">{item.body}</p>
            <p className="mt-2 text-xs text-gray-500 dark:text-white/55">
              From {item.authorName ? `${item.authorName} (as reported)` : item.authorKind}
            </p>
          </div>
          {item.resolvedAt ? (
            <div className="text-right">
              <StatusPill label="Resolved" tone="success" />
              <p className="mt-1 text-xs text-gray-500 dark:text-white/55">Resolved by {item.resolvedBy ?? 'operator'}</p>
            </div>
          ) : (
            <button
              type="button"
              aria-label={resolveLabel(item)}
              disabled={busyId === item.id}
              onClick={() => void resolve(item.id, item.body)}
              className={editorSecondaryBtnClass}
            >
              {busyId === item.id ? 'Resolving…' : 'Resolve'}
            </button>
          )}
        </div>
      </article>
    )
  }

  return (
    <div className="space-y-6 font-body">
      <div role="status" aria-live="polite" className="sr-only">
        {busyFeedback ? `Resolving feedback from ${feedbackAuthor(busyFeedback)}…` : ''}
      </div>
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          Could not resolve feedback: {error}. Your feedback remains open; try again.
        </div>
      )}
      {feedback.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-navy-border dark:text-white/60">No review feedback yet.</div>
      ) : (
        <>
          <section aria-labelledby="open-feedback-heading">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 id="open-feedback-heading" className="font-display text-base font-bold text-navy dark:text-white">Open feedback</h2>
                <p className="mt-1 text-xs text-gray-500 dark:text-white/55">Items still requiring an operator decision.</p>
              </div>
              <StatusPill label={`${open.length} open`} tone={open.length > 0 ? 'warning' : 'neutral'} />
            </div>
            <div className="space-y-3">
              {open.length > 0 ? open.map(renderItem) : <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700 dark:bg-green-500/10 dark:text-green-300">All feedback has been resolved.</p>}
            </div>
          </section>
          <section aria-labelledby="resolved-feedback-heading">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 id="resolved-feedback-heading" className="font-display text-base font-bold text-navy dark:text-white">Resolved feedback</h2>
                <p className="mt-1 text-xs text-gray-500 dark:text-white/55">A read-only record of completed feedback.</p>
              </div>
              <StatusPill label={`${resolved.length} resolved`} tone={resolved.length > 0 ? 'success' : 'neutral'} />
            </div>
            <div className="space-y-3">
              {resolved.length > 0 ? resolved.map(renderItem) : <p className="text-sm text-gray-500 dark:text-white/55">No resolved feedback yet.</p>}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
