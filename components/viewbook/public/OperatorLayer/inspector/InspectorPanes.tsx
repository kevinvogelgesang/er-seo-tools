'use client'

import { useEffect, useState } from 'react'
import { SECTION_TITLES } from '@/components/viewbook/public/section-titles'
import type { OperatorViewbookData } from '@/lib/viewbook/operator-data'
import type { SectionKey } from '@/lib/viewbook/theme'
import { InlineSectionEditors } from '../InlineEditors'
import { useSelectionContext } from './SelectionContext'
import { useSectionSelection } from './useSectionSelection'

export interface InspectorPanesProps { viewbookId: number; operatorData: OperatorViewbookData }

function readCanvasOrder(): SectionKey[] {
  if (typeof document === 'undefined') return []
  return Array.from(document.querySelectorAll<HTMLElement>('[data-operator-section]'))
    .map((node) => node.dataset.operatorSection as SectionKey | undefined)
    .filter((key): key is SectionKey => Boolean(key))
}

// PR3: one visibility-flipped pane per ELIGIBLE section, ALL permanently mounted
// (C5 — never conditionally unmounted on selection; drafts/timers/conflict all
// survive). The active pane is `hidden`/`inert` cleared; every other pane is
// hidden + inert. Selection is READ only — pin policy lives solely in
// SelectionContext (never a competing guard here).
export function InspectorPanes({ viewbookId, operatorData }: InspectorPanesProps) {
  const { selectedKey } = useSelectionContext()

  // The scroll-spy target lineup lives in the CANVAS DOM (fix #6 — DB/section
  // order is NOT the lineup order; rows load by id and can be hidden/out-of-
  // stage). Read `[data-operator-section]` in document order after commit,
  // signature-compared (join('|')) so the state only changes when the lineup
  // actually changes — feeding both scroll-spy AND the null-selection seed.
  const [canvasOrder, setCanvasOrder] = useState<SectionKey[]>([])
  useEffect(() => {
    const sync = () => {
      const next = readCanvasOrder()
      setCanvasOrder((prev) => (prev.join('|') === next.join('|') ? prev : next))
    }
    sync()
    if (typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  useSectionSelection(canvasOrder)

  // Eligible panes = every section EXCEPT `pc-thanks` while completion is unset
  // (fix #5 — an inert thanks pane must not exist pre-completion, mirroring the
  // domain gate SectionQuickControls / SectionOutline already apply).
  const eligibleSections = operatorData.sections.filter(
    (section) => !(section.sectionKey === 'pc-thanks' && operatorData.pcCompletedAt === null),
  )
  const eligibleKeys = new Set(eligibleSections.map((section) => section.sectionKey))

  // Active key: an explicit selection wins (only when it's an eligible pane);
  // otherwise seed from the FIRST canvas target that is eligible (fix #4 — NEVER
  // index sections[0]; rows load by id and index-0 could be hidden/out-of-stage,
  // and an empty fixture would crash on [0]). No target yet / no eligible panes
  // → null → the neutral "Select a section" empty state.
  const seededKey = canvasOrder.find((key) => eligibleKeys.has(key)) ?? null
  const activeKey = selectedKey && eligibleKeys.has(selectedKey) ? selectedKey : seededKey

  const activeTitle = activeKey ? SECTION_TITLES[activeKey] : null

  return (
    <div role="region" aria-label="Section editors" data-vb-inspector-panes>
      {/* Matches the outline's "Sections" heading; the active section name below
          it makes the Edit region distinct + tells you what you're editing. */}
      <div className="sticky top-0 z-[1] border-b border-gray-200 bg-gray-50/95 px-4 py-3 backdrop-blur-sm dark:border-navy-border dark:bg-navy-card/80">
        <h2 className="font-display text-sm font-semibold text-navy dark:text-white">Edit</h2>
        <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-white/55">
          {activeTitle ?? 'Select a section'}
        </p>
      </div>
      {activeKey === null && (
        <p data-vb-inspector-empty className="px-4 py-6 font-body text-sm text-gray-500 dark:text-white/55">
          Select a section to edit.
        </p>
      )}
      {eligibleSections.map((section) => {
        const isActive = section.sectionKey === activeKey
        return (
          <div
            key={section.sectionKey}
            data-vb-inspector-pane={section.sectionKey}
            hidden={!isActive}
            inert={!isActive}
          >
            <InlineSectionEditors viewbookId={viewbookId} section={section} operatorData={operatorData} />
          </div>
        )
      })}
    </div>
  )
}
