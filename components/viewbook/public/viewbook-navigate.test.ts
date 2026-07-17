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

  // Review fix P2: a search/nav target inside a CLOSED <details> (building-stage
  // carried sections, DataSource category/field <details>) has no layout box —
  // scrollIntoView would land on nothing. Every enclosing closed <details>
  // ancestor must be opened before the scroll/flash.
  it('opens nested closed <details> ancestors before flashing the target', async () => {
    document.body.innerHTML = `
      <details id="outer"><summary>outer</summary>
        <details id="inner"><summary>inner</summary>
          <div id="vb-field-5">field</div>
        </details>
      </details>`
    const outer = document.getElementById('outer') as HTMLDetailsElement
    const inner = document.getElementById('inner') as HTMLDetailsElement
    const target = document.getElementById('vb-field-5') as HTMLElement
    target.scrollIntoView = vi.fn()
    expect(outer.open).toBe(false)
    expect(inner.open).toBe(false)

    navigateToAnchor('data-source', '#vb-field-5')

    await new Promise((resolve) => requestAnimationFrame(resolve))

    expect(inner.open).toBe(true)
    expect(outer.open).toBe(true)
    expect(target.classList.contains('vb-flash')).toBe(true)
  })
})
