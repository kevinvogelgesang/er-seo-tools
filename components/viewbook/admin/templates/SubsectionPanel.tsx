'use client'

// F1b Task 9 — one subsection's editor: title, offering flags, subsection
// copy, content-by-contentKind, and the data-source field grid. A single
// Save button PATCHes the WHOLE decoded subsection in one request (title +
// offerings + copy + content, guarded by the SECTION's version — patchSubsection
// fences its guard on `section.id`, never `subId`); the data-source field
// grid rows and the Archive/Restore toggle save independently (their own
// PATCH/POST, not folded into this Save).
import { useEffect, useState } from 'react'
import { StatusPill } from '@/components/ui/StatusPill'
import {
  editorDestructiveBtnClass,
  editorInputClass,
  editorLabelClass,
  editorPrimaryBtnClass,
  editorSecondaryBtnClass,
  editorTextareaClass,
  editorWellClass,
} from '@/components/viewbook/editor'
import { canonicalMailbox } from '@/lib/viewbook/global-content-keys'
import { jsonFetch } from '../viewbook-admin-shared'
import { FieldGrid } from './FieldGrid'
import {
  F2_HELPER_TEXT,
  STRATEGY_BLOCK_TITLES,
  SUBSECTION_COPY_CAPS,
  type ContentBlocks,
  type ContentKind,
  type TeamMember,
  type TemplateSectionView,
  type TemplateSubsectionView,
} from './template-editor-types'

const fileInputClass = 'block w-full text-xs text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:font-semibold file:text-navy hover:file:bg-gray-200 dark:text-white/60 dark:file:bg-white/10 dark:file:text-white dark:hover:file:bg-white/15'

type Mutate = (label: string, fn: () => Promise<unknown>) => Promise<boolean>

// The four bridged content kinds (final review fix #1): a null envelope on
// one of these is ALWAYS corrupt (template-service.ts's patchSubsection
// comment — every bridged 'main' subsection is seeded with a real envelope,
// never operator-created), mirroring SectionPanel's `section.copy === null`
// corrupt-copy guard. 'generic' keeps null as a legitimate empty state.
const BRIDGED_KINDS: ReadonlySet<ContentKind> = new Set(['welcome', 'strategy', 'milestones', 'pc-intro'])

// The bare payload shape saved for each contentKind — mirrors
// template-service.ts's patchSubsection expectations (no envelope `v`).
type WelcomeDraft = { team: TeamMember[]; process: ContentBlocks; why: ContentBlocks }
type StrategyDraft = { seoBase: ContentBlocks; geoBase: ContentBlocks; eeatBase: ContentBlocks }
type MilestonesDraft = { processMilestones: ContentBlocks }
type PcIntroDraft = { intro: string }

const EMPTY_BLOCKS: ContentBlocks = { blocks: [] }

export function SubsectionPanel({
  section,
  subsection,
  mutate,
  conflictEpoch,
}: {
  section: TemplateSectionView
  subsection: TemplateSubsectionView
  mutate: Mutate
  // Final review fix #2: bumped by TemplateEditor ONLY on a conflict-
  // triggered refetch (never on a normal save/photo-upload refetch). Every
  // draft state below resyncs from the fresh props in ONE effect keyed on
  // this counter (see below) — a normal save/upload elsewhere on the page
  // must NOT wipe an in-progress draft in THIS panel.
  conflictEpoch: number
}) {
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const archived = subsection.archivedAt !== null
  // Final review fix #1: every bridged 'main' subsection always has a
  // non-null envelope at seed time — a null content here is corruption, not
  // an empty state. Render a warning and never build a content draft for it
  // (title/offerings/copy stay editable; Save simply omits `content`).
  const bridgedContentCorrupt = subsection.content === null && BRIDGED_KINDS.has(subsection.contentKind)

  const [title, setTitle] = useState(subsection.title)
  const [offeringWebsite, setOfferingWebsite] = useState(subsection.offeringWebsite)
  const [offeringVa, setOfferingVa] = useState(subsection.offeringVa)
  const [offeringPpc, setOfferingPpc] = useState(subsection.offeringPpc)
  const [intro, setIntro] = useState(subsection.copy?.intro ?? '')
  const [whatWeNeed, setWhatWeNeed] = useState(subsection.copy?.whatWeNeed ?? '')

  const [team, setTeam] = useState<TeamMember[]>(subsection.content && 'team' in subsection.content ? subsection.content.team : [])
  const [process, setProcess] = useState<ContentBlocks>(subsection.content && 'process' in subsection.content ? subsection.content.process : EMPTY_BLOCKS)
  const [why, setWhy] = useState<ContentBlocks>(subsection.content && 'why' in subsection.content ? subsection.content.why : EMPTY_BLOCKS)
  const [seoBase, setSeoBase] = useState<ContentBlocks>(subsection.content && 'seoBase' in subsection.content ? subsection.content.seoBase : EMPTY_BLOCKS)
  const [geoBase, setGeoBase] = useState<ContentBlocks>(subsection.content && 'geoBase' in subsection.content ? subsection.content.geoBase : EMPTY_BLOCKS)
  const [eeatBase, setEeatBase] = useState<ContentBlocks>(subsection.content && 'eeatBase' in subsection.content ? subsection.content.eeatBase : EMPTY_BLOCKS)
  const [processMilestones, setProcessMilestones] = useState<ContentBlocks>(subsection.content && 'processMilestones' in subsection.content ? subsection.content.processMilestones : EMPTY_BLOCKS)
  const [pcIntroText, setPcIntroText] = useState(subsection.content && 'intro' in subsection.content ? subsection.content.intro : '')
  const [genericBlocks, setGenericBlocks] = useState<ContentBlocks>(subsection.content && 'blocks' in subsection.content ? subsection.content.blocks : EMPTY_BLOCKS)

  // Final review fix #2: the ONE resync point for every draft state below —
  // deliberately keyed ONLY on conflictEpoch, not on any `subsection.*`
  // value, so a normal save or an unrelated photo upload elsewhere (which
  // also refetches the tree, changing this subsection's prop identity but
  // not conflictEpoch) leaves an in-progress draft in this panel untouched.
  useEffect(() => {
    setTitle(subsection.title)
    setOfferingWebsite(subsection.offeringWebsite)
    setOfferingVa(subsection.offeringVa)
    setOfferingPpc(subsection.offeringPpc)
    setIntro(subsection.copy?.intro ?? '')
    setWhatWeNeed(subsection.copy?.whatWeNeed ?? '')
    setTeam(subsection.content && 'team' in subsection.content ? subsection.content.team : [])
    setProcess(subsection.content && 'process' in subsection.content ? subsection.content.process : EMPTY_BLOCKS)
    setWhy(subsection.content && 'why' in subsection.content ? subsection.content.why : EMPTY_BLOCKS)
    setSeoBase(subsection.content && 'seoBase' in subsection.content ? subsection.content.seoBase : EMPTY_BLOCKS)
    setGeoBase(subsection.content && 'geoBase' in subsection.content ? subsection.content.geoBase : EMPTY_BLOCKS)
    setEeatBase(subsection.content && 'eeatBase' in subsection.content ? subsection.content.eeatBase : EMPTY_BLOCKS)
    setProcessMilestones(subsection.content && 'processMilestones' in subsection.content ? subsection.content.processMilestones : EMPTY_BLOCKS)
    setPcIntroText(subsection.content && 'intro' in subsection.content ? subsection.content.intro : '')
    setGenericBlocks(subsection.content && 'blocks' in subsection.content ? subsection.content.blocks : EMPTY_BLOCKS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflictEpoch])

  function contentDraft(): WelcomeDraft | StrategyDraft | MilestonesDraft | PcIntroDraft | ContentBlocks | undefined {
    if (bridgedContentCorrupt) return undefined
    switch (subsection.contentKind) {
      case 'welcome': {
        const nextTeam = team.map((member) => {
          const rawEmail = member.email?.trim() ?? ''
          const email = rawEmail ? canonicalMailbox(rawEmail) : null
          if (rawEmail && !email) throw new Error('invalid_email')
          const { email: _email, ...rest } = member
          return { ...rest, ...(email ? { email } : {}) }
        })
        return { team: nextTeam, process, why }
      }
      case 'strategy':
        return { seoBase, geoBase, eeatBase }
      case 'milestones':
        return { processMilestones }
      case 'pc-intro':
        return { intro: pcIntroText }
      case 'generic':
        return genericBlocks
      case 'none':
        return undefined
    }
  }

  async function save() {
    setSaveState('saving')
    // contentDraft() runs INSIDE the mutate callback — a thrown invalid_email
    // (welcome roster) surfaces through the same error path as a failed
    // fetch, never a separate silent catch.
    const ok = await mutate('subsection', () => {
      const content = contentDraft()
      return jsonFetch(`/api/viewbook-templates/sections/${section.id}/subsections/${subsection.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: section.version,
          title,
          offeringWebsite,
          offeringVa,
          offeringPpc,
          copy: { intro: intro.trim() === '' ? null : intro, whatWeNeed: whatWeNeed.trim() === '' ? null : whatWeNeed },
          ...(content !== undefined ? { content } : {}),
        }),
      })
    })
    setSaveState(ok ? 'saved' : 'failed')
    setTimeout(() => setSaveState('idle'), 4000)
  }

  function toggleArchived() {
    void mutate('subsection archive', () => jsonFetch(`/api/viewbook-templates/sections/${section.id}/subsections/${subsection.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: section.version, archived: !archived }),
    }))
  }

  if (archived) {
    return (
      <div data-subsection-key={subsection.subsectionKey} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50/60 p-3 dark:border-navy-border dark:bg-navy-deep/30">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-500 dark:text-white/55">{subsection.title}</span>
          <StatusPill label="Archived" tone="warning" />
        </div>
        <button type="button" onClick={toggleArchived} className={editorSecondaryBtnClass}>Restore</button>
      </div>
    )
  }

  return (
    <div data-subsection-key={subsection.subsectionKey} className={editorWellClass}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <label className={`min-w-0 flex-1 ${editorLabelClass}`}>
          Title
          <input aria-label={`Title — ${subsection.subsectionKey}`} value={title} onChange={(event) => setTitle(event.target.value)} className={`mt-1 ${editorInputClass}`} />
          <span className="mt-1 block text-[11px] text-gray-500 dark:text-white/45">{F2_HELPER_TEXT}</span>
        </label>
        <button type="button" onClick={toggleArchived} className={editorDestructiveBtnClass}>Archive</button>
      </div>

      <div className="mt-3 flex flex-wrap gap-4 text-xs font-medium text-gray-600 dark:text-white/65">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={offeringWebsite} onChange={(event) => setOfferingWebsite(event.target.checked)} className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500 dark:border-navy-border dark:bg-navy-light" />
          Website
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={offeringVa} onChange={(event) => setOfferingVa(event.target.checked)} className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500 dark:border-navy-border dark:bg-navy-light" />
          VA
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={offeringPpc} onChange={(event) => setOfferingPpc(event.target.checked)} className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500 dark:border-navy-border dark:bg-navy-light" />
          PPC
        </label>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className={editorLabelClass}>
          Subsection intro
          <textarea aria-label={`Subsection intro — ${subsection.subsectionKey}`} value={intro} maxLength={SUBSECTION_COPY_CAPS.intro} onChange={(event) => setIntro(event.target.value)} rows={2} className={`mt-1 ${editorTextareaClass}`} />
          <span className="mt-1 block text-[11px] text-gray-500 dark:text-white/45">{intro.length}/{SUBSECTION_COPY_CAPS.intro} · {F2_HELPER_TEXT}</span>
        </label>
        <label className={editorLabelClass}>
          What we need
          <textarea aria-label={`Subsection what-we-need — ${subsection.subsectionKey}`} value={whatWeNeed} maxLength={SUBSECTION_COPY_CAPS.whatWeNeed} onChange={(event) => setWhatWeNeed(event.target.value)} rows={2} className={`mt-1 ${editorTextareaClass}`} />
          <span className="mt-1 block text-[11px] text-gray-500 dark:text-white/45">{whatWeNeed.length}/{SUBSECTION_COPY_CAPS.whatWeNeed} · {F2_HELPER_TEXT}</span>
        </label>
      </div>

      <div className="mt-4 space-y-3">
        {bridgedContentCorrupt ? (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
            This subsection&apos;s stored content is unreadable — contact engineering. Saving is disabled to protect the live content.
          </p>
        ) : (
          <>
            {subsection.contentKind === 'welcome' && (
              <>
                <TeamRoster team={team} setTeam={setTeam} sectionId={section.id} sectionVersion={section.version} mutate={mutate} />
                <BlockList label="Process" blocks={process} setBlocks={setProcess} />
                <BlockList label="Why it matters" blocks={why} setBlocks={setWhy} />
              </>
            )}
            {subsection.contentKind === 'strategy' && (
              <>
                <BlockList label={STRATEGY_BLOCK_TITLES.seoBase} blocks={seoBase} setBlocks={setSeoBase} />
                <BlockList label={STRATEGY_BLOCK_TITLES.geoBase} blocks={geoBase} setBlocks={setGeoBase} />
                <BlockList label={STRATEGY_BLOCK_TITLES.eeatBase} blocks={eeatBase} setBlocks={setEeatBase} />
              </>
            )}
            {subsection.contentKind === 'milestones' && (
              <BlockList label="Process milestones" blocks={processMilestones} setBlocks={setProcessMilestones} />
            )}
            {subsection.contentKind === 'pc-intro' && (
              <label className={editorLabelClass}>
                Welcome copy
                <textarea aria-label="Post-contract welcome" value={pcIntroText} onChange={(event) => setPcIntroText(event.target.value)} rows={3} className={`mt-1 ${editorTextareaClass}`} />
              </label>
            )}
            {subsection.contentKind === 'generic' && (
              <BlockList label="Content blocks" blocks={genericBlocks} setBlocks={setGenericBlocks} />
            )}
          </>
        )}
      </div>

      {section.templateKey === 'data-source' && (
        <div className="mt-4">
          <FieldGrid subsectionId={subsection.id} fields={subsection.fields} sectionVersion={section.version} mutate={mutate} />
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" disabled={saveState === 'saving'} onClick={() => void save()} className={editorPrimaryBtnClass}>
          {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : saveState === 'failed' ? 'Save failed — retry' : 'Save subsection'}
        </button>
        {saveState === 'failed' && (
          <span role="alert" className="text-xs font-semibold text-red-700 dark:text-red-300">See the error at the top of the page.</span>
        )}
      </div>
    </div>
  )
}

function TeamRoster({
  team,
  setTeam,
  sectionId,
  sectionVersion,
  mutate,
}: {
  team: TeamMember[]
  setTeam: (next: TeamMember[]) => void
  sectionId: number
  sectionVersion: number
  mutate: Mutate
}) {
  function set(index: number, patch: Partial<TeamMember>) {
    setTeam(team.map((member, memberIndex) => memberIndex === index ? { ...member, ...patch } : member))
  }

  // Routed through the shared `mutate` (not a bare fetch): the photo route
  // increments the SAME SectionTemplate.version this panel's Save button
  // guards on (attachTemplateTeamPhoto) — skipping the refetch would leave
  // every other control on this page holding a stale version token that the
  // next save would 409 against.
  async function uploadPhoto(index: number, member: TeamMember, file: File) {
    let filename: string | undefined
    const ok = await mutate(`photo for ${member.name}`, async () => {
      const form = new FormData()
      form.set('memberName', member.name)
      form.set('version', String(sectionVersion))
      form.set('file', file)
      const response = await fetch(`/api/viewbook-templates/sections/${sectionId}/photo`, { method: 'POST', body: form })
      const body = (await response.json()) as { error?: string; filename?: string }
      if (!response.ok) throw new Error(body.error || 'upload_failed')
      filename = body.filename
    })
    if (ok && filename) set(index, { photo: filename })
  }

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="font-display text-sm font-bold text-navy dark:text-white">Meet the team</h3>
        <StatusPill label={`${team.length} ${team.length === 1 ? 'member' : 'members'}`} tone="neutral" />
      </div>
      <div className="mt-2 space-y-3 text-sm">
        {team.map((member, index) => (
          <article key={index} data-team-member className="grid gap-3 rounded-lg border border-gray-200 bg-white p-3 sm:grid-cols-2 xl:grid-cols-12 dark:border-navy-border dark:bg-navy-card">
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
                    void uploadPhoto(index, member, file)
                  }}
                />
              </span>
            </label>
            <div className="flex justify-end sm:col-span-2 xl:col-span-12">
              <button type="button" onClick={() => setTeam(team.filter((_, memberIndex) => memberIndex !== index))} className={editorDestructiveBtnClass}>Remove member</button>
            </div>
          </article>
        ))}
        {team.length === 0 && <p className="rounded-lg border border-dashed border-gray-300 p-4 text-center text-gray-500 dark:border-navy-border dark:text-white/55">No team members yet.</p>}
        <button type="button" onClick={() => setTeam([...team, { name: '', role: '', photo: null, blurb: '' }])} className={editorSecondaryBtnClass}>Add member</button>
      </div>
    </section>
  )
}

function BlockList({
  label,
  blocks,
  setBlocks,
}: {
  label: string
  blocks: ContentBlocks
  setBlocks: (next: ContentBlocks) => void
}) {
  function set(index: number, patch: Partial<ContentBlocks['blocks'][number]>) {
    setBlocks({ blocks: blocks.blocks.map((block, blockIndex) => blockIndex === index ? { ...block, ...patch } : block) })
  }

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="font-display text-sm font-bold text-navy dark:text-white">{label}</h3>
        <StatusPill label={`${blocks.blocks.length} ${blocks.blocks.length === 1 ? 'block' : 'blocks'}`} tone="neutral" />
      </div>
      <div className="mt-2 space-y-2 text-sm">
        {blocks.blocks.map((block, index) => (
          <div key={index} className="rounded-lg border border-gray-200 bg-white p-3 dark:border-navy-border dark:bg-navy-card">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className={`min-w-0 flex-1 ${editorLabelClass}`}>
                Heading
                <input value={block.heading} onChange={(event) => set(index, { heading: event.target.value })} placeholder="Heading" className={`mt-1 ${editorInputClass}`} />
              </label>
              <button type="button" onClick={() => setBlocks({ blocks: blocks.blocks.filter((_, blockIndex) => blockIndex !== index) })} className={editorDestructiveBtnClass}>Remove block</button>
            </div>
            <label className={`mt-2 ${editorLabelClass}`}>
              Body
              <textarea value={block.body} onChange={(event) => set(index, { body: event.target.value })} rows={2} placeholder="Body" className={`mt-1 ${editorTextareaClass}`} />
            </label>
          </div>
        ))}
        {blocks.blocks.length === 0 && <p className="rounded-lg border border-dashed border-gray-300 p-3 text-center text-gray-500 dark:border-navy-border dark:text-white/55">No content blocks yet.</p>}
        <button type="button" onClick={() => setBlocks({ blocks: [...blocks.blocks, { heading: '', body: '' }] })} className={editorSecondaryBtnClass}>Add block</button>
      </div>
    </section>
  )
}
