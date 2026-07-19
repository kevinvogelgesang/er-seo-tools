// @vitest-environment jsdom
//
// PR6 — Context Lens end-to-end integration + a11y + presentation-gate coverage.
// This is the ONE test that assembles the FULL operator layer (providers +
// OperatorBar + OperatorInspector + wrapped canvas sections) the way page.tsx
// composes it server-side, and drives the assembled wiring: scroll-spy →
// selection → visible pane, hard-pin fail-closed on outline nav, clean
// selection preserving mounted controllers, and the a11y/keyboard contract.
//
// NO component behavior is changed by this PR — these tests only OBSERVE the
// assembled behavior and assert the a11y attributes the components already ship.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { DEFAULT_THEME, type SectionKey } from '@/lib/viewbook/theme'
import type { OperatorSectionData, OperatorViewbookData } from '@/lib/viewbook/operator-data'
import { __resetThemeDraftStore } from '../theme-store'
import { OperatorViewbookLayer } from '../OperatorViewbookLayer'
import { OperatorSectionWrapper } from '../OperatorSectionWrapper'
import { useReportSectionActivity } from './useSectionActivity'

// ---- fixtures -------------------------------------------------------------

const baseOD: OperatorViewbookData = {
  welcomeNote: 'Hello there', dataLockedAt: null, dataLockedBy: null, theme: DEFAULT_THEME,
  sections: [], fields: [], milestones: [], docs: { global: [], own: [] },
  pcCompletedAt: null, clientNotifyEmails: [], teamMembers: [],
}
function od(partial: Partial<OperatorViewbookData>): OperatorViewbookData { return { ...baseOD, ...partial } }
function sec(sectionKey: SectionKey): OperatorSectionData {
  return { sectionKey, state: 'active', collapsedShared: false, doneAt: null, acknowledgedAt: null, introNote: null, narrative: null }
}

// stage=building has welcome + brand BOTH in the primary lineup → both get an
// outline row AND an inspector pane, which is what these integration flows need.
const SECTIONS = [sec('welcome'), sec('brand')]

// ---- IntersectionObserver harness (jsdom has none) ------------------------
// Capture the scroll-spy callback the real useSectionSelection registers, so a
// test can drive "these sections are on screen with these visible heights" and
// exercise the genuine selection path (observe → SelectionContext → pane flip).
type IoEntryish = {
  target: { dataset: { operatorSection: string } }
  isIntersecting: boolean
  intersectionRect: { height: number }
}
let ioCallback: ((entries: IoEntryish[]) => void) | null = null
class MockIntersectionObserver {
  constructor(cb: (entries: IoEntryish[]) => void) { ioCallback = cb }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
}

function fireScrollSpy(heights: Record<string, number>) {
  const cb = ioCallback
  if (!cb) throw new Error('scroll-spy IntersectionObserver callback was never registered')
  const entries: IoEntryish[] = Object.entries(heights).map(([key, height]) => ({
    target: { dataset: { operatorSection: key } },
    isIntersecting: height > 0,
    intersectionRect: { height },
  }))
  act(() => { cb(entries) })
}

let stored: string | null

beforeEach(() => {
  stored = null
  ioCallback = null
  vi.stubGlobal('localStorage', {
    getItem: () => stored,
    setItem: (_k: string, v: string) => { stored = v },
  })
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver as unknown as typeof IntersectionObserver)
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  __resetThemeDraftStore()
  document.querySelectorAll('[data-vb-theme-root], [data-vb-theme-font]').forEach((node) => node.remove())
})

// A controllable activity source living INSIDE the layer's providers. Reporting
// activity for a section HARD-pins it (useReportSectionActivity → select(key,
// 'focus')); flipping `active` off releases the pin.
function ActivityInjector({ sectionKey, active }: { sectionKey: SectionKey; active: boolean }) {
  useReportSectionActivity(sectionKey, 'pr6-test-injector', {
    dirty: active, busy: false, conflict: false, focused: active,
  })
  return null
}

function renderLayer(opts: { operatorData?: OperatorViewbookData; extra?: ReactNode } = {}) {
  const operatorData = opts.operatorData ?? od({ sections: SECTIONS })
  return render(
    <OperatorViewbookLayer
      viewbookId={22}
      operatorEmail="operator@example.com"
      stage="building"
      pcCompletedAt={null}
      operatorData={operatorData}
    >
      <main>
        <OperatorSectionWrapper sectionKey="welcome"><div>Public welcome</div></OperatorSectionWrapper>
        <OperatorSectionWrapper sectionKey="brand"><div>Public brand</div></OperatorSectionWrapper>
        {opts.extra}
      </main>
    </OperatorViewbookLayer>,
  )
}

const paneHidden = (container: HTMLElement, key: SectionKey) =>
  container.querySelector(`[data-vb-inspector-pane="${key}"]`)!.hasAttribute('hidden')

function outline(): HTMLElement {
  return screen.getByRole('navigation', { name: 'Section outline' })
}
function clickOutlineRow(title: string) {
  act(() => { within(outline()).getByRole('button', { name: title }).click() })
}

// ---------------------------------------------------------------------------

describe('Context Lens — selection integration (full operator layer)', () => {
  it('scroll-spy observe() sets selectedKey → the matching inspector pane loses hidden', async () => {
    const { container } = renderLayer()
    await screen.findByText('ER editing')

    // Seeded from the first canvas target (welcome) before any selection.
    expect(paneHidden(container, 'welcome')).toBe(false)
    expect(paneHidden(container, 'brand')).toBe(true)

    // Simulate brand dominating the viewport (welcome scrolled out).
    fireScrollSpy({ welcome: 0, brand: 140 })

    expect(paneHidden(container, 'brand')).toBe(false)
    expect(paneHidden(container, 'welcome')).toBe(true)
  })

  it('a HARD pin (activity/focus) fail-closes an outline nav to another section — same pane stays, controller stays mounted (fix #16)', async () => {
    const { container, rerender } = renderLayer({ extra: <ActivityInjector sectionKey="welcome" active /> })
    await screen.findByText('ER editing')

    // welcome is hard-pinned by its reported activity → its pane is the visible one.
    expect(paneHidden(container, 'welcome')).toBe(false)
    const welcomeInput = screen.getByLabelText('Welcome note')
    expect(welcomeInput.isConnected).toBe(true)

    // Navigating to brand via the outline while welcome is dirty/busy must NOT
    // swap the visible pane (select('brand') returns false). We assert the SAME
    // pane (welcome) stays visible + its controller stays mounted — NOT that the
    // dirty pane hides (fix #16).
    clickOutlineRow('Brand Guidelines')
    expect(paneHidden(container, 'welcome')).toBe(false)
    expect(paneHidden(container, 'brand')).toBe(true)
    expect(welcomeInput.isConnected).toBe(true)

    // Release the pin (activity goes idle) — now selecting brand succeeds…
    rerender(
      <OperatorViewbookLayer
        viewbookId={22}
        operatorEmail="operator@example.com"
        stage="building"
        pcCompletedAt={null}
        operatorData={od({ sections: SECTIONS })}
      >
        <main>
          <OperatorSectionWrapper sectionKey="welcome"><div>Public welcome</div></OperatorSectionWrapper>
          <OperatorSectionWrapper sectionKey="brand"><div>Public brand</div></OperatorSectionWrapper>
          <ActivityInjector sectionKey="welcome" active={false} />
        </main>
      </OperatorViewbookLayer>,
    )

    clickOutlineRow('Brand Guidelines')
    expect(paneHidden(container, 'brand')).toBe(false)
    expect(paneHidden(container, 'welcome')).toBe(true)
    // …WITHOUT remounting welcome's controller (C5 — panes are permanently mounted).
    expect(welcomeInput.isConnected).toBe(true)
  })

  it('clicking an outline row dispatches vb:navigate AND selects the pane', async () => {
    const { container } = renderLayer()
    await screen.findByText('ER editing')

    const navigated: string[] = []
    const handler = (event: Event) => {
      navigated.push((event as CustomEvent<{ sectionKey: string }>).detail.sectionKey)
    }
    window.addEventListener('vb:navigate', handler)
    try {
      clickOutlineRow('Brand Guidelines')
    } finally {
      window.removeEventListener('vb:navigate', handler)
    }

    expect(navigated).toContain('brand')
    expect(paneHidden(container, 'brand')).toBe(false)
    expect(paneHidden(container, 'welcome')).toBe(true)
  })

  it('a CLEAN selection change keeps the previously-visible pane controller mounted (C4/C5)', async () => {
    const { container } = renderLayer()
    await screen.findByText('ER editing')

    // welcome active + its controller present.
    expect(paneHidden(container, 'welcome')).toBe(false)
    const welcomeInput = screen.getByLabelText('Welcome note')
    expect(welcomeInput.isConnected).toBe(true)

    // Clean nav to brand.
    clickOutlineRow('Brand Guidelines')
    expect(paneHidden(container, 'brand')).toBe(false)

    // The welcome controller was NOT unmounted — the exact node survives, still
    // inside welcome's (now hidden, still mounted) pane.
    expect(welcomeInput.isConnected).toBe(true)
    expect(container.querySelector('[data-vb-inspector-pane="welcome"]')!.contains(welcomeInput)).toBe(true)
  })
})

describe('Context Lens — a11y / keyboard contract', () => {
  it('inspector aside, outline nav, collapse, canvas-fit and preview-as-client are labeled & distinct', async () => {
    renderLayer()
    await screen.findByText('ER editing')

    // Inspector shell has an accessible name.
    const aside = screen.getByRole('complementary', { name: 'Viewbook editing inspector' })
    expect(aside).toBeTruthy()

    // Outline is a labeled nav whose rows are buttons.
    const nav = within(aside).getByRole('navigation', { name: 'Section outline' })
    expect(within(nav).getByRole('button', { name: 'Welcome & Team' })).toBeTruthy()
    expect(within(nav).getByRole('button', { name: 'Brand Guidelines' })).toBeTruthy()

    // Collapse control exposes aria-expanded.
    const collapse = within(aside).getByRole('button', { name: 'Collapse inspector' })
    expect(collapse.getAttribute('aria-expanded')).toBe('true')

    // Canvas-fit and preview-as-client are two DISTINCT, separately-labeled controls.
    const fit = screen.getByRole('button', { name: 'Canvas fit' })
    const preview = screen.getByRole('button', { name: 'Preview as client' })
    expect(fit).not.toBe(preview)
  })

  it('active-pane controls are reachable by role; hidden/inert-pane controls are NOT (fix #16)', async () => {
    const { container } = renderLayer()
    await screen.findByText('ER editing')

    // We assert on the CONTROLS, not the pane container (fix #16). The pane's
    // top-level tabbable control is the editor-panel disclosure TRIGGER button
    // (uniquely named per section, and not itself buried behind a collapsed
    // disclosure). A `hidden` pane ancestor removes its descendants from the
    // accessibility tree, so getByRole/queryByRole is the tabbability probe
    // (jsdom does not implement `inert`, so we lean on the `hidden` attribute
    // the pane already sets alongside it).
    // welcome pane active → its trigger control is reachable by role…
    expect(screen.getByRole('button', { name: /Welcome & Team copy/ })).toBeTruthy()
    // …and the brand pane's trigger is NOT (brand pane carries `hidden`/`inert`).
    expect(paneHidden(container, 'brand')).toBe(true)
    expect(screen.queryByRole('button', { name: /Brand Guidelines copy/ })).toBeNull()
    // The mounted-but-hidden brand control still EXISTS in the DOM (C5).
    expect(container.querySelector('[data-vb-inspector-pane="brand"]')!.textContent).toContain('Brand Guidelines copy')

    // Flip selection → a11y-tree membership flips with it.
    fireScrollSpy({ welcome: 0, brand: 140 })
    expect(screen.getByRole('button', { name: /Brand Guidelines copy/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Welcome & Team copy/ })).toBeNull()
  })

  it('inspector DOM order is AFTER the operator bar and BEFORE the canvas children (fix #8)', async () => {
    const { container } = renderLayer()
    await screen.findByText('ER editing')

    const bar = container.querySelector('#vb-operator-bar')!
    const inspector = container.querySelector('[data-vb-inspector]')!
    const firstSection = container.querySelector('[data-operator-section]')!
    expect(bar).toBeTruthy()
    expect(inspector).toBeTruthy()
    expect(firstSection).toBeTruthy()

    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING
    // inspector follows the bar…
    expect(bar.compareDocumentPosition(inspector) & FOLLOWING).toBeTruthy()
    // …and precedes the first canvas section.
    expect(inspector.compareDocumentPosition(firstSection) & FOLLOWING).toBeTruthy()
  })
})

describe('Context Lens — presentation gate end-to-end', () => {
  it('while presenting, the layer renders NO bar / inspector / outline / section boundary — only the bare children + Return-to-editing toggle', async () => {
    stored = 'true'
    const { container } = renderLayer()
    await screen.findByRole('button', { name: 'Return to editing' })

    expect(screen.getByText('Public welcome')).toBeTruthy()
    expect(container.querySelector('#vb-operator-bar')).toBeNull()
    expect(container.querySelector('[data-vb-inspector]')).toBeNull()
    expect(container.querySelector('[data-vb-section-outline]')).toBeNull()
    expect(container.querySelector('[data-vb-inspector-panes]')).toBeNull()
    // No operator section boundary leaks while presenting.
    expect(container.querySelector('[data-operator-section]')).toBeNull()
    // The only operator affordance is the single toggle.
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('anonymous byte-shape: none of the Context Lens markers appear in a non-operator render', () => {
    // The FULL anonymous-branch guard lives in app/(public)/viewbook/[token]/
    // page.test.tsx (operator read model never loaded). Here we re-assert, at the
    // component level, that the presentation-gated tree emits none of the Context
    // Lens data markers when it is rendering as the bare public tree.
    stored = 'true'
    const { container } = renderLayer()
    for (const marker of ['data-vb-inspector', 'data-vb-section-outline', 'data-operator-section']) {
      expect(container.querySelector(`[${marker}]`)).toBeNull()
    }
  })
})
