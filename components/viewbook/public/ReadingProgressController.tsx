'use client'

import { useEffect } from 'react'

const SECTION_SELECTOR = '[data-vb-section]'
const HERO_SELECTOR = '[data-vb-hero]'
const RAIL_SELECTOR = '[data-vb-toc-section]'

function stickyOffset(): number {
  const raw = window.getComputedStyle(document.documentElement).getPropertyValue('--vb-sticky-offset')
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) && value >= 0 ? value : 0
}

function setFallbackVisibility(): void {
  for (const section of document.querySelectorAll<HTMLElement>(SECTION_SELECTOR)) {
    section.setAttribute('data-vb-hero-visible', 'false')
  }
}

export function ReadingProgressController() {
  useEffect(() => {
    if (typeof window.IntersectionObserver !== 'function') {
      setFallbackVisibility()
      return
    }

    let observer: IntersectionObserver | null = null
    let lastBuiltOffset: number | null = null
    let framePending = false
    let pendingCommit: { heroes: HTMLElement[]; activationLine: number } | null = null
    let disposed = false

    const commit = (heroes: HTMLElement[], activationLine: number) => {
      // Coalesce rapid observer callbacks while retaining the newest layout
      // snapshot (including a just-rebuilt observer's sticky offset).
      pendingCommit = { heroes, activationLine }
      if (framePending) return
      framePending = true
      window.requestAnimationFrame(() => {
        framePending = false
        if (disposed) return
        const next = pendingCommit
        pendingCommit = null
        if (!next) return

        let activeSection: HTMLElement | null = next.heroes[0]?.closest<HTMLElement>(SECTION_SELECTOR) ?? null
        for (const hero of next.heroes) {
          const section = hero.closest<HTMLElement>(SECTION_SELECTOR)
          if (!section) continue

          const rect = hero.getBoundingClientRect()
          section.setAttribute('data-vb-hero-visible', rect.bottom > next.activationLine ? 'true' : 'false')
          if (rect.top <= next.activationLine) activeSection = section
        }

        // The desktop rail can be replaced by the mobile sheet after mount.
        // Query the current nodes for every commit; never retain a rail node.
        const railNodes = document.querySelectorAll<HTMLElement>(RAIL_SELECTOR)
        for (const node of railNodes) {
          node.removeAttribute('data-vb-active')
          node.removeAttribute('aria-current')
        }

        const activeKey = activeSection?.getAttribute('data-vb-section')
        if (!activeKey) return
        const liveNode = [...document.querySelectorAll<HTMLElement>(RAIL_SELECTOR)].find(
          (node) => node.getAttribute('data-vb-toc-section') === activeKey,
        )
        liveNode?.setAttribute('data-vb-active', 'true')
        liveNode?.setAttribute('aria-current', 'location')
      })
    }

    const buildObserver = () => {
      const activationLine = stickyOffset()
      lastBuiltOffset = activationLine
      observer?.disconnect()

      const heroes = [...document.querySelectorAll<HTMLElement>(HERO_SELECTOR)]
      observer = new window.IntersectionObserver(
        () => commit(heroes, activationLine),
        {
          rootMargin: `-${activationLine}px 0px 0px 0px`,
          // 1 catches a hero top crossing the activation line; 0 catches its
          // bottom leaving it. The callback then reads every stable hero rect.
          threshold: [0, 1],
        },
      )
      for (const hero of heroes) observer.observe(hero)
      commit(heroes, activationLine)
    }

    const onStickyOffsetChange = (event: Event) => {
      const detailOffset = Number((event as CustomEvent<{ offset?: number }>).detail?.offset)
      if (Number.isFinite(detailOffset) && detailOffset === lastBuiltOffset) return
      buildObserver()
    }

    buildObserver()
    window.addEventListener('vb:sticky-offset-change', onStickyOffsetChange)
    return () => {
      disposed = true
      pendingCommit = null
      observer?.disconnect()
      window.removeEventListener('vb:sticky-offset-change', onStickyOffsetChange)
    }
  }, [])

  return null
}
