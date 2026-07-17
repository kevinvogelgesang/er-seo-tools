// @vitest-environment jsdom
// PR7 Task 9 review fix: `navigateToAnchor` resolves `#vb-doc-<filename>`
// anchors, and those filenames end `.webp`/`.pdf`. Regression coverage for the
// bug where `document.querySelector('#vb-doc-a.webp')` parsed `.webp` as a
// class selector, returned null, and silently dropped the scroll/flash.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { navigateToAnchor } from './viewbook-navigate'

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('navigateToAnchor', () => {
  it('flashes a dotted-id doc anchor (e.g. #vb-doc-a.webp) instead of silently missing it', async () => {
    const el = document.createElement('div')
    el.id = 'vb-doc-a.webp'
    // jsdom does not implement scrollIntoView; stub it so the code path runs.
    el.scrollIntoView = vi.fn()
    document.body.appendChild(el)

    navigateToAnchor('strategy', '#vb-doc-a.webp')

    // The scroll/flash work is deferred to requestAnimationFrame.
    await new Promise((resolve) => requestAnimationFrame(resolve))

    expect(el.classList.contains('vb-flash')).toBe(true)
  })

  it('still flashes a plain (non-dotted) anchor', async () => {
    const el = document.createElement('div')
    el.id = 'vb-section-strategy'
    el.scrollIntoView = vi.fn()
    document.body.appendChild(el)

    navigateToAnchor('strategy', '#vb-section-strategy')

    await new Promise((resolve) => requestAnimationFrame(resolve))

    expect(el.classList.contains('vb-flash')).toBe(true)
  })
})
