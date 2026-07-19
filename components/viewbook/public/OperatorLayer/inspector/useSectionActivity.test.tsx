// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, act } from '@testing-library/react'
import { SectionActivityProvider, useSectionActivityContext, useReportSectionActivity } from './useSectionActivity'
import { SelectionProvider, useSelectionContext } from './SelectionContext'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const IDLE = { dirty: false, busy: false, conflict: false, focused: false }

function Probe() {
  const reg = useSectionActivityContext()
  return (
    <div>
      <span data-testid="active">{String(reg.anyActive('brand'))}</span>
      <button onClick={() => reg.report('brand', 'copy', { ...IDLE, dirty: true })}>dirty-copy</button>
      <button onClick={() => reg.report('brand', 'theme', { ...IDLE, busy: true })}>busy-theme</button>
      <button onClick={() => reg.report('brand', 'copy', IDLE)}>clear-copy</button>
      <button onClick={() => reg.remove('brand', 'theme')}>remove-theme</button>
    </div>
  )
}

describe('useSectionActivity', () => {
  it('re-renders consumers on change and OR-reduces across editors', () => {
    render(<SectionActivityProvider><Probe /></SectionActivityProvider>)
    expect(screen.getByTestId('active').textContent).toBe('false')
    act(() => screen.getByText('dirty-copy').click())
    expect(screen.getByTestId('active').textContent).toBe('true')      // reactive (version bump)
    act(() => screen.getByText('busy-theme').click())
    act(() => screen.getByText('clear-copy').click())
    expect(screen.getByTestId('active').textContent).toBe('true')      // theme still busy
    act(() => screen.getByText('remove-theme').click())
    expect(screen.getByTestId('active').textContent).toBe('false')     // remove clears it
  })

  it('no-op default outside a provider does not throw', () => {
    render(<Probe />)
    act(() => screen.getByText('dirty-copy').click())
    expect(screen.getByTestId('active').textContent).toBe('false')
  })
})

function BridgeProbe({ sectionKey, active }: { sectionKey: 'brand' | 'welcome'; active: boolean }) {
  useReportSectionActivity(sectionKey, 'editor-1', { ...IDLE, dirty: active })
  return null
}

function SelectionProbe() {
  const selection = useSelectionContext()
  return (
    <div>
      <span data-testid="pinned-key">{String(selection.pinnedKey)}</span>
      <span data-testid="pinned-kind">{String(selection.pinnedKind)}</span>
    </div>
  )
}

describe('useReportSectionActivity bridge', () => {
  it('hard-pins the active section and releases the pin when it goes idle', () => {
    function Harness({ brandActive }: { brandActive: boolean }) {
      return (
        <SelectionProvider>
          <SectionActivityProvider>
            <BridgeProbe sectionKey="brand" active={brandActive} />
            <BridgeProbe sectionKey="welcome" active={false} />
            <SelectionProbe />
          </SectionActivityProvider>
        </SelectionProvider>
      )
    }

    const { rerender } = render(<Harness brandActive={true} />)
    expect(screen.getByTestId('pinned-key').textContent).toBe('brand')
    expect(screen.getByTestId('pinned-kind').textContent).toBe('activity')

    act(() => { rerender(<Harness brandActive={false} />) })
    expect(screen.getByTestId('pinned-key').textContent).toBe('null')
  })
})
