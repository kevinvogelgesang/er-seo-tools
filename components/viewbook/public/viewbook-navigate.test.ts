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

  // Task 8 characterization: locks the load-bearing order documented in the
  // header comment above — `vb:navigate` (which the Task-2 SectionReveal
  // listener uses to force-open a collapsed region via `detail.sectionKey`)
  // MUST fire synchronously, before the deferred (next-animation-frame)
  // scrollIntoView call. If a collapsed region isn't opened before the
  // scroll runs, the target has zero layout height and scrollIntoView lands
  // on nothing. This test should PASS against current code — if it fails,
  // the dispatch-before-scroll contract has regressed.
  it('dispatches vb:navigate (with detail.sectionKey) BEFORE scrollIntoView runs', async () => {
    const order: string[] = []
    let capturedDetail: { sectionKey?: string; anchor?: string } | null = null

    const dispatchSpy = vi.spyOn(window, 'dispatchEvent').mockImplementation((event: Event) => {
      if (event.type === 'vb:navigate') {
        order.push('dispatch')
        capturedDetail = (event as CustomEvent).detail as { sectionKey?: string; anchor?: string }
      }
      return true
    })

    const el = document.createElement('div')
    el.id = 'vb-section-order-check'
    el.scrollIntoView = vi.fn(() => {
      order.push('scroll')
    })
    document.body.appendChild(el)

    navigateToAnchor('strategy', '#vb-section-order-check')

    // The dispatch is synchronous — it must have already happened, and the
    // scroll must NOT have happened yet (it's deferred to the next frame).
    expect(order).toEqual(['dispatch'])
    expect(capturedDetail).toEqual({ sectionKey: 'strategy', anchor: '#vb-section-order-check' })

    await new Promise((resolve) => requestAnimationFrame(resolve))

    // Non-vacuous order check: scroll ran, and strictly after dispatch.
    expect(order).toEqual(['dispatch', 'scroll'])

    dispatchSpy.mockRestore()
  })
})
