'use client'

// Global company content editor (/viewbooks/settings): team roster with
// atomic photo attachment + heading/body block editors for the base
// process/why/strategy content. One current version feeds ALL viewbooks.

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

const BLOCK_KEYS = GLOBAL_CONTENT_KEYS.filter((k) => k !== 'team' && k !== 'pc-intro')

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load_failed')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function run(label: string, fn: () => Promise<unknown>) {
    setError(null)
    try {
      await fn()
      setFlash(label)
      setTimeout(() => setFlash(null), 1500)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save_failed')
    }
  }

  if (!loaded && !error) return <p className="text-sm text-gray-400">Loading…</p>

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {flash && <p className="text-sm text-teal-600 dark:text-teal-400">Saved {flash}.</p>}
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
  run: (label: string, fn: () => Promise<unknown>) => Promise<void>
}) {
  const [members, setMembers] = useState<TeamMember[]>(roster)
  useEffect(() => setMembers(roster), [roster])

  function set(i: number, patch: Partial<TeamMember>) {
    setMembers(members.map((m, j) => (j === i ? { ...m, ...patch } : m)))
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
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-navy-border dark:bg-navy-card">
      <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-white/80">Meet the team</h2>
      <div className="space-y-3 text-sm">
        {members.map((m, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input
              value={m.name}
              onChange={(e) => set(i, { name: e.target.value })}
              placeholder="Name"
              className="rounded border border-gray-300 bg-white px-2 py-1 dark:border-navy-border dark:bg-navy-card dark:text-white"
            />
            <input
              value={m.role}
              onChange={(e) => set(i, { role: e.target.value })}
              placeholder="Role"
              className="rounded border border-gray-300 bg-white px-2 py-1 dark:border-navy-border dark:bg-navy-card dark:text-white"
            />
            <input
              value={m.blurb}
              onChange={(e) => set(i, { blurb: e.target.value })}
              placeholder="One-line bio"
              className="min-w-48 flex-1 rounded border border-gray-300 bg-white px-2 py-1 dark:border-navy-border dark:bg-navy-card dark:text-white"
            />
            <input
              type="email"
              value={m.email ?? ''}
              onChange={(e) => set(i, { email: e.target.value })}
              placeholder="Email"
              aria-label={`Email for ${m.name || `member ${i + 1}`}`}
              className="rounded border border-gray-300 bg-white px-2 py-1 dark:border-navy-border dark:bg-navy-card dark:text-white"
            />
            <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-white/60">
              <input
                type="checkbox"
                checked={m.isCsm === true}
                aria-label={`CSM ${m.name || `member ${i + 1}`}`}
                onChange={(e) => set(i, { isCsm: e.target.checked })}
              />
              CSM
            </label>
            <label className="text-xs text-gray-500 dark:text-white/50">
              photo{m.photo ? ' ✓' : ''}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="ml-1"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  void run(`photo for ${m.name}`, async () => {
                    const form = new FormData()
                    form.set('memberName', m.name)
                    form.set('file', f)
                    const res = await fetch('/api/viewbook-content/team-photo', { method: 'POST', body: form })
                    const body = (await res.json()) as { error?: string }
                    if (!res.ok) throw new Error(body.error || 'upload_failed')
                  })
                }}
              />
            </label>
            <button
              onClick={() => setMembers(members.filter((_, j) => j !== i))}
              className="text-xs text-red-600 underline dark:text-red-400"
            >
              Remove
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          <button
            onClick={() => setMembers([...members, { name: '', role: '', photo: null, blurb: '' }])}
            className="rounded border border-gray-300 px-3 py-1 text-gray-700 hover:bg-gray-50 dark:border-navy-border dark:text-white/80 dark:hover:bg-white/5"
          >
            Add member
          </button>
          <button
            onClick={() =>
              void run('team roster', () =>
                jsonFetch('/api/viewbook-content/team', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ content: rosterForSave() }),
                }),
              )
            }
            className="rounded bg-teal-600 px-3 py-1 text-white hover:bg-teal-700"
          >
            Save roster
          </button>
        </div>
        <p className="text-xs text-gray-400 dark:text-white/40">
          Photos attach to a saved member by name — save the roster first, names must be unique.
        </p>
      </div>
    </div>
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
      .then(({ content }) => {
        if (active) setRoster(Array.isArray(content) ? content as TeamMember[] : [])
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'load_failed')
      })
    return () => { active = false }
  }, [])

  const choices = roster.filter((member) => member.isCsm === true)
  // The stored csmName can go dangling (renamed/removed/unflagged CSM). If we
  // forced the <select> value to '' in that case it would render as
  // "Unassigned" already selected, so re-selecting "Unassigned" would be a
  // no-op (same value -> no onChange) and the operator could never clear it.
  // Render the stale name as its own distinct option instead, so switching to
  // "Unassigned" is a real value change.
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
    } catch (err) {
      setSelected(previous)
      setError(err instanceof Error ? err.message : 'save_failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`viewbook-csm-${viewbookId}`} className="text-gray-700 dark:text-white/80">Assigned CSM</label>
        <select
          id={`viewbook-csm-${viewbookId}`}
          aria-label="Assigned CSM"
          value={selected}
          disabled={busy}
          onChange={(event) => void assign(event.target.value)}
          className="rounded border border-gray-300 bg-white px-2 py-1 dark:border-navy-border dark:bg-navy-card dark:text-white disabled:opacity-60"
        >
          <option value="">Unassigned</option>
          {isDangling && <option value={selected}>{`${selected} — no longer a CSM`}</option>}
          {choices.map((member) => <option key={member.name} value={member.name}>{member.name}</option>)}
        </select>
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}

// PR5: the post-contract welcome hero — a single bounded string, not a
// heading/body block list (see lib/viewbook/global-content.ts validatePcIntro).
function PcIntroEditor({
  value,
  run,
}: {
  value: string
  run: (label: string, fn: () => Promise<unknown>) => Promise<void>
}) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-navy-border dark:bg-navy-card">
      <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-white/80">
        Post-contract welcome (pc-intro)
      </h2>
      <div className="space-y-3 text-sm">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="Welcome! Let's get your account set up..."
          className="w-full rounded border border-gray-300 bg-white p-2 dark:border-navy-border dark:bg-navy-card dark:text-white"
        />
        <button
          onClick={() =>
            void run('pc-intro', () =>
              jsonFetch('/api/viewbook-content/pc-intro', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: text }),
              }),
            )
          }
          className="rounded bg-teal-600 px-3 py-1 text-white hover:bg-teal-700"
        >
          Save
        </button>
      </div>
    </div>
  )
}

function BlocksEditor({
  contentKey,
  value,
  run,
}: {
  contentKey: GlobalContentKey
  value: ContentBlocks
  run: (label: string, fn: () => Promise<unknown>) => Promise<void>
}) {
  const [blocks, setBlocks] = useState(value.blocks)
  useEffect(() => setBlocks(value.blocks), [value.blocks])

  function set(i: number, patch: Partial<ContentBlocks['blocks'][number]>) {
    setBlocks(blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)))
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-navy-border dark:bg-navy-card">
      <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-white/80">{contentKey}</h2>
      <div className="space-y-3 text-sm">
        {blocks.map((b, i) => (
          <div key={i} className="space-y-1">
            <div className="flex gap-2">
              <input
                value={b.heading}
                onChange={(e) => set(i, { heading: e.target.value })}
                placeholder="Heading"
                className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 font-medium dark:border-navy-border dark:bg-navy-card dark:text-white"
              />
              <button
                onClick={() => setBlocks(blocks.filter((_, j) => j !== i))}
                className="text-xs text-red-600 underline dark:text-red-400"
              >
                Remove
              </button>
            </div>
            <textarea
              value={b.body}
              onChange={(e) => set(i, { body: e.target.value })}
              rows={3}
              placeholder="Body"
              className="w-full rounded border border-gray-300 bg-white p-2 dark:border-navy-border dark:bg-navy-card dark:text-white"
            />
          </div>
        ))}
        <div className="flex gap-2">
          <button
            onClick={() => setBlocks([...blocks, { heading: '', body: '' }])}
            className="rounded border border-gray-300 px-3 py-1 text-gray-700 hover:bg-gray-50 dark:border-navy-border dark:text-white/80 dark:hover:bg-white/5"
          >
            Add block
          </button>
          <button
            onClick={() =>
              void run(contentKey, () =>
                jsonFetch(`/api/viewbook-content/${contentKey}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ content: { blocks } }),
                }),
              )
            }
            className="rounded bg-teal-600 px-3 py-1 text-white hover:bg-teal-700"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
