// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { OperatorInspector } from './OperatorInspector'
import { SelectionProvider } from './SelectionContext'
import { SectionActivityProvider } from './useSectionActivity'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'
import { PresentationModeProvider, PresentationToggle, usePresentationMode } from '../../PresentationToggle'

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: vi.fn(),
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('data-vb-canvas-fit')
})
const od: any = { theme: DEFAULT_THEME, sections: [], fields: [], milestones: [], docs: { global: [], own: [] }, welcomeNote: null, dataLockedAt: null, dataLockedBy: null, pcCompletedAt: null, clientNotifyEmails: [], teamMembers: [] }

function renderInspector() {
  return render(
    <SelectionProvider><SectionActivityProvider>
      <OperatorInspector viewbookId={1} operatorData={od} pcCompletedAt={null} stage={'kickoff' as any} />
    </SectionActivityProvider></SelectionProvider>,
  )
}

function PresentationStateProbe() {
  const { presenting } = usePresentationMode()
  return <output aria-label="Presentation state">{presenting ? 'presenting' : 'editing'}</output>
}

describe('OperatorInspector', () => {
  it('renders no inspector before presentation mode initializes or while presenting', async () => {
    const preInitHtml = renderToString(
      <PresentationModeProvider>
        <OperatorInspector viewbookId={1} operatorData={od} pcCompletedAt={null} stage={'kickoff' as any} />
      </PresentationModeProvider>,
    )
    expect(preInitHtml).not.toContain('data-vb-inspector')

    vi.stubGlobal('localStorage', {
      getItem: () => 'true',
      setItem: vi.fn(),
    })
    const { container } = render(
      <PresentationModeProvider>
        <PresentationToggle />
        <OperatorInspector viewbookId={1} operatorData={od} pcCompletedAt={null} stage={'kickoff' as any} />
      </PresentationModeProvider>,
    )
    await screen.findByRole('button', { name: 'Return to editing' })
    expect(container.querySelector('[data-vb-inspector]')).toBeNull()
  })

  it('composes one CSS-responsive outline + panes subtree at mobile and desktop widths', () => {
    for (const width of [375, 1280]) {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
      const { container, unmount } = renderInspector()

      expect(screen.getByRole('complementary', { name: /viewbook editing inspector/i })).toBeTruthy()
      expect(container.querySelectorAll('[data-vb-section-outline]')).toHaveLength(1)
      expect(container.querySelectorAll('[data-vb-inspector-panes]')).toHaveLength(1)
      const aside = container.querySelector('[data-vb-inspector]') as HTMLElement
      expect(aside.className).toContain('fixed')
      expect(aside.className).toContain('bottom-0')
      expect(aside.className).toContain('lg:right-0')
      expect(aside.className).toContain('lg:top-[var(--vb-sticky-offset,0px)]')
      expect(aside.className).toContain('lg:w-96')

      unmount()
    }
  })

  it('collapses to its visible handle while keeping the outline and panes mounted', () => {
    const { container } = renderInspector()

    expect(screen.getByRole('complementary', { name: /viewbook editing inspector/i })).toBeTruthy()
    const collapse = screen.getByRole('button', { name: 'Collapse inspector' })
    const body = container.querySelector('[data-vb-inspector-body]') as HTMLElement
    expect(collapse.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('[data-vb-inspector-handle]')).toBeTruthy()
    expect(body.hidden).toBe(false)

    fireEvent.click(collapse)

    expect(screen.getByRole('button', { name: 'Expand inspector' }).getAttribute('aria-expanded')).toBe('false')
    expect(body.hidden).toBe(true)
    expect(container.querySelector('[data-vb-inspector-handle]')).toBeTruthy()
    expect(container.querySelectorAll('[data-vb-section-outline]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-vb-inspector-panes]')).toHaveLength(1)
  })

  it('keeps canvas fit distinct from preview-as-client and preserves the single inspector subtree', async () => {
    const { container } = render(
      <PresentationModeProvider>
        <PresentationStateProbe />
        <PresentationToggle />
        <SelectionProvider><SectionActivityProvider>
          <OperatorInspector viewbookId={1} operatorData={od} pcCompletedAt={null} stage={'kickoff' as any} />
        </SectionActivityProvider></SelectionProvider>
      </PresentationModeProvider>,
    )

    const preview = await screen.findByRole('button', { name: 'Preview as client' })
    const canvasFit = screen.getByRole('button', { name: 'Canvas fit' })
    expect(preview).not.toBe(canvasFit)
    expect(preview.getAttribute('aria-pressed')).toBe('false')
    expect(canvasFit.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(canvasFit)

    expect(document.documentElement.getAttribute('data-vb-canvas-fit')).toBe('')
    expect(canvasFit.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('status', { name: 'Presentation state' }).textContent).toBe('editing')
    expect(container.querySelectorAll('[data-vb-section-outline]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-vb-inspector-panes]')).toHaveLength(1)
  })

  it('removes canvas fit whenever presentation mode is entered', async () => {
    render(
      <PresentationModeProvider>
        <PresentationToggle />
        <SelectionProvider><SectionActivityProvider>
          <OperatorInspector viewbookId={1} operatorData={od} pcCompletedAt={null} stage={'kickoff' as any} />
        </SectionActivityProvider></SelectionProvider>
      </PresentationModeProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Canvas fit' }))
    expect(document.documentElement.hasAttribute('data-vb-canvas-fit')).toBe(true)

    fireEvent.click(await screen.findByRole('button', { name: 'Preview as client' }))
    expect(document.documentElement.hasAttribute('data-vb-canvas-fit')).toBe(false)
  })

  it('removes canvas fit when the inspector unmounts', () => {
    const { unmount } = renderInspector()

    fireEvent.click(screen.getByRole('button', { name: 'Canvas fit' }))
    expect(document.documentElement.hasAttribute('data-vb-canvas-fit')).toBe(true)
    unmount()
    expect(document.documentElement.hasAttribute('data-vb-canvas-fit')).toBe(false)
  })
})
