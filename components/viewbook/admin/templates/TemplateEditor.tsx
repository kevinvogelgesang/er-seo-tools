'use client'

// F1b Task 9 — the section template library editor for /viewbooks/settings.
// Replaces GlobalContentEditor + SectionCopyEditor: the 13-section tree read
// via GET /api/viewbook-templates, edited through the Task 8 mutation routes.
import { useCallback, useEffect, useState } from 'react'
import { StatusPill } from '@/components/ui/StatusPill'
import { jsonFetch } from '../viewbook-admin-shared'
import { SectionPanel } from './SectionPanel'
import type { TemplateTree } from './template-editor-types'

export function TemplateEditor() {
  const [tree, setTree] = useState<TemplateTree | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await jsonFetch<TemplateTree>('/api/viewbook-templates')
      setTree(data)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'load_failed')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Shared mutation helper (GlobalContentEditor's `run`, F1b-adapted): every
  // mutation — patches, creates, the photo POST — refetches the tree on
  // success so every open panel reflects the new version tokens, and ALSO
  // refetches (with a distinct notice, not the generic error banner) on a
  // 409 version_conflict, since the caller's stale local version guarantees
  // its next save would just conflict again.
  const mutate = useCallback(async (label: string, fn: () => Promise<unknown>): Promise<boolean> => {
    void label
    setError(null)
    setNotice(null)
    try {
      await fn()
      await load()
      return true
    } catch (caught) {
      if (caught instanceof Error && caught.message === 'version_conflict') {
        setNotice('Someone else edited this — reloaded latest.')
        await load()
        return false
      }
      setError(caught instanceof Error ? caught.message : 'save_failed')
      return false
    }
  }, [load])

  async function move(sectionId: number, direction: -1 | 1) {
    if (!tree) return
    const sections = tree.sections
    const index = sections.findIndex((s) => s.id === sectionId)
    const swapIndex = index + direction
    if (index < 0 || swapIndex < 0 || swapIndex >= sections.length) return
    const a = sections[index]
    const b = sections[swapIndex]
    await mutate('reorder', () => jsonFetch('/api/viewbook-templates/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [
          { id: a.id, version: a.version, sortOrder: b.sortOrder },
          { id: b.id, version: b.version, sortOrder: a.sortOrder },
        ],
      }),
    }))
  }

  if (!tree && !error) return <p className="text-sm text-gray-400 dark:text-white/40">Loading…</p>

  return (
    <div className="space-y-6 font-body">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill label="Template library" tone="warning" />
          <h2 className="font-display text-base font-bold text-amber-950 dark:text-amber-100">Affects every viewbook</h2>
        </div>
        <p className="mt-1.5 text-sm text-amber-800 dark:text-amber-200/80">
          Changes here update the section template rendered into every viewbook once F2 cuts the renderer over.
          Bridged fields (copy, team roster, process/why, strategy foundations, milestones) already render
          everywhere today via the legacy company-wide content; per-viewbook overrides remain separate.
        </p>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
      {notice && <p aria-live="polite" className="rounded-lg bg-blue-50 p-3 text-sm text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">{notice}</p>}
      {tree && tree.sections.map((section, index) => (
        <SectionPanel
          key={section.id}
          section={section}
          mutate={mutate}
          onMoveUp={index > 0 ? () => void move(section.id, -1) : undefined}
          onMoveDown={index < tree.sections.length - 1 ? () => void move(section.id, 1) : undefined}
        />
      ))}
    </div>
  )
}
