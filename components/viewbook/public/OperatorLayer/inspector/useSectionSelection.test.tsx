// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, act } from '@testing-library/react'
import { useSectionSelection } from './useSectionSelection'
import * as sel from './SelectionContext'

let ioCb: (entries: any[]) => void
beforeEach(() => {
  ;(globalThis as any).IntersectionObserver = class {
    constructor(fn: any) { ioCb = fn }
    observe() {} ; unobserve() {} ; disconnect() {}
  }
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete (globalThis as any).IntersectionObserver })

function Host({ keys }: { keys: readonly ('welcome'|'brand')[] }) { useSectionSelection(keys); return null }

describe('useSectionSelection', () => {
  it('selects the section with the most VISIBLE PIXELS, not the highest ratio', () => {
    const observe = vi.fn()
    vi.spyOn(sel, 'useSelectionContext').mockReturnValue({ ...(sel as any), observe, isPinned: false, selectedKey: null, pinnedKind: null, release: vi.fn(), select: vi.fn(), pinnedKey: null, selectedGroup: null } as any)
    document.body.innerHTML = '<div data-operator-section="welcome"></div><div data-operator-section="brand"></div>'
    const keys = ['welcome', 'brand'] as const
    render(<Host keys={keys} />)
    act(() => ioCb([
      // welcome: small but fully visible (high ratio, few px); brand: tall, more visible px
      { target: document.querySelector('[data-operator-section="welcome"]'), isIntersecting: true, intersectionRatio: 1, intersectionRect: { height: 120 } },
      { target: document.querySelector('[data-operator-section="brand"]'), isIntersecting: true, intersectionRatio: 0.4, intersectionRect: { height: 400 } },
    ]))
    expect(observe).toHaveBeenCalledWith('brand')
  })
})
