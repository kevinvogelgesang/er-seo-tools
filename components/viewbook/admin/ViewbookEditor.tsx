'use client'

// Viewbook editor shell: Theme · Content · Data Source · Milestones · Feedback · Activity · Settings.

import { useCallback, useEffect, useState } from 'react'
import { SECTION_KEYS } from '@/lib/viewbook/theme'
import { isViewbookStage, STAGE_LABELS } from '@/lib/viewbook/stages'
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
  if (!vb) return <p className="text-sm text-gray-400">Loading…</p>

  const threads = vb.milestones.flatMap((m) => m.reviewLinks.map((l) => ({
    reviewLinkId: l.id,
    label: `${m.title} — ${l.label}`,
    feedback: l.feedback,
  })))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">{vb.client.name}</h1>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-white/10 dark:text-white/60">
          {vb.kind}
        </span>
        {vb.revokedAt ? (
          <span className="text-xs font-medium text-red-600 dark:text-red-400">link revoked</span>
        ) : (
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(publicViewbookUrl(vb.token))
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
            className="text-xs text-teal-700 underline dark:text-teal-400"
          >
            {copied ? 'Copied!' : 'Copy public link'}
          </button>
        )}
      </div>

      <nav className="flex gap-1 border-b border-gray-200 dark:border-navy-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              tab === t
                ? 'border-b-2 border-teal-600 px-3 py-2 text-sm font-semibold text-teal-700 dark:text-teal-400'
                : 'px-3 py-2 text-sm text-gray-500 hover:text-gray-800 dark:text-white/50 dark:hover:text-white'
            }
          >
            {t}
          </button>
        ))}
      </nav>

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
  )
}

function SettingsTab({ vb, onChanged }: { vb: ViewbookDetail; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { focused, onFocus, onBlur } = useFocusWithin()

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

      <p className="text-gray-700 dark:text-white/80">
        Project stage: <span className="font-medium">{isViewbookStage(vb.stage) ? STAGE_LABELS[vb.stage] : vb.stage}</span>
      </p>

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
          className="rounded border border-gray-300 px-3 py-1 text-gray-700 hover:bg-gray-50 dark:border-navy-border dark:text-white/80 dark:hover:bg-white/5"
        >
          Sync new questions
        </button>
        <button
          onClick={() => void run('Token rotation', () => jsonFetch(`/api/viewbooks/${vb.id}/token`, { method: 'POST' }))}
          className="rounded border border-gray-300 px-3 py-1 text-gray-700 hover:bg-gray-50 dark:border-navy-border dark:text-white/80 dark:hover:bg-white/5"
        >
          Rotate link
        </button>
        <button
          onClick={() => {
            if (confirm('Revoke the public link? The client loses access until you rotate.')) {
              void run('Revocation', () => jsonFetch(`/api/viewbooks/${vb.id}/token`, { method: 'DELETE' }))
            }
          }}
          className="rounded border border-amber-400 px-3 py-1 text-amber-700 hover:bg-amber-50 dark:border-amber-500/40 dark:text-amber-400 dark:hover:bg-amber-500/10"
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
          className="rounded border border-red-400 px-3 py-1 text-red-600 hover:bg-red-50 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/10"
        >
          Delete viewbook
        </button>
      </div>
    </div>
  )
}
