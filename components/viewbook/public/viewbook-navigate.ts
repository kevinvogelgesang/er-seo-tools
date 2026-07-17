// PR7 Task 9: the ONE client-side navigation primitive shared by the floating
// TOC rail (and any future in-page nav). Dependency-free, no React, no server
// imports. Every window/document access is guarded so an accidental
// server-side call (or a stripped-down test env) is a silent no-op, never a
// throw.
//
// Order is load-bearing: dispatch the `vb:navigate` CustomEvent on `window`
// FIRST so the owning SectionReveal (Task 4) force-expands its collapsible
// region synchronously, THEN — on the next animation frame, after the reveal
// has begun — scroll the anchor target into view and briefly flash it. The
// flash is a `.vb-flash` class (styled by the TOC rail's inline <style>); the
// class is removed after the pulse. prefers-reduced-motion is respected by the
// CSS (static tint instead of a pulse) — the JS only toggles the class and
// picks a non-smooth scroll.
import type { SectionKey } from '@/lib/viewbook/theme'

const FLASH_MS = 1200

export function navigateToAnchor(sectionKey: SectionKey, anchor: string): void {
  if (typeof window === 'undefined') return

  // 1) Tell the owning SectionReveal to force-expand BEFORE we try to scroll —
  // a collapsed region has zero height and would otherwise scroll to nothing.
  try {
    window.dispatchEvent(new CustomEvent('vb:navigate', { detail: { sectionKey, anchor } }))
  } catch {
    // CustomEvent unavailable (very old/edge env) — nothing more we can do.
    return
  }

  if (typeof document === 'undefined') return

  const prefersReduced =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const run = () => {
    let target: Element | null = null
    try {
      // `document.getElementById` takes the id verbatim (dots included) — no
      // CSS-escaping needed. `querySelector` is reserved for non-`#` selectors;
      // used on a `#vb-doc-<filename>` anchor it would parse a `.webp`/`.pdf`
      // suffix as a class selector and silently return null.
      target = anchor.startsWith('#') ? document.getElementById(anchor.slice(1)) : document.querySelector(anchor)
    } catch {
      target = null
    }
    if (!target) return

    if (typeof (target as HTMLElement).scrollIntoView === 'function') {
      try {
        ;(target as HTMLElement).scrollIntoView(
          prefersReduced ? { block: 'start' } : { behavior: 'smooth', block: 'start' },
        )
      } catch {
        // jsdom / partial impls — non-fatal.
      }
    }

    target.classList.add('vb-flash')
    window.setTimeout(() => {
      try {
        target?.classList.remove('vb-flash')
      } catch {
        // element detached — ignore.
      }
    }, FLASH_MS)
  }

  // Defer to the next frame so the reveal's expand transition has started and
  // the target has a measurable box before we scroll to it.
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(run)
  } else {
    window.setTimeout(run, 0)
  }
}
