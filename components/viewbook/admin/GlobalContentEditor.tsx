'use client'

// Global company content editor (/viewbooks/settings): one current version
// feeds every client viewbook.
import { useCallback, useEffect, useState } from 'react'
import {
  GLOBAL_CONTENT_KEYS,
  canonicalMailbox,
  type ContentBlocks,
  type GlobalContentKey,
  type TeamMember,
} from '@/lib/viewbook/global-content-keys'
import { jsonFetch } from './viewbook-admin-shared'
import { StrategyDocsCard } from './StrategyDocsCard'
import {
  editorDestructiveBtnClass,
  editorInputClass,
  editorLabelClass,
  editorPrimaryBtnClass,
  editorSecondaryBtnClass,
  editorTextareaClass,
  editorWellClass,
} from '@/components/viewbook/editor'
import { StatusPill } from '@/components/ui/StatusPill'

const BLOCK_KEYS = GLOBAL_CONTENT_KEYS.filter((key) => key !== 'team' && key !== 'pc-intro')
const BLOCK_TITLES: Partial<Record<GlobalContentKey, string>> = {
  process: 'Process',
  why: 'Why it matters',
  'seo-base': 'SEO foundation',
  'geo-base': 'GEO foundation',
  'eeat-base': 'E-E-A-T foundation',
  'process-milestones': 'Process milestones',
}
const fileInputClass = 'block w-full text-xs text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:font-semibold file:text-navy hover:file:bg-gray-200 dark:text-white/60 dark:file:bg-white/10 dark:file:text-white dark:hover:file:bg-white/15'

export function GlobalContentEditor() {
  const [content, setContent] = useState<Partial<Record<GlobalContentKey, unknown>>>({})
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const entries = await Promise.all(
        GLOBAL_CONTENT_KEYS.map(async (key) => {
          const { content } = await jsonFetch<{ content: unknown }>(`/api/viewbook-content/${key}`)
          return [key, content] as const
        }),
      )
      setContent(Object.fromEntries(entries))
      setLoaded(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'load_failed')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Returns success so a caller can show BUTTON-LOCAL feedback — the page-top
  // flash/error banners sit above the fold and are invisible when saving from
  // a card scrolled further down ("Save roster doesn't seem to work",
  // 2026-07-19); the banner stays for users who ARE at the top.
  async function run(label: string, fn: () => Promise<unknown>): Promise<boolean> {
    setError(null)
    try {
      await fn()
      setFlash(label)
      setTimeout(() => setFlash(null), 4000)
      await load()
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'save_failed')
      return false
    }
  }

  if (!loaded && !error) return <p className="text-sm text-gray-400 dark:text-white/40">Loading…</p>

  return (
    <div className="space-y-6 font-body">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill label="Global content" tone="warning" />
          <h2 className="font-display text-base font-bold text-amber-950 dark:text-amber-100">Affects every viewbook</h2>
        </div>
        <p className="mt-1.5 text-sm text-amber-800 dark:text-amber-200/80">Changes here update the inherited company content used across all client viewbooks. Client-specific overrides remain separate.</p>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
      {flash && <p aria-live="polite" className="rounded-lg bg-green-50 p-3 text-sm text-green-700 dark:bg-green-500/10 dark:text-green-300">Saved {flash}.</p>}
      <StrategyDocsCard />
      <TeamEditor roster={(content.team as TeamMember[] | null) ?? []} run={run} />
      <PcIntroEditor value={(content['pc-intro'] as string | null) ?? ''} run={run} />
      {BLOCK_KEYS.map((key) => (
        <BlocksEditor key={key} contentKey={key} value={(content[key] as ContentBlocks | null) ?? { blocks: [] }} run={run} />
      ))}
    </div>
  )
}

function TeamEditor({
  roster,
  run,
}: {
  roster: TeamMember[]
  run: (label: string, fn: () => Promise<unknown>) => Promise<boolean>
}) {
  const [members, setMembers] = useState<TeamMember[]>(roster)
  // Button-local save state (2026-07-19): the shared flash banner renders at
  // the top of a long page — invisible from this card. The button itself
  // narrates Saving… → Saved ✓ / Save failed.
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  useEffect(() => setMembers(roster), [roster])

  function set(index: number, patch: Partial<TeamMember>) {
    setMembers(members.map((member, memberIndex) => memberIndex === index ? { ...member, ...patch } : member))
  }

  function rosterForSave(): TeamMember[] {
    return members.map((member) => {
      const rawEmail = member.email?.trim() ?? ''
      const email = rawEmail ? canonicalMailbox(rawEmail) : null
      if (rawEmail && !email) throw new Error('invalid_email')
      const { email: _email, ...rest } = member
      return { ...rest, ...(email ? { email } : {}) }
    })
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-navy-border dark:bg-navy-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold text-navy dark:text-white">Meet the team</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-white/55">This roster and its photos are inherited by every viewbook.</p>
        </div>
        <StatusPill label={`${members.length} ${members.length === 1 ? 'member' : 'members'}`} tone="neutral" />
      </div>
      <div className="mt-4 space-y-3 text-sm">
        {members.map((member, index) => (
          <article key={index} data-team-member className="grid gap-3 rounded-lg border border-gray-200 bg-gray-50/70 p-3 sm:grid-cols-2 xl:grid-cols-12 dark:border-navy-border dark:bg-navy-deep/35">
            <label className={`xl:col-span-3 ${editorLabelClass}`}>
              Name
              <input value={member.name} onChange={(event) => set(index, { name: event.target.value })} placeholder="Name" className={`mt-1 ${editorInputClass}`} />
            </label>
            <label className={`xl:col-span-3 ${editorLabelClass}`}>
              Role
              <input value={member.role} onChange={(event) => set(index, { role: event.target.value })} placeholder="Role" className={`mt-1 ${editorInputClass}`} />
            </label>
            <label className={`xl:col-span-4 ${editorLabelClass}`}>
              Email
              <input type="email" value={member.email ?? ''} onChange={(event) => set(index, { email: event.target.value })} placeholder="Email" aria-label={`Email for ${member.name || `member ${index + 1}`}`} className={`mt-1 ${editorInputClass}`} />
            </label>
            <label className="flex items-center gap-2 self-end pb-2 text-xs font-medium text-gray-600 sm:col-span-2 xl:col-span-2 dark:text-white/65">
              <input type="checkbox" checked={member.isCsm === true} aria-label={`CSM ${member.name || `member ${index + 1}`}`} onChange={(event) => set(index, { isCsm: event.target.checked })} className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500 dark:border-navy-border dark:bg-navy-light" />
              Available as CSM
            </label>
            <label className={`sm:col-span-2 xl:col-span-8 ${editorLabelClass}`}>
              One-line bio
              <input value={member.blurb} onChange={(event) => set(index, { blurb: event.target.value })} placeholder="One-line bio" className={`mt-1 ${editorInputClass}`} />
            </label>
            <label className={`sm:col-span-2 xl:col-span-4 ${editorLabelClass}`}>
              <span className="flex items-center justify-between gap-2">
                Photo
                <StatusPill label={member.photo ? 'Uploaded' : 'Not uploaded'} tone={member.photo ? 'success' : 'neutral'} />
              </span>
              <span className="mt-1 flex min-h-10 items-center rounded-lg border border-dashed border-gray-300 bg-white px-2 py-1.5 dark:border-navy-border dark:bg-navy-light">
                <input
                  aria-label={`Photo for ${member.name || `member ${index + 1}`}`}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className={fileInputClass}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (!file) return
                    void run(`photo for ${member.name}`, async () => {
                      const form = new FormData()
                      form.set('memberName', member.name)
                      form.set('file', file)
                      const response = await fetch('/api/viewbook-content/team-photo', { method: 'POST', body: form })
                      const body = (await response.json()) as { error?: string }
                      if (!response.ok) throw new Error(body.error || 'upload_failed')
                    })
                  }}
                />
              </span>
            </label>
            <div className="flex justify-end sm:col-span-2 xl:col-span-12">
              <button type="button" onClick={() => setMembers(members.filter((_, memberIndex) => memberIndex !== index))} className={editorDestructiveBtnClass}>Remove member</button>
            </div>
          </article>
        ))}
        {members.length === 0 && <p className="rounded-lg border border-dashed border-gray-300 p-4 text-center text-gray-500 dark:border-navy-border dark:text-white/55">No team members yet.</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" onClick={() => setMembers([...members, { name: '', role: '', photo: null, blurb: '' }])} className={editorSecondaryBtnClass}>Add member</button>
          <button
            type="button"
            disabled={saveState === 'saving'}
            onClick={() => {
              setSaveState('saving')
              void run('team roster', () => jsonFetch('/api/viewbook-content/team', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: rosterForSave() }),
              })).then((ok) => {
                setSaveState(ok ? 'saved' : 'failed')
                setTimeout(() => setSaveState('idle'), 4000)
              })
            }}
            className={editorPrimaryBtnClass}
          >
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : saveState === 'failed' ? 'Save failed — retry' : 'Save roster'}
          </button>
          {saveState === 'failed' && (
            <span role="alert" className="self-center text-xs font-semibold text-red-700 dark:text-red-300">
              See the error at the top of the page.
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 dark:text-white/45">Photos attach to a saved member by name — save the roster first, and keep names unique.</p>
      </div>
    </section>
  )
}

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

function PcIntroEditor({
  value,
  run,
}: {
  value: string
  run: (label: string, fn: () => Promise<unknown>) => Promise<boolean>
}) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-navy-border dark:bg-navy-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold text-navy dark:text-white">Post-contract welcome</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-white/55">Shared welcome copy shown in the post-contract introduction.</p>
        </div>
        <StatusPill label="pc-intro" tone="neutral" />
      </div>
      <label className={`mt-4 ${editorLabelClass}`}>
        Welcome copy
        <textarea aria-label="Post-contract welcome" value={text} onChange={(event) => setText(event.target.value)} rows={3} placeholder="Welcome! Let's get your account set up..." className={`mt-1 ${editorTextareaClass}`} />
      </label>
      <button
        type="button"
        onClick={() => void run('pc-intro', () => jsonFetch('/api/viewbook-content/pc-intro', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: text }),
        }))}
        className={`mt-3 ${editorPrimaryBtnClass}`}
      >
        Save
      </button>
    </section>
  )
}

function BlocksEditor({
  contentKey,
  value,
  run,
}: {
  contentKey: GlobalContentKey
  value: ContentBlocks
  run: (label: string, fn: () => Promise<unknown>) => Promise<boolean>
}) {
  const [blocks, setBlocks] = useState(value.blocks)
  useEffect(() => setBlocks(value.blocks), [value.blocks])

  function set(index: number, patch: Partial<ContentBlocks['blocks'][number]>) {
    setBlocks(blocks.map((block, blockIndex) => blockIndex === index ? { ...block, ...patch } : block))
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-navy-border dark:bg-navy-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold text-navy dark:text-white">{BLOCK_TITLES[contentKey] ?? contentKey}</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-white/55">Shared heading and body blocks inherited by client viewbooks.</p>
        </div>
        <StatusPill label={`${blocks.length} ${blocks.length === 1 ? 'block' : 'blocks'}`} tone="neutral" />
      </div>
      <div className="mt-4 space-y-3 text-sm">
        {blocks.map((block, index) => (
          <div key={index} className={editorWellClass}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className={`min-w-0 flex-1 ${editorLabelClass}`}>
                Heading
                <input value={block.heading} onChange={(event) => set(index, { heading: event.target.value })} placeholder="Heading" className={`mt-1 ${editorInputClass}`} />
              </label>
              <button type="button" onClick={() => setBlocks(blocks.filter((_, blockIndex) => blockIndex !== index))} className={editorDestructiveBtnClass}>Remove block</button>
            </div>
            <label className={`mt-3 ${editorLabelClass}`}>
              Body
              <textarea value={block.body} onChange={(event) => set(index, { body: event.target.value })} rows={3} placeholder="Body" className={`mt-1 ${editorTextareaClass}`} />
            </label>
          </div>
        ))}
        {blocks.length === 0 && <p className="rounded-lg border border-dashed border-gray-300 p-4 text-center text-gray-500 dark:border-navy-border dark:text-white/55">No content blocks yet.</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setBlocks([...blocks, { heading: '', body: '' }])} className={editorSecondaryBtnClass}>Add block</button>
          <button
            type="button"
            onClick={() => void run(contentKey, () => jsonFetch(`/api/viewbook-content/${contentKey}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: { blocks } }),
            }))}
            className={editorPrimaryBtnClass}
          >
            Save
          </button>
        </div>
      </div>
    </section>
  )
}
