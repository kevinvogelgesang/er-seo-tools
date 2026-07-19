// @vitest-environment jsdom
// Regression coverage for the Codex-review finding: EarlierSteps must render
// INSIDE the body-font-scoped wrapper (the div carrying
// `fontFamily: var(--vb-body-font)`), not after it — otherwise carried
// sections silently fall back to the app default font.
import { render, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'
import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { ViewbookShell } from './ViewbookShell'
import { StickyOffsetProbe } from './StickyOffsetProbe'
import { __resetSyncRegistry } from './useViewbookSync'

// ViewbookShell now mounts ViewbookSyncClient (PR2 Task 6), a 'use client'
// island that calls useRouter() — this test renders outside an app router.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))

// Task 5: StickyOffsetProbe is a real 'use client' leaf (renders null) — mock
// it so we can assert ViewbookShell mounts it EXACTLY ONCE per render,
// regardless of which branch (anonymous vs operator) is rendering it.
vi.mock('./StickyOffsetProbe', () => ({ StickyOffsetProbe: vi.fn(() => null) }))

afterEach(() => {
  cleanup()
  __resetSyncRegistry()
  vi.unstubAllGlobals()
  vi.mocked(StickyOffsetProbe).mockClear()
})

const sec = (sectionKey: PublicSection['sectionKey']): PublicSection => ({
  sectionKey,
  state: 'active',
  collapsedShared: false,
  doneAt: null,
  acknowledgedAt: null,
  introNote: null,
  narrative: null,
})

const data = (over: Partial<ViewbookPublicData> = {}): ViewbookPublicData => ({
  viewbookId: 1,
  clientName: 'Acme',
  displayName: 'Acme',
  csmName: null,
  kind: 'upgrade',
  welcomeNote: null,
  dataLockedAt: null,
  theme: DEFAULT_THEME,
  stage: 'building',
  stageLabel: 'Now Building',
  syncVersion: 0,
  pcCompletedAt: null,
  clientNotifyJson: [],
  teamMembers: [],
  primarySections: [],
  carriedSections: [],
  fieldCategories: [],
  milestones: [],
  materials: [],
  docs: { global: [], own: [] },
  global: { team: null, pcIntro: null, blocks: {} },
  overrides: {},
  ...over,
})

describe('ViewbookShell', () => {
  it('renders carried sections as a descendant of the body-font-scoped element', () => {
    const { container } = render(
      <ViewbookShell
        token="tok"
        data={data({
          primarySections: [sec('strategy')],
          carriedSections: [sec('brand')],
        })}
        primarySections={[sec('strategy')]}
        carriedSections={[sec('brand')]}
        renderSection={(s) => <p data-testid={`section-${s.sectionKey}`}>{s.sectionKey} body</p>}
      />,
    )

    // Locate the element that actually carries the --vb-body-font style —
    // don't hardcode which DOM node it is, just find it by its inline style.
    const fontScoped = Array.from(container.querySelectorAll<HTMLElement>('*')).find(
      (el) => el.style.fontFamily === 'var(--vb-body-font)',
    )
    expect(fontScoped).toBeDefined()

    const carriedNode = container.querySelector('[data-testid="section-brand"]')
    expect(carriedNode).not.toBeNull()

    // The carried section must be a DOM descendant of the font-scoped element
    // (not a sibling rendered after it) — this is the regression the Codex
    // finding flagged.
    expect(fontScoped!.contains(carriedNode)).toBe(true)

    // Sanity: the primary section is (and always was) inside the same scope.
    const primaryNode = container.querySelector('[data-testid="section-strategy"]')
    expect(fontScoped!.contains(primaryNode)).toBe(true)
  })

  it('renders nothing extra when there are no carried sections (EarlierSteps stays a no-op)', () => {
    const { container } = render(
      <ViewbookShell
        token="tok"
        data={data({ primarySections: [sec('welcome')] })}
        primarySections={[sec('welcome')]}
        carriedSections={[]}
        renderSection={(s) => <p data-testid={`section-${s.sectionKey}`}>{s.sectionKey} body</p>}
      />,
    )
    expect(container.querySelector('details')).toBeNull()
  })
})

// Task 5: sticky-chrome ids, z-index order, theme-root marker + single probe
// mount. The probe reads/writes CSS vars off `[data-vb-theme-root]` and
// measures `#vb-progress-nav`/`#vb-operator-bar` — ViewbookShell owns all
// three responsibilities exactly once (it renders in both the anonymous and
// operator branches, so a second mount elsewhere would double-write).
describe('ViewbookShell sticky chrome (Task 5)', () => {
  it('marks the themed root with data-vb-theme-root and keeps the --vb-* theme vars on it', () => {
    const { container } = render(
      <ViewbookShell
        token="tok"
        data={data({ primarySections: [sec('welcome')] })}
        primarySections={[sec('welcome')]}
        carriedSections={[]}
        renderSection={(s) => <p data-testid={`section-${s.sectionKey}`}>{s.sectionKey} body</p>}
      />,
    )

    const themeRoot = container.querySelector<HTMLElement>('[data-vb-theme-root]')
    expect(themeRoot).not.toBeNull()
    // The DEFAULT_THEME primary color must still land on the marked element
    // (Lane 2's live-theme store targets this same node — the marker and the
    // theme vars must be co-located, not just both present somewhere).
    expect(themeRoot!.style.getPropertyValue('--vb-primary')).not.toBe('')
    // Pre-hydration fallback so sticky pinning is sane before the probe runs;
    // must stay a plain (non-!important) inline value so the live-theme
    // store can override it later.
    expect(themeRoot!.style.getPropertyValue('--vb-sticky-offset')).toBe('64px')
    expect(themeRoot!.style.getPropertyPriority('--vb-sticky-offset')).toBe('')
  })

  it('mounts exactly one StickyOffsetProbe', () => {
    render(
      <ViewbookShell
        token="tok"
        data={data({ primarySections: [sec('welcome')] })}
        primarySections={[sec('welcome')]}
        carriedSections={[]}
        renderSection={(s) => <p data-testid={`section-${s.sectionKey}`}>{s.sectionKey} body</p>}
      />,
    )

    expect(vi.mocked(StickyOffsetProbe)).toHaveBeenCalledTimes(1)
  })

  it('renders #vb-progress-nav', () => {
    const { container } = render(
      <ViewbookShell
        token="tok"
        data={data({ primarySections: [sec('welcome')] })}
        primarySections={[sec('welcome')]}
        carriedSections={[]}
        renderSection={(s) => <p data-testid={`section-${s.sectionKey}`}>{s.sectionKey} body</p>}
      />,
    )
    expect(container.querySelector('#vb-progress-nav')).not.toBeNull()
  })
})

// Task 9: footer-whitespace regression guard.
//
// ROOT CAUSE (confirmed, resolved by Task 2 / commit daf4477): the deleted
// scroll-collapse IntersectionObserver called setExpanded(false) as a section
// scrolled out of view, driving `.vb-reveal` to `grid-template-rows: 0fr` and
// dynamically SHRINKING in-flow document height while the viewport scroll
// offset stayed put — leaving a blank band below the <footer>. Worst on stage
// round-trips, which surface more done/acked (collapse-eligible) sections for
// the observer to shrink as you scroll. Body visibility is now STATE-ONLY:
// collapsed sections render at their correct (short) height from first paint
// and never shrink under scroll, so no post-footer gap can open.
//
// jsdom has no layout engine, so this cannot assert pixels. Instead it guards
// the residual-free STRUCTURE the fix depends on: the <footer> is the last
// in-flow (box-generating) child of the theme root. Everything React renders
// after it — the TocRail island — must be either a <style> (no box) or
// position:fixed (out of flow, zero document height). This fails, non-
// vacuously, if a future change (a) inserts any in-flow element below the
// footer [the classic "post-footer island" whitespace regression] or (b)
// makes the TocRail root static/sticky so it would add flow height under the
// footer. The following-sibling set is asserted NON-EMPTY (TocRail really does
// render after the footer) so the guard cannot pass by there being nothing to
// check.
describe('ViewbookShell footer whitespace (Task 9)', () => {
  function isOutOfFlow(el: Element): boolean {
    // Tailwind `fixed` (jsdom applies no stylesheet, so check the class token)
    // OR an explicit inline position:fixed. A <style> element generates no box.
    return (
      el.tagName === 'STYLE' ||
      el.classList.contains('fixed') ||
      (el as HTMLElement).style?.position === 'fixed'
    )
  }

  it('footer is the last in-flow child of the theme root — nothing in-flow renders below it', () => {
    const { container } = render(
      <ViewbookShell
        token="tok"
        data={data({
          stage: 'building',
          primarySections: [sec('milestones'), sec('materials')],
          carriedSections: [sec('welcome'), sec('strategy')],
        })}
        primarySections={[sec('milestones'), sec('materials')]}
        carriedSections={[sec('welcome'), sec('strategy')]}
        renderSection={(s) => <p data-testid={`section-${s.sectionKey}`}>{s.sectionKey} body</p>}
      />,
    )

    const themeRoot = container.querySelector<HTMLElement>('[data-vb-theme-root]')
    expect(themeRoot).not.toBeNull()

    const footer = themeRoot!.querySelector<HTMLElement>(':scope > footer')
    expect(footer).not.toBeNull()

    // Everything the shell renders after the footer, at the theme-root level.
    const after: Element[] = []
    for (let el = footer!.nextElementSibling; el; el = el.nextElementSibling) {
      after.push(el)
    }

    // Non-vacuous: the TocRail island really does render after the footer.
    expect(after.length).toBeGreaterThan(0)

    // …and every one of those trailing elements is out of flow (adds no
    // document height below the footer). A single in-flow element here is the
    // footer-whitespace regression.
    const inFlowBelowFooter = after.filter((el) => !isOutOfFlow(el))
    expect(inFlowBelowFooter).toEqual([])
  })
})

// Task 11: ViewbookShell mounts TocRail (a 'use client' leaf) with
// server-built indexes — the search index (and the rail's verbose mode) MUST
// be gated to the `building` stage (a data-exposure requirement: Q&A values
// never serialize into stages where that content isn't the searchable
// focus).
// Codex-review fix P2-1: nested TOC/search anchor targets (building-stage
// field/category/milestone/doc ids) must clear the sticky nav + sticky
// section header, same as the section root does via its own inline
// scrollMarginTop. jsdom has no layout engine and cannot compute a
// stylesheet-derived scroll-margin, so this is a STRUCTURAL guard only: it
// asserts ViewbookShell emits a scoped `<style>` rule targeting
// `[data-vb-theme-root] [id]` that references `--vb-sticky-offset` (the same
// CSS var the theme root sets and StickyOffsetProbe measures). The real
// pixel-accurate offset is verified at the browser integration gate, not
// here.
describe('ViewbookShell nested-anchor scroll offset (Task P2-1)', () => {
  it('emits a scoped [data-vb-theme-root] [id] scroll-margin-top rule keyed to --vb-sticky-offset', () => {
    const { container } = render(
      <ViewbookShell
        token="tok"
        data={data({ primarySections: [sec('welcome')] })}
        primarySections={[sec('welcome')]}
        carriedSections={[]}
        renderSection={(s) => <p data-testid={`section-${s.sectionKey}`}>{s.sectionKey} body</p>}
      />,
    )

    const styles = Array.from(container.querySelectorAll('style'))
    const rule = styles.find((el) => el.textContent?.includes('[data-vb-theme-root] [id]'))
    expect(rule).toBeDefined()
    expect(rule!.textContent).toContain('scroll-margin-top')
    expect(rule!.textContent).toContain('--vb-sticky-offset')
  })
})

describe('ViewbookShell TOC rail wiring', () => {
  it('building-stage data renders TOC entries and a verbose search box', () => {
    const { container } = render(
      <ViewbookShell
        token="tok"
        data={data({ stage: 'building', primarySections: [sec('welcome'), sec('data-source')] })}
        primarySections={[sec('welcome'), sec('data-source')]}
        carriedSections={[]}
        renderSection={(s) => <p data-testid={`section-${s.sectionKey}`}>{s.sectionKey} body</p>}
      />,
    )

    expect(container.querySelectorAll('[data-vb-toc-entry]').length).toBeGreaterThan(0)
    expect(container.querySelector('input[type="search"]')).not.toBeNull()
  })

  it('a non-building stage renders the rail but NO search box (empty search index)', () => {
    const { container } = render(
      <ViewbookShell
        token="tok"
        data={data({ stage: 'kickoff', primarySections: [sec('welcome')] })}
        primarySections={[sec('welcome')]}
        carriedSections={[]}
        renderSection={(s) => <p data-testid={`section-${s.sectionKey}`}>{s.sectionKey} body</p>}
      />,
    )

    // The rail itself still mounts (TOC entries reflect the primary lineup
    // regardless of stage) …
    expect(container.querySelectorAll('[data-vb-toc-entry]').length).toBeGreaterThan(0)
    // … but the search box is verbose-only, and verbose is `stage ===
    // 'building'` — outside that stage there is no input[type=search] at all.
    expect(container.querySelector('input[type="search"]')).toBeNull()
  })
})
