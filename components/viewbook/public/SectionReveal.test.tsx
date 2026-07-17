// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, cleanup, act, fireEvent } from '@testing-library/react'
import { SectionReveal } from './SectionReveal'
import * as sync from './useViewbookSync'

let ioCb: (e: any[]) => void
beforeEach(() => {
  cleanup(); ioCb = () => {}
  ;(globalThis as any).IntersectionObserver = class { constructor(cb: any){ ioCb = cb } observe(){} unobserve(){} disconnect(){} }
  ;(window as any).matchMedia = (q: string) => ({ matches: false, media: q, addEventListener(){}, removeEventListener(){} })
  vi.spyOn(sync, 'hasActiveEditorActivity').mockReturnValue(false)
  window.location.hash = ''
})
const expanded = (r: HTMLElement) => (r.querySelector('[role="region"]') as HTMLElement)?.getAttribute('data-vb-expanded') === 'true'
const base = { title: 'Data Source', summary: <span>sum</span> }

describe('SectionReveal', () => {
  it('normal section: SSR-expanded, collapses on leave, re-expands on enter', () => {
    const { container } = render(<SectionReveal sectionKey="data-source" {...base} startCollapsed={false} lockAutoReveal={false} alwaysOpen={false}><p>body</p></SectionReveal>)
    expect(expanded(container)).toBe(true)                               // SSR/initial expanded
    act(() => ioCb([{ isIntersecting: false, intersectionRatio: 0 }]))
    expect(expanded(container)).toBe(false)                              // leave → collapse
    act(() => ioCb([{ isIntersecting: true, intersectionRatio: 0.6 }]))
    expect(expanded(container)).toBe(true)                              // enter → expand
  })
  it('always-open (pc-intro) never collapses on leave', () => {
    const { container } = render(<SectionReveal sectionKey="pc-intro" title="Welcome" startCollapsed={false} lockAutoReveal alwaysOpen><p>b</p></SectionReveal>)
    act(() => ioCb([{ isIntersecting: false, intersectionRatio: 0 }]))
    expect(expanded(container)).toBe(true)
  })
  it('locked (done/ack) starts collapsed and does not auto-expand', () => {
    const { container } = render(<SectionReveal sectionKey="pc-setup" title="Setup" startCollapsed lockAutoReveal alwaysOpen={false}><p>b</p></SectionReveal>)
    expect(expanded(container)).toBe(false)
    act(() => ioCb([{ isIntersecting: true, intersectionRatio: 0.9 }]))
    expect(expanded(container)).toBe(false)
  })
  it('manual toggle wins over subsequent scroll', () => {
    const { container } = render(<SectionReveal sectionKey="data-source" {...base} startCollapsed={false} lockAutoReveal={false} alwaysOpen={false}><p>b</p></SectionReveal>)
    act(() => (container.querySelector('button[aria-expanded]') as HTMLButtonElement).click()) // manual collapse
    act(() => ioCb([{ isIntersecting: true, intersectionRatio: 0.9 }]))
    expect(expanded(container)).toBe(false)
  })
  it('never auto-collapses while holding focus', () => {
    const { container } = render(<SectionReveal sectionKey="data-source" {...base} startCollapsed={false} lockAutoReveal={false} alwaysOpen={false}><input aria-label="q"/></SectionReveal>)
    ;(container.querySelector('input') as HTMLInputElement).focus()
    act(() => ioCb([{ isIntersecting: false, intersectionRatio: 0 }]))
    expect(expanded(container)).toBe(true)
  })
  it('never auto-collapses while editor activity is reported (operator edits outside this DOM)', () => {
    ;(sync.hasActiveEditorActivity as any).mockReturnValue(true)
    const { container } = render(<SectionReveal sectionKey="data-source" {...base} startCollapsed={false} lockAutoReveal={false} alwaysOpen={false}><p>b</p></SectionReveal>)
    act(() => ioCb([{ isIntersecting: false, intersectionRatio: 0 }]))
    expect(expanded(container)).toBe(true)
  })
  it('reduced-motion: normal renders expanded + static (no observer collapse)', () => {
    ;(window as any).matchMedia = (q: string) => ({ matches: true, media: q, addEventListener(){}, removeEventListener(){} })
    const { container } = render(<SectionReveal sectionKey="brand" {...base} startCollapsed={false} lockAutoReveal={false} alwaysOpen={false}><p>b</p></SectionReveal>)
    expect(expanded(container)).toBe(true)
    act(() => ioCb([{ isIntersecting: false, intersectionRatio: 0 }]))
    expect(expanded(container)).toBe(true)
  })
  it('reduced-motion: locked stays collapsed', () => {
    ;(window as any).matchMedia = (q: string) => ({ matches: true, media: q, addEventListener(){}, removeEventListener(){} })
    const { container } = render(<SectionReveal sectionKey="pc-setup" title="Setup" startCollapsed lockAutoReveal alwaysOpen={false}><p>b</p></SectionReveal>)
    expect(expanded(container)).toBe(false)
  })
  it('vb:navigate to this section force-expands even when locked', () => {
    const { container } = render(<SectionReveal sectionKey="pc-setup" title="Setup" startCollapsed lockAutoReveal alwaysOpen={false}><p>b</p></SectionReveal>)
    act(() => window.dispatchEvent(new CustomEvent('vb:navigate', { detail: { sectionKey: 'pc-setup', anchor: '#pc-setup' } })))
    expect(expanded(container)).toBe(true)
  })
  it('initial-load hash expands the owning section', () => {
    window.location.hash = '#pc-setup'
    const { container } = render(<SectionReveal sectionKey="pc-setup" title="Setup" startCollapsed lockAutoReveal alwaysOpen={false}><p>b</p></SectionReveal>)
    expect(expanded(container)).toBe(true)
  })
})
