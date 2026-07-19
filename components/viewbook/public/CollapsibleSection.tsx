'use client'

// PR3 Task 3: the client island that gives every viewer an in-hero
// expand/collapse control. Effective collapse comes from useCollapseState
// (personal override wins over the shared default). Writes:
//   - client expand  → personal only (localStorage override), NO fetch
//   - client collapse → shared write {collapsed:true} (open to any token holder)
//   - operator expand → shared write {collapsed:false} (operator-only per the
//     PR2 route — a non-operator can never reach this branch since the
//     "Collapse for everyone" control this island renders when EXPANDED is
//     the only shared-collapse entry point; operators additionally get the
//     shared-expand affordance while collapsed)
//
// The controlled region is ALWAYS rendered (Codex FIX-7): collapse toggles
// hidden/inert/aria-hidden, never DOM presence, so `aria-controls` always
// resolves to a real element regardless of collapsed state.
//
// This island does NOT emit `data-operator-section` — OperatorSectionWrapper
// (rendered OUTSIDE every section component, server-side in the page) already
// owns that single scroll-spy marker (Codex FIX-8).
import { useEffect, type ReactNode } from 'react'
import { CollapseAffordance } from './CollapseAffordance'
import type { CollapseAffordanceKind } from '@/lib/viewbook/presentation-config'
import { useCollapseState } from './useCollapseState'

export function CollapsibleSection({
  viewbookId,
  token,
  sectionKey,
  collapsedShared,
  isOperator,
  affordance,
  heroExpanded,
  heroCollapsed,
  body,
  regionId,
  previewMode = false,
}: {
  viewbookId: number
  token: string
  sectionKey: string
  collapsedShared: boolean
  isOperator: boolean
  affordance: CollapseAffordanceKind
  heroExpanded: ReactNode // full hero (image+overlay+title+done check)
  heroCollapsed: ReactNode // shrunken hero variant
  body: ReactNode // SectionReveal body — ALWAYS rendered, hidden when collapsed
  regionId: string
  previewMode?: boolean // ThemePreview: render visuals but NEVER POST (FIX-8)
}) {
  const {
    collapsed,
    pending,
    beginPending,
    endPending,
    setPersonalExpanded,
    forceExpandedLocal,
    clearPersonalOverride,
    restorePersonalOverride,
    setCollapsedOptimistic,
  } = useCollapseState({ viewbookId, sectionKey, collapsedShared })

  useEffect(() => {
    // vb:navigate / hash → force-open (in-memory, not persisted).
    function onNav(e: Event) {
      const d = (e as CustomEvent).detail as { sectionKey?: string } | null
      if (d?.sectionKey === sectionKey) forceExpandedLocal()
    }
    window.addEventListener('vb:navigate', onNav)
    if (window.location.hash === `#${sectionKey}`) forceExpandedLocal()
    return () => window.removeEventListener('vb:navigate', onNav)
  }, [sectionKey, forceExpandedLocal])

  async function writeShared(nextCollapsed: boolean): Promise<boolean> {
    const res = await fetch(`/api/viewbook/${token}/collapse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sectionKey, collapsed: nextCollapsed }),
    })
    return res.ok
  }

  async function onCollapse() {
    if (previewMode) {
      setCollapsedOptimistic(true)
      return
    }
    if (!beginPending()) return // synchronous double-fire guard (FIX-5)
    setCollapsedOptimistic(true)
    const prevOverride = clearPersonalOverride() // snapshot for rollback (FIX-6)
    try {
      if (!(await writeShared(true))) throw new Error('collapse_failed')
    } catch {
      setCollapsedOptimistic(false)
      restorePersonalOverride(prevOverride) // restore localStorage too
    } finally {
      endPending()
    }
  }

  async function onExpand() {
    if (previewMode) {
      setCollapsedOptimistic(false)
      return
    }
    if (!isOperator) {
      setPersonalExpanded() // client expand = personal, no fetch
      return
    }
    if (!beginPending()) return
    setCollapsedOptimistic(false)
    try {
      if (!(await writeShared(false))) throw new Error('expand_failed')
      clearPersonalOverride()
    } catch {
      setCollapsedOptimistic(true)
    } finally {
      endPending()
    }
  }

  const expandName = isOperator ? 'Expand (visible to everyone)' : 'Expand (just for you)'

  return (
    <div>
      {collapsed ? (
        // The whole shrunken hero is a click target (not just the affordance
        // button) — a plain (non-semantic) onClick on this wrapper, with the
        // REAL accessible control being the CollapseAffordance button inside
        // (which stops propagation so one click doesn't double-invoke).
        <div className="relative cursor-pointer" onClick={onExpand}>
          {heroCollapsed}
          <CollapseAffordance
            kind={affordance}
            regionId={regionId}
            accessibleName={expandName}
            onExpand={onExpand}
            disabled={pending}
          />
        </div>
      ) : (
        <div className="relative">
          {heroExpanded}
          {/* Shared-collapse is open to ANY token holder (PR2 route) — not
              gated on isOperator. Positioned bottom-right to avoid colliding
              with the top-right done badge (SectionShell). */}
          <button
            type="button"
            aria-expanded="true"
            aria-controls={regionId}
            disabled={pending}
            onClick={onCollapse}
            className="absolute bottom-4 right-4 z-[3] rounded-full border border-white/30 bg-black/25 px-3.5 py-1.5 text-xs font-semibold text-white shadow-md transition hover:bg-black/35 disabled:opacity-50"
          >
            Collapse for everyone
          </button>
        </div>
      )}
      {/* Region ALWAYS present; hidden+inert while collapsed so aria-controls
          resolves (FIX-7). `inert` (React 19 boolean) + aria-hidden +
          display:none is the tab-order/a11y guard incl. older engines. */}
      <div
        id={regionId}
        role="region"
        aria-hidden={collapsed ? true : undefined}
        inert={collapsed}
        hidden={collapsed}
        style={collapsed ? { display: 'none' } : undefined}
      >
        {body}
      </div>
    </div>
  )
}
