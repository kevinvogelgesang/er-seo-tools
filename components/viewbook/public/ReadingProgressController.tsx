'use client'

// The scroll-driven active-rail + hero-exit controller (spec §6, §8). Writes
// ONLY presentational DOM attributes — never React state, never height/collapse
// (the documented blink-bug rule). Mounted once by ViewbookShell in continuous
// mode. Returns null.
import { useEffect } from 'react'

const SECTION_SELECTOR = '[data-vb-section]'
const HERO_SELECTOR = '[data-vb-hero]'
const RAIL_SELECTOR = '[data-vb-toc-section]'

function stickyOffset(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--vb-sticky-offset')
  const n = parseFloat(raw)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function setFallbackVisibility(): void {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(SECTION_SELECTOR))) {
    el.setAttribute('data-vb-hero-visible', 'false')
  }
}

export function ReadingProgressController() {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.IntersectionObserver !== 'function') {
      setFallbackVisibility()
      return
    }

    let observer: IntersectionObserver | null = null
    let lastBuiltOffset = -1
    let framePending = false
    let pending: { heroes: HTMLElement[]; line: number } | null = null
    let disposed = false
    let currentHeroes: HTMLElement[] = []
    let currentLine = 0

    function nodeTouches(nodes: NodeList, selector: string): boolean {
      for (const n of Array.from(nodes)) {
        if (!(n instanceof Element)) continue
        if (n.matches(selector) || n.querySelector(selector)) return true
      }
      return false
    }

    function applyActive(sectionKey: string | null): void {
      for (const node of Array.from(document.querySelectorAll<HTMLElement>(RAIL_SELECTOR))) {
        node.removeAttribute('data-vb-active')
        node.removeAttribute('aria-current')
      }
      if (!sectionKey) return
      const node = document.querySelector<HTMLElement>(`[data-vb-toc-section="${sectionKey}"]`)
      if (node) {
        node.setAttribute('data-vb-active', 'true')
        node.setAttribute('aria-current', 'location')
      }
    }

    function runCommit(heroes: HTMLElement[], line: number): void {
      if (disposed) return
      if (heroes.length === 0) {
        applyActive(null)
        return
      }
      let activeKey: string | null = (heroes[0].closest(SECTION_SELECTOR) as HTMLElement | null)?.dataset.vbSection ?? null
      for (const hero of heroes) {
        const section = hero.closest(SECTION_SELECTOR) as HTMLElement | null
        if (!section) continue
        const rect = hero.getBoundingClientRect()
        section.setAttribute('data-vb-hero-visible', rect.bottom > line ? 'true' : 'false')
        if (rect.top <= line) activeKey = section.dataset.vbSection ?? activeKey
      }
      applyActive(activeKey)
    }

    function commit(heroes: HTMLElement[], line: number): void {
      pending = { heroes, line }
      if (framePending) return
      framePending = true
      requestAnimationFrame(() => {
        framePending = false
        const snap = pending
        pending = null
        if (snap) runCommit(snap.heroes, snap.line)
      })
    }

    function buildObserver(): void {
      const line = stickyOffset()
      lastBuiltOffset = line
      currentLine = line
      observer?.disconnect()
      const heroes = Array.from(document.querySelectorAll<HTMLElement>(HERO_SELECTOR))
      currentHeroes = heroes
      observer = new IntersectionObserver(() => commit(heroes, line), {
        rootMargin: `-${line}px 0px 0px 0px`,
        threshold: [0, 1],
      })
      for (const hero of heroes) observer.observe(hero)
      commit(heroes, line)
    }

    function onStickyOffsetChange(event: Event): void {
      const offset = (event as CustomEvent).detail?.offset
      if (typeof offset === 'number' && Number.isFinite(offset) && offset === lastBuiltOffset) return
      buildObserver()
    }

    buildObserver()
    window.addEventListener('vb:sticky-offset-change', onStickyOffsetChange)

    // DOM-refresh invalidation (spec §6): a desktop↔mobile rail swap or a live
    // re-render changes the [data-vb-toc-section] / hero nodes WITHOUT an IO
    // callback. Distinguish: if the HERO set changed, REBUILD the
    // IntersectionObserver (so it observes the live hero nodes, not stale ones);
    // if only RAIL nodes changed, just re-commit with the current heroes
    // (re-applies data-vb-active to the fresh rail node). The controller only
    // ever writes ATTRIBUTES (not childList), so it never triggers this on itself.
    let mutationObserver: MutationObserver | null = null
    if (typeof MutationObserver !== 'undefined') {
      mutationObserver = new MutationObserver((records) => {
        let heroChanged = false
        let railChanged = false
        for (const r of records) {
          if (nodeTouches(r.addedNodes, HERO_SELECTOR) || nodeTouches(r.removedNodes, HERO_SELECTOR)) heroChanged = true
          if (nodeTouches(r.addedNodes, RAIL_SELECTOR) || nodeTouches(r.removedNodes, RAIL_SELECTOR)) railChanged = true
        }
        if (heroChanged) buildObserver()
        else if (railChanged) commit(currentHeroes, currentLine)
      })
      mutationObserver.observe(document.body, { subtree: true, childList: true })
    }

    return () => {
      disposed = true
      pending = null
      observer?.disconnect()
      mutationObserver?.disconnect()
      window.removeEventListener('vb:sticky-offset-change', onStickyOffsetChange)
    }
  }, [])

  return null
}
