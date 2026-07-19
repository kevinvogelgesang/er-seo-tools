// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { DEFAULT_THEME, type SectionKey } from '@/lib/viewbook/theme'
import type { OperatorSectionData, OperatorViewbookData } from '@/lib/viewbook/operator-data'
import { __resetThemeDraftStore } from '../theme-store'
import { InspectorPanes } from './InspectorPanes'
import { SelectionProvider, useSelectionContext } from './SelectionContext'
import { SectionActivityProvider, useReportSectionActivity } from './useSectionActivity'
import { useSectionSelection } from './useSectionSelection'

// Scroll-spy is mocked so we can assert the orderedKeys it receives (fix #6);
// the real hook no-ops under jsdom (no IntersectionObserver) anyway.
vi.mock('./useSectionSelection', () => ({ useSectionSelection: vi.fn() }))

beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.mocked(useSectionSelection).mockClear()
  __resetThemeDraftStore()
  document.querySelectorAll('[data-vb-theme-root], [data-vb-theme-font]').forEach((node) => node.remove())
})

const baseOD: OperatorViewbookData = {
  welcomeNote: null, dataLockedAt: null, dataLockedBy: null, theme: DEFAULT_THEME,
  sections: [], fields: [], milestones: [], docs: { global: [], own: [] },
  pcCompletedAt: null, clientNotifyEmails: [], teamMembers: [],
}
function od(partial: Partial<OperatorViewbookData>): OperatorViewbookData { return { ...baseOD, ...partial } }
function sec(sectionKey: SectionKey): OperatorSectionData {
  return { sectionKey, state: 'active', collapsedShared: false, doneAt: null, acknowledgedAt: null, introNote: null, narrative: null }
}

// Canvas scroll-spy targets — order here is the LINEUP/DOM order (may differ
// from operatorData.sections DB order).
function Canvas({ order }: { order: SectionKey[] }) {
  return <>{order.map((key) => <div key={key} data-operator-section={key} />)}</>
}

function Wrap({ operatorData, canvas, extra }: { operatorData: OperatorViewbookData; canvas: SectionKey[]; extra?: ReactNode }) {
  return (
    <SelectionProvider>
      <SectionActivityProvider>
        <InspectorPanes viewbookId={1} operatorData={operatorData} />
        <Canvas order={canvas} />
        {extra}
      </SectionActivityProvider>
    </SelectionProvider>
  )
}

function SelectControl({ target }: { target: SectionKey }) {
  const { select } = useSelectionContext()
  return <button onClick={() => select(target, 'manual-nav')}>go-{target}</button>
}

function DirtyInjector({ sectionKey }: { sectionKey: SectionKey }) {
  useReportSectionActivity(sectionKey, 'test-injector', { dirty: true, busy: false, conflict: false, focused: false })
  return null
}

const hidden = (container: HTMLElement, key: SectionKey) =>
  container.querySelector(`[data-vb-inspector-pane="${key}"]`)!.hasAttribute('hidden')

describe('InspectorPanes', () => {
  it('mounts one pane per eligible section and gates pc-thanks on completion (fix #5)', () => {
    const sections = [sec('welcome'), sec('brand'), sec('pc-thanks')]
    const { container, rerender } = render(<Wrap operatorData={od({ sections, pcCompletedAt: null })} canvas={['welcome']} />)
    expect(container.querySelector('[data-vb-inspector-pane="welcome"]')).toBeTruthy()
    expect(container.querySelector('[data-vb-inspector-pane="brand"]')).toBeTruthy()
    expect(container.querySelector('[data-vb-inspector-pane="pc-thanks"]')).toBeNull()

    rerender(<Wrap operatorData={od({ sections, pcCompletedAt: '2026-07-18T00:00:00.000Z' })} canvas={['welcome']} />)
    expect(container.querySelector('[data-vb-inspector-pane="pc-thanks"]')).toBeTruthy()
  })

  it('with no selection, reveals the pane matching the FIRST canvas target — never sections[0] (fix #4)', () => {
    // DB order = brand-first; DOM/lineup order = welcome-first.
    const { container } = render(<Wrap operatorData={od({ sections: [sec('brand'), sec('welcome')] })} canvas={['welcome', 'brand']} />)
    expect(hidden(container, 'welcome')).toBe(false)
    expect(hidden(container, 'brand')).toBe(true)
  })

  it('renders a neutral empty state (never indexes [0]) when there are no eligible sections', () => {
    const { container } = render(<Wrap operatorData={od({ sections: [] })} canvas={[]} />)
    expect(screen.getByRole('region', { name: /section editors/i })).toBeTruthy()
    expect(container.querySelector('[data-vb-inspector-empty]')).toBeTruthy()
    expect(container.querySelector('[data-vb-inspector-pane]')).toBeNull()
  })

  it('wraps each pane in intent-group regions incl. a mounted status placeholder (fix #7)', () => {
    const { container } = render(<Wrap operatorData={od({ sections: [sec('brand')] })} canvas={['brand']} />)
    const pane = container.querySelector('[data-vb-inspector-pane="brand"]')!
    expect(pane.querySelector('[data-vb-inspector-group="content"]')).toBeTruthy()
    expect(pane.querySelector('[data-vb-inspector-group="assets"]')).toBeTruthy()
    expect(pane.querySelector('[data-vb-inspector-group="status"]')).toBeTruthy()
  })

  it('a clean manual-nav select swaps the visible pane while keeping the previous pane MOUNTED (C5)', () => {
    const { container } = render(
      <Wrap operatorData={od({ sections: [sec('welcome'), sec('brand')] })} canvas={['welcome', 'brand']} extra={<SelectControl target="brand" />} />,
    )
    expect(hidden(container, 'welcome')).toBe(false)
    const welcomeInput = screen.getByLabelText('Welcome note')

    act(() => { screen.getByText('go-brand').click() })
    expect(hidden(container, 'brand')).toBe(false)
    expect(hidden(container, 'welcome')).toBe(true)
    // Previous pane not unmounted — its input survives (drafts/timers intact).
    expect(welcomeInput.isConnected).toBe(true)
  })

  it('does NOT swap away from a section reporting activity — hard pin fail-closed (fix #9)', () => {
    const { container } = render(
      <Wrap
        operatorData={od({ sections: [sec('welcome'), sec('brand')] })}
        canvas={['welcome', 'brand']}
        extra={<><DirtyInjector sectionKey="welcome" /><SelectControl target="brand" /></>}
      />,
    )
    expect(hidden(container, 'welcome')).toBe(false)
    act(() => { screen.getByText('go-brand').click() })
    // welcome is hard-pinned by its activity → select('brand') returns false → no swap.
    expect(hidden(container, 'welcome')).toBe(false)
    expect(hidden(container, 'brand')).toBe(true)
  })

  it('feeds scroll-spy the canvas DOM order, not the section (DB) order (fix #6)', () => {
    render(<Wrap operatorData={od({ sections: [sec('brand'), sec('welcome')] })} canvas={['welcome', 'brand']} />)
    const calls = vi.mocked(useSectionSelection).mock.calls
    expect(calls.at(-1)?.[0]).toEqual(['welcome', 'brand'])
  })
})
