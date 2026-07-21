// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ReadingProgressController } from './ReadingProgressController'

type ScriptedRect = { top: number; bottom: number }

const rects = new WeakMap<Element, ScriptedRect>()
const observers: FakeIntersectionObserver[] = []

let originalIntersectionObserver: typeof window.IntersectionObserver
let originalGetBoundingClientRect: typeof Element.prototype.getBoundingClientRect
let originalRequestAnimationFrame: typeof window.requestAnimationFrame
let originalStickyOffset = ''

class FakeIntersectionObserver {
  readonly observed = new Set<Element>()
  readonly disconnect = vi.fn(() => this.observed.clear())

  constructor(
    private readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    observers.push(this)
  }

  observe = vi.fn((element: Element) => this.observed.add(element))
  unobserve = vi.fn((element: Element) => this.observed.delete(element))
  takeRecords = vi.fn(() => [])

  trigger(elements: Element[] = [...this.observed]) {
    const entries = elements.map((target) => {
      const rect = target.getBoundingClientRect()
      return { target, boundingClientRect: rect } as IntersectionObserverEntry
    })
    this.callback(entries, this as unknown as IntersectionObserver)
  }
}

function setRect(element: Element, rect: ScriptedRect) {
  rects.set(element, rect)
}

function page() {
  return (
    <>
      <nav>
        <button data-vb-toc-section="welcome">Welcome</button>
        <button data-vb-toc-section="milestones">Milestones</button>
        <button data-vb-toc-section="strategy">Strategy</button>
      </nav>
      {(['welcome', 'milestones', 'strategy'] as const).map((key) => (
        <section key={key} data-vb-section={key} data-vb-hero-visible="true">
          <div data-vb-hero>{key}</div>
        </section>
      ))}
      <ReadingProgressController />
    </>
  )
}

beforeEach(() => {
  cleanup()
  observers.length = 0
  originalIntersectionObserver = window.IntersectionObserver
  originalGetBoundingClientRect = Element.prototype.getBoundingClientRect
  originalRequestAnimationFrame = window.requestAnimationFrame
  originalStickyOffset = document.documentElement.style.getPropertyValue('--vb-sticky-offset')

  Object.defineProperty(window, 'IntersectionObserver', {
    configurable: true,
    writable: true,
    value: FakeIntersectionObserver,
  })
  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    const rect = rects.get(this) ?? { top: 1000, bottom: 1100 }
    return {
      ...rect,
      x: 0,
      y: rect.top,
      width: 100,
      height: rect.bottom - rect.top,
      left: 0,
      right: 100,
      toJSON: () => ({}),
    } as DOMRect
  }
  window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
  document.documentElement.style.setProperty('--vb-sticky-offset', '64px')
})

afterEach(() => {
  cleanup()
  Object.defineProperty(window, 'IntersectionObserver', {
    configurable: true,
    writable: true,
    value: originalIntersectionObserver,
  })
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect
  window.requestAnimationFrame = originalRequestAnimationFrame
  if (originalStickyOffset) {
    document.documentElement.style.setProperty('--vb-sticky-offset', originalStickyOffset)
  } else {
    document.documentElement.style.removeProperty('--vb-sticky-offset')
  }
})

describe('ReadingProgressController', () => {
  it('falls back to visible sticky labels without active tracking when IntersectionObserver is unavailable', () => {
    Object.defineProperty(window, 'IntersectionObserver', {
      configurable: true,
      writable: true,
      value: undefined,
    })

    const { container } = render(page())

    for (const section of container.querySelectorAll('[data-vb-section]')) {
      expect(section.getAttribute('data-vb-hero-visible')).toBe('false')
    }
    expect(container.querySelector('[data-vb-active="true"]')).toBeNull()
  })

  it('marks a crossed hero hidden and moves active state to its matching rail entry', () => {
    const { container } = render(page())
    const heroes = [...container.querySelectorAll('[data-vb-hero]')]
    setRect(heroes[0], { top: -80, bottom: 20 })
    setRect(heroes[1], { top: 40, bottom: 140 })
    setRect(heroes[2], { top: 220, bottom: 320 })

    observers[0].trigger()

    const welcomeSection = container.querySelector('[data-vb-section="welcome"]')
    const active = container.querySelector('[data-vb-toc-section="milestones"]')
    expect(welcomeSection?.getAttribute('data-vb-hero-visible')).toBe('false')
    expect(active?.getAttribute('data-vb-active')).toBe('true')
    expect(active?.getAttribute('aria-current')).toBe('location')
    expect(container.querySelector('[data-vb-toc-section="welcome"]')?.getAttribute('data-vb-active')).toBeNull()
  })

  it('selects the last hero whose top crossed the activation line', () => {
    const { container } = render(page())
    const heroes = [...container.querySelectorAll('[data-vb-hero]')]
    setRect(heroes[0], { top: -180, bottom: -80 })
    setRect(heroes[1], { top: 20, bottom: 120 })
    setRect(heroes[2], { top: 180, bottom: 280 })

    observers[0].trigger()

    expect(container.querySelector('[data-vb-toc-section="milestones"]')?.getAttribute('data-vb-active')).toBe('true')
    expect(container.querySelectorAll('[data-vb-active="true"]')).toHaveLength(1)
  })

  it('re-queries the live rail node on every commit', () => {
    const { container } = render(page())
    const heroes = [...container.querySelectorAll('[data-vb-hero]')]
    setRect(heroes[0], { top: -180, bottom: -80 })
    setRect(heroes[1], { top: 20, bottom: 120 })
    setRect(heroes[2], { top: 180, bottom: 280 })
    observers[0].trigger()

    const oldNode = container.querySelector('[data-vb-toc-section="milestones"]')
    const replacement = document.createElement('button')
    replacement.setAttribute('data-vb-toc-section', 'milestones')
    replacement.textContent = 'Replacement milestones'
    oldNode?.replaceWith(replacement)

    observers[0].trigger()

    expect(replacement.getAttribute('data-vb-active')).toBe('true')
    expect(replacement.getAttribute('aria-current')).toBe('location')
  })

  it('rebuilds for a changed sticky offset and deduplicates repeated offset events', () => {
    render(page())
    const first = observers[0]
    expect(first.options?.rootMargin).toBe('-64px 0px 0px 0px')

    document.documentElement.style.setProperty('--vb-sticky-offset', '72px')
    window.dispatchEvent(new CustomEvent('vb:sticky-offset-change', { detail: { offset: 72 } }))

    expect(first.disconnect).toHaveBeenCalledTimes(1)
    expect(observers).toHaveLength(2)
    expect(observers[1].options?.rootMargin).toBe('-72px 0px 0px 0px')

    window.dispatchEvent(new CustomEvent('vb:sticky-offset-change', { detail: { offset: 72 } }))
    expect(observers).toHaveLength(2)
  })
})
