'use client'

// Viewbook collapse state — 2026-07-19 revision, PURELY LOCAL / per-machine.
// See docs/superpowers/specs/2026-07-19-viewbook-collapse-local-revision.md.
// The prior shared/server model (personal-override-over-shared-default,
// pending/latch/awaiting-shared reconciliation, requestRefresh nudges) is
// retired — none of that machinery has a reason to exist once the server is
// out of the loop.
//
// Effective state lives ENTIRELY in localStorage, per (viewbookId,
// sectionKey):
//   - stored value is 'expanded' | 'collapsed' | absent.
//   - absent ⇒ default COLLAPSED — every collapsible section starts
//     collapsed on a fresh machine/browser. All sections are collapsible now
//     (2026-07-19 welcome-auto-reveal) — the two bookend sections (pc-intro/
//     pc-thanks) are no longer excluded; the guard excludes nothing now.
// expand()/collapse() persist the choice (unless previewMode, which never
// touches localStorage — ThemePreview only ever renders visuals, it is not a
// real viewbook). forceExpand() is an EPHEMERAL, never-persisted override
// used by vb:navigate/#hash force-open, so landing on a shared link can't
// silently flip this viewer's stored preference for next time.
import { useCallback, useEffect, useState } from 'react'

export function collapseKey(viewbookId: number, sectionKey: string): string {
  return `vb:collapse:${viewbookId}:${sectionKey}`
}

function readStored(key: string): 'expanded' | 'collapsed' | null {
  try {
    const v = localStorage.getItem(key)
    return v === 'expanded' || v === 'collapsed' ? v : null
  } catch {
    return null
  }
}

function writeStored(key: string, value: 'expanded' | 'collapsed'): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // localStorage unavailable (private mode etc) — in-memory state still applies.
  }
}

export function useCollapseState({
  viewbookId,
  sectionKey,
  previewMode = false,
}: {
  viewbookId: number
  sectionKey: string
  previewMode?: boolean
}) {
  const key = collapseKey(viewbookId, sectionKey)
  // SSR-safe seed: default COLLAPSED on both the server and the first client
  // paint (no window/localStorage read during render) — the mount effect
  // below reconciles to the real stored value (or the default) immediately
  // after, matching every other island's hydration-safe convention.
  const [collapsed, setCollapsed] = useState(true)
  // Task 11 (2026-07-19, docs/superpowers/sdd/task-11-brief.md): key-scoped
  // `ready` flag for a later auto-reveal hook that needs to wait until the
  // localStorage reconciliation below has actually run before it acts on
  // `collapsed`. Tracking the KEY (not a plain boolean) that was last
  // reconciled — rather than a bare `reconciled` boolean — means a reused/
  // re-keyed component (viewbookId/sectionKey changes without unmounting)
  // can't expose a stale `ready=true` for the OLD key's state; `ready` drops
  // back to false the instant `key` changes and stays false until the effect
  // below reconciles for the NEW key. Deliberately NOT an `interacted` flag —
  // Codex rejected folding interaction-tracking into this generic hook (see
  // file banner); a later auto-reveal hook owns its own one-shot consumption.
  const [reconciledKey, setReconciledKey] = useState<string | null>(null)

  useEffect(() => {
    // ThemePreview isn't a real viewbook — it must always render fully open
    // (the admin is previewing brand colors/fonts in the body) and must
    // never depend on whatever this browser happens to have stored under
    // the placeholder preview key.
    if (previewMode) {
      setCollapsed(false)
      setReconciledKey(key)
      return
    }
    const stored = readStored(key)
    setCollapsed(stored === null ? true : stored === 'collapsed')
    setReconciledKey(key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, previewMode])

  const ready = reconciledKey === key

  const expand = useCallback(() => {
    setCollapsed(false)
    if (!previewMode) writeStored(key, 'expanded')
  }, [key, previewMode])

  const collapse = useCallback(() => {
    setCollapsed(true)
    if (!previewMode) writeStored(key, 'collapsed')
  }, [key, previewMode])

  // vb:navigate (TOC/inspector clicks) / initial #hash — force this section
  // open right now WITHOUT persisting, so a one-off inbound link never
  // rewrites this viewer's stored preference.
  const forceExpand = useCallback(() => {
    setCollapsed(false)
  }, [])

  return { collapsed, expand, collapse, forceExpand, ready }
}
