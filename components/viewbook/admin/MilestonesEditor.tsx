'use client'

import { useState } from 'react'
import {
  ViewbookEditorStatus,
  editorDestructiveBtnClass,
  editorInputClass,
  editorLabelClass,
  editorPrimaryBtnClass,
  editorSecondaryBtnClass,
  editorTextareaClass,
} from '@/components/viewbook/editor'
import { StatusPill, type Tone } from '@/components/ui/StatusPill'
import { jsonFetch } from './viewbook-admin-shared'
import { useEditorActivity, useFocusWithin } from '@/components/viewbook/public/useViewbookSync'

interface ReviewLinkRow {
  id: number
  label: string
  url: string
  kind: string // 'mockup' | 'live'
}

interface MilestoneRow {
  id: number
  title: string
  blurb: string | null
  description: string | null
  sortOrder: number
  status: string
  targetDate: string | null
  // getViewbookAdmin has ALWAYS included reviewLinks on each milestone — this
  // editor just never declared (or rendered) them. 2026-07-19: review links
  // are now managed here, closing the loop with the public page's
  // "Review & feedback" region (which had no operator-side creation UI at
  // all — the POST/DELETE routes existed with zero frontend callers).
  reviewLinks: ReviewLinkRow[]
}

function milestoneStatus(status: string): { label: string; tone: Tone } {
  if (status === 'done') return { label: 'Done', tone: 'success' }
  if (status === 'current') return { label: 'Current', tone: 'running' }
  return { label: 'Upcoming', tone: 'neutral' }
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
  useEditorActivity('admin-new-milestone', title.trim() !== '' || editingId !== null || busy || focused)

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
    <div className="space-y-5 text-sm" onFocus={onFocus} onBlur={onBlur}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-navy dark:text-white">Milestones</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-white/55">Manage the ordered timeline shown in the client viewbook.</p>
        </div>
        <ViewbookEditorStatus state={error ? 'error' : busy ? 'saving' : 'idle'} message={error} />
      </div>

      {milestones.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center dark:border-navy-border dark:bg-navy-deep/40">
          <p className="font-display text-sm font-semibold text-navy dark:text-white">No milestones yet</p>
          <p className="mt-1 text-xs text-gray-500 dark:text-white/55">Add the first milestone below to begin the client timeline.</p>
        </div>
      ) : (
        <ol className="space-y-3">
          {milestones.map((m) => (
          <li
            key={m.id}
            className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-navy-border dark:bg-navy-card"
          >
            <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center">
              <span className="inline-flex w-fit shrink-0 items-center rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-600 dark:bg-white/10 dark:text-white/60">Order {m.sortOrder}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate font-display text-base font-bold text-navy dark:text-white">{m.title}</h3>
                  <StatusPill label={milestoneStatus(m.status).label} tone={milestoneStatus(m.status).tone} />
                  {m.targetDate && (
                    <span className="text-xs font-medium text-gray-500 dark:text-white/50">
                      Due {new Date(m.targetDate).toLocaleDateString()}
                    </span>
                  )}
                </div>
                {m.blurb && <p className="mt-1 text-sm text-gray-500 dark:text-white/55">{m.blurb}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                {editingId !== m.id && (
                  <button
                    type="button"
                    aria-label={`Edit ${m.title}`}
                    onClick={() => setEditingId(m.id)}
                    className={`${editorPrimaryBtnClass} !min-h-8 px-2.5 py-1 text-xs`}
                  >
                    Edit
                  </button>
                )}
                {m.status !== 'current' && (
                  <button
                    type="button"
                    aria-label={`Make ${m.title} current`}
                    onClick={() =>
                      void run(() =>
                        jsonFetch(`/api/viewbooks/${viewbookId}/milestones/${m.id}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ status: 'current' }),
                        }),
                      )
                    }
                    className={`${editorSecondaryBtnClass} !min-h-8 px-2.5 py-1 text-xs`}
                  >
                    Make current
                  </button>
                )}
                {m.status !== 'done' && (
                  <button
                    type="button"
                    aria-label={`Mark ${m.title} done`}
                    onClick={() =>
                      void run(() =>
                        jsonFetch(`/api/viewbooks/${viewbookId}/milestones/${m.id}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ status: 'done' }),
                        }),
                      )
                    }
                    className={`${editorSecondaryBtnClass} !min-h-8 px-2.5 py-1 text-xs`}
                  >
                    Mark done
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`Delete ${m.title}`}
                  onClick={() => {
                    if (!window.confirm(`Delete “${m.title}”?`)) return
                    void run(() =>
                      jsonFetch(`/api/viewbooks/${viewbookId}/milestones/${m.id}`, { method: 'DELETE' }),
                    )
                  }}
                  className={`${editorDestructiveBtnClass} !min-h-8 px-2.5 py-1 text-xs`}
                >
                  Delete
                </button>
              </div>
            </div>
            <ReviewLinksBlock viewbookId={viewbookId} milestone={m} busy={busy} run={run} />
            {editingId === m.id && (
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
            )}
          </li>
          ))}
        </ol>
      )}

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-navy-border dark:bg-navy-deep/40">
        <h3 className="font-display text-sm font-bold text-navy dark:text-white">Add milestone</h3>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className={`min-w-0 flex-1 ${editorLabelClass}`}>
            New milestone title
            <input
              aria-label="New milestone title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Homepage creative review"
              className={`mt-1 ${editorInputClass}`}
            />
          </label>
          <button
            type="button"
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
            className={editorPrimaryBtnClass}
          >
            Add milestone
          </button>
        </div>
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
  onSave: (patch: {
    title: string
    blurb: string | null
    description: string | null
    sortOrder: number
    targetDate: string | null
  }) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(milestone.title)
  const [blurb, setBlurb] = useState(milestone.blurb ?? '')
  const [description, setDescription] = useState(milestone.description ?? '')
  const [sortOrder, setSortOrder] = useState(String(milestone.sortOrder))
  const [targetDate, setTargetDate] = useState(milestone.targetDate ? milestone.targetDate.slice(0, 10) : '')
  const { focused, onFocus, onBlur } = useFocusWithin()

  // PR2 Task 6: active while this edit row's drafts differ from the loaded
  // milestone, or focus remains within the row (it's already open — any
  // input differing counts, per the "err on active" fallback).
  const dirty =
    title !== milestone.title ||
    blurb !== (milestone.blurb ?? '') ||
    description !== (milestone.description ?? '') ||
    sortOrder !== String(milestone.sortOrder) ||
    targetDate !== (milestone.targetDate ? milestone.targetDate.slice(0, 10) : '')
  useEditorActivity(`admin-milestone-edit-${milestone.id}`, dirty || focused)

  return (
    <div className="border-t border-gray-200 bg-gray-50/70 p-4 dark:border-navy-border dark:bg-navy-deep/40" onFocus={onFocus} onBlur={onBlur}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className={`lg:col-span-2 ${editorLabelClass}`}>
          Title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Title"
            className={`mt-1 ${editorInputClass}`}
          />
        </label>
        <label className={editorLabelClass}>
          Status
          <select aria-label="Status" value={milestone.status} disabled className={`mt-1 ${editorInputClass}`}>
            <option value="upcoming">Upcoming</option>
            <option value="current">Current</option>
            <option value="done">Done</option>
          </select>
          <span className="mt-1 block text-[11px] font-normal text-gray-500 dark:text-white/50">Use the status actions above.</span>
        </label>
        <label className={editorLabelClass}>
          Target date
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            aria-label="Target date"
            className={`mt-1 ${editorInputClass}`}
          />
        </label>
        <label className={`sm:col-span-2 lg:col-span-3 ${editorLabelClass}`}>
          Secondary blurb
          <input
            value={blurb}
            onChange={(e) => setBlurb(e.target.value)}
            placeholder="Short supporting line"
            aria-label="Blurb"
            className={`mt-1 ${editorInputClass}`}
          />
        </label>
        <label className={editorLabelClass}>
          Order
          <input
            type="number"
            min="1"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            aria-label="Order"
            className={`mt-1 ${editorInputClass}`}
          />
        </label>
        <label className={`sm:col-span-2 lg:col-span-4 ${editorLabelClass}`}>
          Description
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Longer milestone context shown in the viewbook"
            aria-label="Description"
            maxLength={2000}
            rows={4}
            className={`mt-1 ${editorTextareaClass}`}
          />
        </label>
      </div>
      <div role="group" aria-label="Milestone edit actions" className="mt-4 flex flex-wrap justify-end gap-2 border-t border-gray-200 pt-4 dark:border-navy-border">
        <button type="button" onClick={onCancel} className={editorSecondaryBtnClass}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() =>
            onSave({
              title,
              blurb: blurb || null,
              description: description || null,
              sortOrder: parseInt(sortOrder, 10) || milestone.sortOrder,
              targetDate: targetDate || null,
            })
          }
          disabled={!title}
          className={editorPrimaryBtnClass}
        >
          Save
        </button>
      </div>
    </div>
  )
}

// 2026-07-19: per-milestone review-link management — the operator side of the
// public page's "Review & feedback" region. Collapsed to a summary line when
// the milestone has no links; the add form posts to the (previously
// caller-less) review-links route and the parent's onChanged() reload brings
// the new row back. Deleting a link cascades its feedback thread — confirm.
function ReviewLinksBlock({
  viewbookId,
  milestone,
  busy,
  run,
}: {
  viewbookId: number
  milestone: MilestoneRow
  busy: boolean
  run: (fn: () => Promise<unknown>) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [kind, setKind] = useState<'mockup' | 'live'>('mockup')
  const links = milestone.reviewLinks ?? []

  return (
    <div className="border-t border-gray-100 bg-gray-50/60 px-4 py-3 dark:border-navy-border/50 dark:bg-navy-deep/25">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-white/45">
          Review links
        </span>
        <StatusPill label={`${links.length}`} tone={links.length > 0 ? 'running' : 'neutral'} />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-xs font-semibold text-teal-700 hover:underline dark:text-teal-300"
        >
          {open ? 'Hide' : links.length > 0 ? 'Manage' : 'Add review link'}
        </button>
      </div>
      {open && (
        <div className="mt-3 space-y-3">
          {links.length > 0 && (
            <ul className="space-y-2">
              {links.map((link) => (
                <li key={link.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-navy-border dark:bg-navy-card">
                  <StatusPill label={link.kind === 'live' ? 'Live site' : 'Mockup'} tone={link.kind === 'live' ? 'success' : 'neutral'} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-navy dark:text-white">{link.label}</span>
                    <a href={link.url} target="_blank" rel="noopener" className="block truncate text-xs text-teal-700 hover:underline dark:text-teal-300">{link.url}</a>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Delete review link ${link.label}`}
                    onClick={() => {
                      if (!window.confirm(`Delete review link “${link.label}”? Its feedback thread is deleted with it.`)) return
                      void run(() => jsonFetch(`/api/viewbooks/${viewbookId}/review-links/${link.id}`, { method: 'DELETE' }))
                    }}
                    className={`${editorDestructiveBtnClass} !min-h-7 px-2 py-0.5 text-xs`}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className={`min-w-0 flex-1 ${editorLabelClass}`}>
              Label
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Homepage mockup"
                className={`mt-1 ${editorInputClass}`}
              />
            </label>
            <label className={`min-w-0 flex-[2] ${editorLabelClass}`}>
              HTTPS URL
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
                className={`mt-1 ${editorInputClass}`}
              />
            </label>
            <label className={editorLabelClass}>
              Kind
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value === 'live' ? 'live' : 'mockup')}
                className={`mt-1 ${editorInputClass}`}
              >
                <option value="mockup">Mockup</option>
                <option value="live">Live site</option>
              </select>
            </label>
            <button
              type="button"
              disabled={busy || !label.trim() || !url.trim()}
              onClick={() =>
                void run(async () => {
                  await jsonFetch(`/api/viewbooks/${viewbookId}/milestones/${milestone.id}/review-links`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ label: label.trim(), url: url.trim(), kind }),
                  })
                  setLabel('')
                  setUrl('')
                })
              }
              className={editorPrimaryBtnClass}
            >
              Add link
            </button>
          </div>
          <p className="text-xs text-gray-500 dark:text-white/45">
            Review links appear in the client viewbook&apos;s “Review &amp; feedback” area with a comment thread for each.
          </p>
        </div>
      )}
    </div>
  )
}
