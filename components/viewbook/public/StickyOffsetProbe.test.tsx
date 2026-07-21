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

const PUBLISHED_PROPS = ['--vb-progress-nav-height', '--vb-operator-bar-height', '--vb-sticky-offset']

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver
  document.body.innerHTML = ''
  for (const prop of PUBLISHED_PROPS) document.documentElement.style.removeProperty(prop)
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

  it('publishes the sticky offset to BOTH the theme root and document.documentElement', async () => {
    document.body.innerHTML = '<div data-vb-theme-root><div id="vb-progress-nav"></div></div>'
    const nav = document.getElementById('vb-progress-nav')!
    vi.spyOn(nav, 'getBoundingClientRect').mockReturnValue({ height: 40 } as DOMRect)
    const themeRoot = document.querySelector('[data-vb-theme-root]') as HTMLElement
    for (const prop of PUBLISHED_PROPS) {
      document.documentElement.style.removeProperty(prop)
      themeRoot.style.removeProperty(prop)
    }

    render(<StickyOffsetProbe />)

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--vb-sticky-offset')).toBe('40px')
      expect(themeRoot.style.getPropertyValue('--vb-sticky-offset')).toBe('40px')
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

  it('dispatches vb:sticky-offset-change with the summed offset (64px nav)', async () => {
    const events: number[] = []
    const handler = (e: Event) => events.push((e as CustomEvent).detail.offset)
    window.addEventListener('vb:sticky-offset-change', handler)
    render(
      <div>
        <div data-vb-theme-root="">
          <div id="vb-progress-nav" />
        </div>
        <StickyOffsetProbe />
      </div>,
    )
    await waitFor(() => expect(events.length).toBeGreaterThan(0))
    expect(events[0]).toBe(64)
    window.removeEventListener('vb:sticky-offset-change', handler)
  })
})
