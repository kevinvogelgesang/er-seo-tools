// @vitest-environment jsdom
//
// Viewbook UX pass, Lane 1 Task 4 — StickyOffsetProbe measurement leaf.
//
// jsdom has no real layout, so we install a fake ResizeObserver that fires
// its callback once per observe() (mimicking the browser's initial-observe
// callback) and mock Element.prototype.getBoundingClientRect so heights are
// deterministic. MutationObserver is jsdom's real implementation — it's a
// standard DOM API jsdom supports natively, so faking it would just be
// re-testing our own fake instead of the real rebind contract.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { StickyOffsetProbe } from './StickyOffsetProbe'

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  callback: ResizeObserverCallback
  observed: Element[] = []
  disconnected = false

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    FakeResizeObserver.instances.push(this)
  }

  observe(el: Element) {
    this.observed.push(el)
    this.callback([{ target: el } as ResizeObserverEntry], this as unknown as ResizeObserver)
  }

  unobserve(el: Element) {
    this.observed = this.observed.filter((observed) => observed !== el)
  }

  disconnect() {
    this.disconnected = true
    this.observed = []
  }
}

beforeEach(() => {
  FakeResizeObserver.instances = []
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    height: 64,
    width: 320,
    top: 0,
    left: 0,
    right: 320,
    bottom: 64,
    x: 0,
    y: 0,
    toJSON() {
      return {}
    },
  } as DOMRect)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver
  document.body.innerHTML = ''
})

describe('StickyOffsetProbe', () => {
  it('measures the progress nav and zeroes the operator height when absent, writing onto [data-vb-theme-root]', async () => {
    render(
      <div>
        <div data-vb-theme-root="" data-testid="theme-root">
          <div id="vb-progress-nav" />
        </div>
        <StickyOffsetProbe />
      </div>,
    )
    const root = document.querySelector('[data-vb-theme-root]') as HTMLElement
    await waitFor(() => {
      expect(root.style.getPropertyValue('--vb-progress-nav-height')).toBe('64px')
      expect(root.style.getPropertyValue('--vb-operator-bar-height')).toBe('0px')
      expect(root.style.getPropertyValue('--vb-sticky-offset')).toBe('64px')
    })
  })

  it('sums both heights onto the theme root when the operator bar is present', async () => {
    render(
      <div>
        <div data-vb-theme-root="">
          <div id="vb-progress-nav" />
          <div id="vb-operator-bar" />
        </div>
        <StickyOffsetProbe />
      </div>,
    )
    const root = document.querySelector('[data-vb-theme-root]') as HTMLElement
    await waitFor(() => {
      expect(root.style.getPropertyValue('--vb-progress-nav-height')).toBe('64px')
      expect(root.style.getPropertyValue('--vb-operator-bar-height')).toBe('64px')
      expect(root.style.getPropertyValue('--vb-sticky-offset')).toBe('128px')
    })
  })

  it('falls back to document.documentElement when no [data-vb-theme-root] marker exists', async () => {
    render(
      <div>
        <div id="vb-progress-nav" />
        <StickyOffsetProbe />
      </div>,
    )
    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--vb-sticky-offset')).toBe('64px')
    })
  })

  it('rebinds via MutationObserver when the operator bar appears later, then zeroes it out when removed', async () => {
    render(
      <div>
        <div data-vb-theme-root="">
          <div id="vb-progress-nav" />
        </div>
        <StickyOffsetProbe />
      </div>,
    )
    const root = document.querySelector('[data-vb-theme-root]') as HTMLElement
    await waitFor(() => {
      expect(root.style.getPropertyValue('--vb-sticky-offset')).toBe('64px')
    })

    const bar = document.createElement('div')
    bar.id = 'vb-operator-bar'
    root.appendChild(bar)

    await waitFor(() => {
      expect(root.style.getPropertyValue('--vb-operator-bar-height')).toBe('64px')
      expect(root.style.getPropertyValue('--vb-sticky-offset')).toBe('128px')
    })

    root.removeChild(bar)

    await waitFor(() => {
      expect(root.style.getPropertyValue('--vb-operator-bar-height')).toBe('0px')
      expect(root.style.getPropertyValue('--vb-sticky-offset')).toBe('64px')
    })
  })

  it('disconnects both observers on unmount', async () => {
    const moDisconnect = vi.spyOn(MutationObserver.prototype, 'disconnect')
    const { unmount } = render(
      <div>
        <div data-vb-theme-root="">
          <div id="vb-progress-nav" />
        </div>
        <StickyOffsetProbe />
      </div>,
    )
    await waitFor(() => {
      expect(FakeResizeObserver.instances.length).toBeGreaterThan(0)
    })
    const ro = FakeResizeObserver.instances[0]
    expect(ro.disconnected).toBe(false)
    unmount()
    expect(ro.disconnected).toBe(true)
    expect(moDisconnect).toHaveBeenCalled()
  })
})
