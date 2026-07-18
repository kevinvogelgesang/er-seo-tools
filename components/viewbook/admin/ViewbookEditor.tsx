'use client'

// Viewbook editor shell: Theme · Content · Data Source · Milestones · Feedback · Activity · Settings.

import { useCallback, useEffect, useState } from 'react'
import {
  editorDestructiveBtnClass,
  editorPrimaryBtnClass,
  editorSecondaryBtnClass,
} from '@/components/viewbook/editor'
import { StatusPill } from '@/components/ui/StatusPill'
import { SECTION_KEYS } from '@/lib/viewbook/theme'
import { isViewbookStage, nextStage, prevStage, STAGE_LABELS } from '@/lib/viewbook/stages'
import { jsonFetch, publicViewbookUrl, type ViewbookDetail } from './viewbook-admin-shared'
import { ThemeEditor } from './ThemeEditor'
import { ContentTab } from './ContentTab'
import { MilestonesEditor } from './MilestonesEditor'
import { FeedbackTab } from './FeedbackTab'
import { ActivityFeed } from './ActivityFeed'
import { DataSourceTab } from './DataSourceTab'
import { useBaselineSync, useEditorActivity, useFocusWithin, useViewbookSync } from '@/components/viewbook/public/useViewbookSync'
import { CsmPicker } from './GlobalContentEditor'

const TABS = ['Theme', 'Content', 'Data Source', 'Milestones', 'Feedback', 'Activity', 'Settings'] as const

export function ViewbookEditor({ viewbookId }: { viewbookId: number }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Theme')
  const [vb, setVb] = useState<ViewbookDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      const { viewbook } = await jsonFetch<{ viewbook: ViewbookDetail }>(`/api/viewbooks/${viewbookId}`)
      setVb(viewbook)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load_failed')
    }
  }, [viewbookId])

  useEffect(() => {
    void load()
  }, [load])

  // PR2 Task 6: poll the admin version endpoint every ~3.5s (default cadence)
  // while visible; onChange only fires while the editor registry is idle —
  // an operator mid-edit in ThemeEditor/ContentTab/DataSourceTab/
  // MilestonesEditor/SettingsTab is never clobbered by a background reload.
  // `enabled: vb !== null` (NIT fix): the mount-time `load()` above is still
  // in flight on the very first render, so `vb?.syncVersion ?? 0` is a
  // placeholder — polling against that placeholder would race the mount
  // load and fire a redundant second GET the moment the poll observes the
  // REAL version. Gate the hook off the same `vb` load state instead.
  useViewbookSync({
    url: `/api/viewbooks/${viewbookId}/sync`,
    initialVersion: vb?.syncVersion ?? 0,
    enabled: vb !== null,
    onChange: () => void load(),
  })

  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
  if (!vb) return <p className="text-sm text-gray-400 dark:text-white/45">Loading…</p>

  const threads = vb.milestones.flatMap((m) => m.reviewLinks.map((l) => ({
    reviewLinkId: l.id,
    label: `${m.title} — ${l.label}`,
    feedback: l.feedback,
  })))
  const feedbackCount = threads.reduce((count, thread) => count + thread.feedback.length, 0)
  const tabKey = tab.toLowerCase().replaceAll(' ', '-')

  return (
    <div className="space-y-5 font-body">
      <header className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-navy-border dark:bg-navy-card sm:flex sm:items-center sm:justify-between sm:gap-5">
        <div className="min-w-0">
          <h1 className="truncate font-display text-xl font-bold text-navy dark:text-white">{vb.client.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusPill label={vb.kind} tone="neutral" />
            <StatusPill label={isViewbookStage(vb.stage) ? STAGE_LABELS[vb.stage] : vb.stage} tone="running" />
            <StatusPill label={vb.revokedAt ? 'Link revoked' : 'Link active'} tone={vb.revokedAt ? 'error' : 'success'} />
          </div>
        </div>
        {!vb.revokedAt && (
          <div aria-label="Public view actions" className="mt-4 flex flex-wrap items-center gap-2 sm:mt-0 sm:justify-end">
            <a
              href={publicViewbookUrl(vb.token)}
              target="_blank"
              rel="noopener"
              className={editorPrimaryBtnClass}
            >
              Open public view
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="ml-1.5 h-3.5 w-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 5h7v7M15 5 7 13M5 7v8h8" />
              </svg>
            </a>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(publicViewbookUrl(vb.token))
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
              className={editorSecondaryBtnClass}
            >
              {copied ? 'Copied!' : 'Copy link'}
            </button>
          </div>
        )}
      </header>

      <nav aria-label="Viewbook editor navigation" className="overflow-x-auto pb-1">
        <div role="tablist" aria-label="Viewbook editor sections" className="flex min-w-max items-center gap-1 rounded-xl bg-gray-100 p-1 dark:bg-navy-light">
          {TABS.map((t) => {
            const selected = tab === t
            const key = t.toLowerCase().replaceAll(' ', '-')
            return (
              <button
                key={t}
                id={`viewbook-tab-${key}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`viewbook-panel-${key}`}
                onClick={() => setTab(t)}
                className={`${t === 'Settings' ? 'ml-2 border-l border-gray-300 pl-4 dark:border-navy-border' : ''} rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                  selected
                    ? 'bg-white text-navy shadow-sm dark:bg-navy-card dark:text-white'
                    : 'text-gray-500 hover:bg-white/60 hover:text-navy dark:text-white/50 dark:hover:bg-navy-card/60 dark:hover:text-white'
                }`}
              >
                <span className="inline-flex items-center gap-1.5">
                  {t}
                  {t === 'Feedback' && feedbackCount > 0 && (
                    <span aria-label={`${feedbackCount} feedback items`} className="inline-flex min-w-5 items-center justify-center rounded-full bg-teal-100 px-1.5 py-0.5 text-[10px] font-bold text-teal-700 dark:bg-teal-500/15 dark:text-teal-300">
                      {feedbackCount}
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </nav>

      <div
        id={`viewbook-panel-${tabKey}`}
        role="tabpanel"
        aria-labelledby={`viewbook-tab-${tabKey}`}
        className={tab === 'Settings' ? 'rounded-xl border border-gray-200 bg-gray-50/60 p-4 dark:border-navy-border dark:bg-navy-deep/30' : ''}
      >
        {tab === 'Theme' && (
          <ThemeEditor viewbookId={vb.id} theme={vb.theme} onSaved={() => void load()} />
        )}
        {tab === 'Content' && (
          <ContentTab
            viewbookId={vb.id}
            welcomeNote={vb.welcomeNote}
            sections={vb.sections}
            overrides={vb.contentOverrides}
            onChanged={() => void load()}
          />
        )}
        {tab === 'Data Source' && (
          <DataSourceTab key={vb.id} viewbook={vb} onChanged={() => void load()} />
        )}
        {tab === 'Milestones' && (
          <MilestonesEditor viewbookId={vb.id} milestones={vb.milestones} onChanged={() => void load()} />
        )}
        {tab === 'Feedback' && <FeedbackTab key={vb.id} viewbookId={vb.id} threads={threads} />}
        {tab === 'Activity' && <ActivityFeed viewbookId={vb.id} />}
        {tab === 'Settings' && <SettingsTab vb={vb} onChanged={() => void load()} />}
      </div>
    </div>
  )
}

// Task 6: narrower than the full ViewbookDetail (DataSourceTab precedent) so
// tests can construct a minimal viewbook without every editor's fields.
export interface SettingsTabViewbook {
  id: number
  kind: string
  notifyEmail: string | null
  stage: string
  pcCompletedAt: string | null
  csmName: string | null
  sections: { sectionKey: string; state: string }[]
}

export function SettingsTab({ vb, onChanged }: { vb: SettingsTabViewbook; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { focused, onFocus, onBlur } = useFocusWithin()

  const currentStage = isViewbookStage(vb.stage) ? vb.stage : null
  const nextStageValue = currentStage ? nextStage(currentStage) : null
  const prevStageValue = currentStage ? prevStage(currentStage) : null

  function moveStage(direction: 'forward' | 'back', force = false) {
    return jsonFetch(`/api/viewbooks/${vb.id}/stage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction, expectedStage: vb.stage, ...(force ? { force: true } : {}) }),
    })
  }

  function handleAdvance() {
    if (currentStage === 'post-contract' && !vb.pcCompletedAt) {
      if (!window.confirm('Acknowledgments incomplete — advance anyway?')) return
      void run('Stage move', () => moveStage('forward', true))
      return
    }
    void run('Stage move', () => moveStage('forward'))
  }

  // Final-review fix (P1): `notifyEmail` used to be seeded ONCE from
  // `vb.notifyEmail` and dirty was computed directly against the raw prop —
  // the same falsely-permanent-dirty bug as ThemeEditor/ContentTab (a
  // background `load()` advancing `vb`, including THIS tab's own save
  // landing, left `dirty` stuck true forever). `useBaselineSync` reconciles
  // while idle and `commit()` is called immediately on a successful save.
  const { draft: notifyEmail, setDraft: setNotifyEmail, dirty, commit } =
    useBaselineSync(vb.notifyEmail ?? '', focused || busy)
  useEditorActivity('admin-settings', dirty || busy || focused)

  async function run(label: string, fn: () => Promise<unknown>, onSuccess?: () => void) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onSuccess?.()
      setFlash(label)
      setTimeout(() => setFlash(null), 1500)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save_failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5 text-sm" onFocus={onFocus} onBlur={onBlur}>
      {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
      {flash && <p className="text-teal-600 dark:text-teal-400">{flash} done.</p>}

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-gray-700 dark:text-white/80">
          Project stage: <span className="font-medium">{isViewbookStage(vb.stage) ? STAGE_LABELS[vb.stage] : vb.stage}</span>
        </p>
        <button
          type="button"
          disabled={busy || !prevStageValue}
          onClick={() => void run('Stage move', () => moveStage('back'))}
          className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-navy-border dark:text-white/80 dark:hover:bg-white/5"
        >
          Roll back
        </button>
        <button
          type="button"
          disabled={busy || !nextStageValue}
          onClick={handleAdvance}
          className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-navy-border dark:text-white/80 dark:hover:bg-white/5"
        >
          Advance
        </button>
      </div>

      <CsmPicker viewbookId={vb.id} csmName={vb.csmName} onChanged={onChanged} />

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-gray-700 dark:text-white/80">Kind</label>
        <select
          value={vb.kind}
          onChange={(e) =>
            void run('Kind', () =>
              jsonFetch(`/api/viewbooks/${vb.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kind: e.target.value }),
              }),
            )
          }
          className="rounded border border-gray-300 bg-white px-2 py-1 dark:border-navy-border dark:bg-navy-card dark:text-white"
        >
          <option value="new-build">new-build</option>
          <option value="upgrade">upgrade</option>
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-gray-700 dark:text-white/80">Digest email</label>
        <input
          value={notifyEmail}
          onChange={(e) => setNotifyEmail(e.target.value)}
          placeholder="defaults to admin"
          className="rounded border border-gray-300 bg-white px-2 py-1 dark:border-navy-border dark:bg-navy-card dark:text-white"
        />
        <button
          onClick={() =>
            void run(
              'Notify email',
              () =>
                jsonFetch(`/api/viewbooks/${vb.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ notifyEmail: notifyEmail || null }),
                }),
              () => commit(notifyEmail),
            )
          }
          className="rounded bg-teal-600 px-3 py-1 text-white hover:bg-teal-700"
        >
          Save
        </button>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold text-gray-700 dark:text-white/80">Sections</h3>
        {SECTION_KEYS.map((key) => {
          const s = vb.sections.find((x) => x.sectionKey === key)
          return (
            <div key={key} className="flex items-center gap-2">
              <span className="w-32 text-gray-700 dark:text-white/80">{key}</span>
              <select
                value={s?.state ?? 'active'}
                onChange={(e) =>
                  void run(`Section ${key}`, () =>
                    jsonFetch(`/api/viewbooks/${vb.id}/sections/${key}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ state: e.target.value }),
                    }),
                  )
                }
                className="rounded border border-gray-300 bg-white px-2 py-1 dark:border-navy-border dark:bg-navy-card dark:text-white"
              >
                <option value="active">active</option>
                <option value="hidden">hidden</option>
                <option value="done">done ✓</option>
              </select>
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => void run('Question sync', () => jsonFetch(`/api/viewbooks/${vb.id}/sync-questions`, { method: 'POST' }))}
          className={editorSecondaryBtnClass}
        >
          Sync new questions
        </button>
        <button
          onClick={() => void run('Token rotation', () => jsonFetch(`/api/viewbooks/${vb.id}/token`, { method: 'POST' }))}
          className={editorSecondaryBtnClass}
        >
          Rotate link
        </button>
      </div>

      <section role="region" aria-labelledby="viewbook-danger-zone" className="rounded-xl border border-red-200 bg-red-50/60 p-4 dark:border-red-500/30 dark:bg-red-500/10">
        <h3 id="viewbook-danger-zone" className="font-display font-bold text-red-800 dark:text-red-300">Danger zone</h3>
        <p className="mt-1 text-xs text-red-700/80 dark:text-red-300/75">These actions interrupt client access or permanently remove this viewbook.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => {
              if (confirm('Revoke the public link? The client loses access until you rotate.')) {
                void run('Revocation', () => jsonFetch(`/api/viewbooks/${vb.id}/token`, { method: 'DELETE' }))
              }
            }}
            className="inline-flex min-h-9 items-center justify-center rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-sm font-semibold text-amber-700 transition-colors hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 focus-visible:ring-offset-2 disabled:opacity-50 dark:border-amber-500/40 dark:bg-navy-card dark:text-amber-300 dark:hover:bg-amber-500/10 dark:focus-visible:ring-offset-navy-card"
          >
            Revoke link
          </button>
          <button
            onClick={() => {
              if (confirm('Delete this viewbook and all its data? This cannot be undone.')) {
                void run('Delete', async () => {
                  await jsonFetch(`/api/viewbooks/${vb.id}`, { method: 'DELETE' })
                  window.location.href = '/viewbooks'
                })
              }
            }}
            className={editorDestructiveBtnClass}
          >
            Delete viewbook
          </button>
        </div>
      </section>
    </div>
  )
}
