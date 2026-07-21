'use client'

// PR7 Task 9: the floating right-edge Table-of-Contents rail (spec §7). A
// `'use client'` LEAF island rendered by the SERVER ViewbookShell — it takes
// ONLY serializable props (a prebuilt TOC index + search index + a verbose
// flag), NEVER a function prop, so the RSC boundary stays clean. It reads
// nothing operator-only: identical behavior in the anonymous and operator
// branches (public, presentation-agnostic).
//
// Collapsed = a column of dots on the right edge; hover/focus/tap expands it
// into a labeled card. Each entry carries a done glyph (filled --vb-tertiary)
// or acked glyph (hollow --vb-secondary). Activating an entry (click / Enter /
// Space) fires navigateToAnchor → the owning SectionReveal force-expands and
// the page scrolls + flashes the target.
//
// Keyboard: role="navigation", a roving-tabindex list (ArrowUp/Down move
// focus, Enter/Space activate — native <button>, Escape collapses + returns
// focus to the trigger).
//
// Mobile (< 768px, read via matchMedia in an EFFECT with an SSR-safe desktop
// default — NEVER during render): a bottom-sheet opened by a FAB.
//
// Search (verbose only): an input[type=search] filters the search index via
// searchViewbook; a hit navigates like any entry.
//
// LIGHT-ONLY: no dark-mode variants — the public viewbook never participates in
// app dark mode. Color comes from --vb-* CSS vars only.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SearchEntry, TocEntry } from '@/lib/viewbook/toc-index'
import { searchViewbook } from '@/lib/viewbook/toc-index'
import type { SectionStatus } from '@/lib/viewbook/section-status'
import type { SectionKey } from '@/lib/viewbook/theme'
import { navigateToAnchor } from './viewbook-navigate'

// Desktop rail: permanently expanded (Kevin, 2026-07-17). The hamburger
// collapse toggle + Escape-collapse are gated off so the rail stays open on
// desktop; flip this back to `true` to restore the collapsible hamburger rail.
// (Mobile keeps its FAB + bottom-sheet regardless.)
const DESKTOP_RAIL_COLLAPSIBLE = false

// A flattened nav item — top-level section entries plus (verbose) their
// category sub-entries, in DOM order, so the roving-tabindex list is a single
// linear sequence.
interface NavItem {
  sectionKey: SectionKey
  label: string
  anchor: string
  done: boolean
  acked: boolean
  status: SectionStatus
  isChild: boolean
}

const RAIL_STYLE = `
  .vb-flash { border-radius: 10px; animation: vb-flash-pulse 1.2s ease-out; }
  @keyframes vb-flash-pulse {
    0% { box-shadow: 0 0 0 3px var(--vb-secondary); background-color: color-mix(in srgb, var(--vb-secondary) 18%, transparent); }
    100% { box-shadow: 0 0 0 0 transparent; background-color: transparent; }
  }
  .vb-toc-label { transition: opacity 160ms ease, transform 160ms ease; }
  .vb-toc-sheet { transition: transform 220ms ease; }
  [data-vb-toc-section][data-vb-active="true"] {
    box-shadow: inset 3px 0 0 var(--vb-secondary);
    background-color: color-mix(in srgb, var(--vb-secondary) 12%, transparent);
  }
  [data-vb-active="true"] [data-vb-glyph] {
    border-color: var(--vb-secondary) !important;
    background: var(--vb-secondary) !important;
    color: var(--vb-on-secondary) !important;
  }
  @media (prefers-reduced-motion: reduce) {
    .vb-flash { animation: none; outline: 3px solid var(--vb-secondary); outline-offset: 2px; }
    .vb-toc-label, .vb-toc-sheet { transition: none; }
  }
`

function Glyph({ status }: { status: SectionStatus }) {
  // Complete = check; current/needs-input = ring; upcoming = neutral dot.
  // aria-hidden — visible status text elsewhere carries the semantics.
  if (status === 'complete') {
    return (
      <span
        aria-hidden
        data-vb-glyph="complete"
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
        style={{ background: 'var(--vb-tertiary)', color: 'var(--vb-on-tertiary)' }}
      >
        ✓
      </span>
    )
  }
  if (status === 'current' || status === 'needs-input') {
    return (
      <span
        aria-hidden
        data-vb-glyph={status}
        className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border-2 bg-transparent"
        style={{ borderColor: status === 'current' ? 'var(--vb-secondary)' : 'var(--vb-primary)' }}
      />
    )
  }
  return (
    <span
      aria-hidden
      data-vb-glyph="upcoming"
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ background: 'rgba(0,0,0,0.2)' }}
    />
  )
}

export function TocRail({
  toc,
  searchIndex,
  verbose,
}: {
  toc: TocEntry[]
  searchIndex: SearchEntry[]
  verbose: boolean
}) {
  // SSR-safe defaults — NO window read in the initializers (see the hydration
  // note in the file header). The mobile branch and open state settle in
  // effects / on interaction after mount.
  const [isMobile, setIsMobile] = useState(false)
  const [open, setOpen] = useState(true) // desktop rail expanded (labels shown) by default; the hamburger is the sole collapse toggle
  const [sheetOpen, setSheetOpen] = useState(false) // mobile bottom-sheet
  const [activeIndex, setActiveIndex] = useState(0)
  const [query, setQuery] = useState('')

  const triggerRef = useRef<HTMLButtonElement>(null)
  const fabRef = useRef<HTMLButtonElement>(null)
  const railRef = useRef<HTMLElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  const items = useMemo<NavItem[]>(() => {
    const out: NavItem[] = []
    for (const entry of toc) {
      out.push({
        sectionKey: entry.sectionKey,
        label: entry.label,
        anchor: entry.anchor,
        done: entry.done,
        acked: entry.acked,
        status: entry.status,
        isChild: false,
      })
      if (verbose && entry.children) {
        for (const child of entry.children) {
          out.push({
            sectionKey: entry.sectionKey,
            label: child.label,
            anchor: child.anchor,
            done: false,
            acked: false,
            status: entry.status,
            isChild: true,
          })
        }
      }
    }
    return out
  }, [toc, verbose])

  const hits = useMemo<SearchEntry[]>(() => {
    if (!verbose) return []
    const q = query.trim()
    if (!q) return []
    return searchViewbook(searchIndex, q, 8)
  }, [verbose, query, searchIndex])

  // Mobile branch — read matchMedia in an effect ONLY (SSR default desktop).
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(max-width: 767px)')
    const update = () => setIsMobile(mq.matches)
    update()
    mq.addEventListener?.('change', update)
    return () => mq.removeEventListener?.('change', update)
  }, [])

  const activate = useCallback((item: { sectionKey: SectionKey; anchor: string }) => {
    navigateToAnchor(item.sectionKey, item.anchor)
    // Desktop rail defaults open and stays open on navigation — only the
    // hamburger trigger (or Escape) collapses it. The mobile bottom-sheet
    // still closes after navigating, since it covers the viewport.
    setSheetOpen(false)
  }, [])

  const moveFocus = useCallback(
    (delta: number) => {
      setActiveIndex((cur) => {
        const next = Math.min(items.length - 1, Math.max(0, cur + delta))
        itemRefs.current[next]?.focus()
        return next
      })
    },
    [items.length],
  )

  const onListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        moveFocus(1)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        moveFocus(-1)
      }
    },
    [moveFocus],
  )

  const collapse = useCallback(
    (returnFocusTo: React.RefObject<HTMLButtonElement | null>) => {
      setOpen(false)
      setSheetOpen(false)
      returnFocusTo.current?.focus()
    },
    [],
  )

  // Shared item list — used by both the desktop rail and the mobile sheet. The
  // roving-tabindex refs (itemRefs) are shared because only ONE of the two
  // branches mounts the list at a time (isMobile).
  const itemList = (
    <ul data-vb-toc-list className="flex flex-col gap-1">
      {items.map((item, i) => (
        <li key={`${item.anchor}-${i}`}>
          <button
            type="button"
            ref={(el) => {
              itemRefs.current[i] = el
            }}
            data-vb-toc-entry
            data-vb-toc-section={item.isChild ? undefined : item.sectionKey}
            data-anchor={item.anchor}
            data-vb-done={item.done ? 'true' : 'false'}
            data-vb-acked={item.acked ? 'true' : 'false'}
            tabIndex={i === activeIndex ? 0 : -1}
            onFocus={() => setActiveIndex(i)}
            onClick={() => activate(item)}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-black/5 ${
              item.isChild ? 'pl-6 text-black/60' : 'font-medium text-black/80'
            }`}
          >
            {!item.isChild && <Glyph status={item.status} />}
            <span className="vb-toc-label min-w-0 truncate">{item.label}</span>
          </button>
        </li>
      ))}
    </ul>
  )

  const searchBox = verbose ? (
    <div className="mb-2">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search this viewbook…"
        aria-label="Search this viewbook"
        className="w-full rounded-md border border-black/15 bg-white px-2 py-1 text-sm text-black/80 outline-none focus:border-black/40"
      />
      {hits.length > 0 && (
        <ul className="mt-1 flex flex-col gap-0.5">
          {hits.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                data-vb-search-hit
                data-anchor={hit.anchor}
                onClick={() => activate({ sectionKey: hit.sectionKey, anchor: hit.anchor })}
                className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-sm text-black/75 hover:bg-black/5"
              >
                <span className="min-w-0 truncate">{hit.label}</span>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-black/40">
                  {hit.kind}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  ) : null

  // ---- Mobile: FAB + bottom-sheet ------------------------------------------
  if (isMobile) {
    return (
      <>
        <style>{RAIL_STYLE}</style>
        <button
          type="button"
          ref={fabRef}
          data-vb-toc-fab
          aria-label="Table of contents"
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen((v) => !v)}
          className="fixed bottom-5 right-5 z-50 flex h-12 items-center justify-center gap-2 rounded-full px-4 shadow-lg"
          style={{ background: 'var(--vb-primary)', color: 'var(--vb-on-primary)' }}
        >
          <span aria-hidden className="text-lg font-bold">
            ☰
          </span>
          <span className="text-sm font-semibold">Sections</span>
        </button>
        {sheetOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/30"
            onClick={() => setSheetOpen(false)}
            aria-hidden
          />
        )}
        <nav
          data-vb-toc-nav
          data-vb-open={sheetOpen ? 'true' : 'false'}
          aria-label="Section navigation"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              collapse(fabRef)
            } else {
              onListKeyDown(e)
            }
          }}
          className="vb-toc-sheet fixed inset-x-0 bottom-0 z-50 max-h-[70vh] overflow-y-auto rounded-t-2xl border-t border-black/10 bg-white p-4 shadow-2xl"
          style={{ transform: sheetOpen ? 'translateY(0)' : 'translateY(100%)' }}
          hidden={!sheetOpen}
        >
          {searchBox}
          {itemList}
        </nav>
      </>
    )
  }

  // ---- Desktop: right-edge rail --------------------------------------------
  return (
    <>
      <style>{RAIL_STYLE}</style>
      <nav
        ref={railRef}
        data-vb-toc-nav
        data-vb-open={open ? 'true' : 'false'}
        aria-label="Section navigation"
        // Hamburger-persistent (codex-review P2-3, Kevin's decision): open/
        // close state is owned SOLELY by the hamburger trigger below (and
        // Escape). No onMouseEnter/onMouseLeave/onBlur here — the rail must
        // NOT auto-open on hover or auto-collapse on mouse-leave/blur; moving
        // the mouse in and out of the rail is a no-op for `open`. The inner
        // onFocus below is kept as a focus-safety net (see there), not a
        // hover/blur behavior.
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            // Escape only collapses when the rail is collapsible; on the
            // permanently-expanded desktop rail there is nothing to collapse.
            if (DESKTOP_RAIL_COLLAPSIBLE) {
              e.preventDefault()
              collapse(triggerRef)
            }
          } else {
            onListKeyDown(e)
          }
        }}
        className="fixed left-3 top-1/2 z-40 -translate-y-1/2"
      >
        {DESKTOP_RAIL_COLLAPSIBLE && (
          <button
            type="button"
            ref={triggerRef}
            data-vb-toc-trigger
            aria-label="Table of contents"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="mb-1 mr-auto flex h-8 w-8 items-center justify-center rounded-full border border-black/10 bg-white/90 shadow-sm"
            style={{ color: 'var(--vb-primary)' }}
          >
            <span aria-hidden className="text-sm font-bold">
              ☰
            </span>
          </button>
        )}
        <div
          // Focus-safety, not hover behavior: if the rail was hamburger-
          // collapsed (40px) and a user tabs a focusable control inside it
          // (e.g. from the trigger into the list), force it open so the
          // focused control isn't clipped by the collapsed width. This does
          // NOT re-introduce hover/blur-driven state — mouse in/out and
          // blur-out no longer touch `open` at all. Inert when the rail is
          // permanently expanded (always open).
          onFocus={() => setOpen(true)}
          className="rounded-xl border border-black/10 bg-white/95 p-2 shadow-lg backdrop-blur"
          style={{
            width: DESKTOP_RAIL_COLLAPSIBLE ? (open ? 240 : 40) : 240,
            transition: 'width 200ms ease',
            overflow: 'hidden',
          }}
        >
          {searchBox}
          {itemList}
        </div>
      </nav>
    </>
  )
}
