// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { ReadingProgressController } from './ReadingProgressController'

// Fake IntersectionObserver capturing the callback + options; commits are
// triggered by invoking the stored callback manually.
let ioCallback: (() => void) | null = null
let ioOptions: IntersectionObserverInit | undefined
let disconnectCount = 0
class FakeIO {
  constructor(cb: () => void, opts?: IntersectionObserverInit) {
    ioCallback = cb
    ioOptions = opts
  }
  observe() {}
  unobserve() {}
  disconnect() {
    disconnectCount++
  }
}

function scene() {
  document.body.innerHTML = `
    <section data-vb-section="welcome" data-vb-hero-visible="true"><div data-vb-hero></div></section>
    <section data-vb-section="milestones" data-vb-hero-visible="true"><div data-vb-hero></div></section>
    <nav>
      <button data-vb-toc-section="welcome"></button>
      <button data-vb-toc-section="milestones"></button>
    </nav>`
  document.documentElement.style.setProperty('--vb-sticky-offset', '64px')
}

beforeEach(() => {
  disconnectCount = 0
  ioCallback = null
  ioOptions = undefined
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0)
    return 0
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  delete (window as unknown as Record<string, unknown>).IntersectionObserver
})

function setRects(map: Record<string, { top: number; bottom: number }>) {
  for (const el of Array.from(document.querySelectorAll('[data-vb-hero]'))) {
    const key = (el.closest('[data-vb-section]') as HTMLElement).dataset.vbSection!
    el.getBoundingClientRect = () => ({ top: map[key].top, bottom: map[key].bottom }) as DOMRect
  }
}

describe('ReadingProgressController', () => {
  it('with no IntersectionObserver, seeds every section hero-visible false', () => {
    scene()
    const { unmount } = render(<ReadingProgressController />)
    expect(document.querySelector('[data-vb-section="welcome"]')!.getAttribute('data-vb-hero-visible')).toBe('false')
    expect(document.querySelector('[data-vb-active]')).toBeNull()
    unmount()
  })
  it('marks the last hero whose top crossed the line active on the live rail node', () => {
    vi.stubGlobal('IntersectionObserver', FakeIO as unknown as typeof IntersectionObserver)
    scene()
    const { unmount } = render(<ReadingProgressController />)
    setRects({ welcome: { top: -80, bottom: 20 }, milestones: { top: 300, bottom: 500 } })
    ioCallback!()
    expect(document.querySelector('[data-vb-section="welcome"]')!.getAttribute('data-vb-hero-visible')).toBe('false')
    const active = document.querySelectorAll('[data-vb-active="true"]')
    expect(active.length).toBe(1)
    expect((active[0] as HTMLElement).dataset.vbTocSection).toBe('welcome')
    expect(active[0].getAttribute('aria-current')).toBe('location')
    unmount()
  })
  it('rebuilds the observer on a changed sticky offset and dedups a repeat', () => {
    vi.stubGlobal('IntersectionObserver', FakeIO as unknown as typeof IntersectionObserver)
    scene()
    const { unmount } = render(<ReadingProgressController />)
    expect(ioOptions!.rootMargin).toBe('-64px 0px 0px 0px')
    document.documentElement.style.setProperty('--vb-sticky-offset', '72px')
    window.dispatchEvent(new CustomEvent('vb:sticky-offset-change', { detail: { offset: 72 } }))
    expect(disconnectCount).toBe(1)
    expect(ioOptions!.rootMargin).toBe('-72px 0px 0px 0px')
    window.dispatchEvent(new CustomEvent('vb:sticky-offset-change', { detail: { offset: 72 } }))
    expect(disconnectCount).toBe(1) // dedup: no rebuild
    unmount()
  })
  it('re-applies active on a rail node replacement via MutationObserver', async () => {
    vi.stubGlobal('IntersectionObserver', FakeIO as unknown as typeof IntersectionObserver)
    scene()
    const { unmount } = render(<ReadingProgressController />)
    setRects({ welcome: { top: -80, bottom: 20 }, milestones: { top: 300, bottom: 500 } })
    ioCallback!()
    // Replace the welcome rail node (simulates desktop↔mobile rail swap — no IO fires).
    const old = document.querySelector('[data-vb-toc-section="welcome"]')!
    const fresh = document.createElement('button')
    fresh.setAttribute('data-vb-toc-section', 'welcome')
    old.replaceWith(fresh)
    await waitFor(() => expect(fresh.getAttribute('data-vb-active')).toBe('true'))
    unmount()
  })
  it('no-ops safely with zero heroes and zero sections (all sections hidden)', () => {
    vi.stubGlobal('IntersectionObserver', FakeIO as unknown as typeof IntersectionObserver)
    document.body.innerHTML = `<nav><button data-vb-toc-section="welcome" data-vb-active="true" aria-current="location"></button></nav>`
    document.documentElement.style.setProperty('--vb-sticky-offset', '64px')
    const { unmount } = render(<ReadingProgressController />)
    ioCallback!()
    expect(document.querySelector('[data-vb-active]')).toBeNull()
    unmount()
  })
  it('disconnects the IntersectionObserver on unmount', () => {
    vi.stubGlobal('IntersectionObserver', FakeIO as unknown as typeof IntersectionObserver)
    scene()
    const { unmount } = render(<ReadingProgressController />)
    const before = disconnectCount
    unmount()
    expect(disconnectCount).toBe(before + 1)
  })
})
