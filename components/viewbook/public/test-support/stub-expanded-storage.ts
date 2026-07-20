// Test helper for the 2026-07-19 collapse local-only revision (docs/
// superpowers/specs/2026-07-19-viewbook-collapse-local-revision.md).
//
// Every collapsible section now defaults to COLLAPSED via
// useCollapseState's localStorage read (see ../useCollapseState.ts). Content
// tests that render a section component directly and assert on its BODY
// (links, forms, copy) don't care about the collapse affordance — they need
// the body visible, same as before this revision. Call this in a
// `beforeEach` so `localStorage.getItem` always answers 'expanded'
// regardless of key.
//
// Tests that assert on the collapse behavior ITSELF (SectionShell/
// CollapsibleSection/useCollapseState) stub their OWN precise per-key Map
// instead — they need to observe absent/'collapsed'/'expanded' distinctly.
import { vi } from 'vitest'

export function stubAllSectionsExpanded(): void {
  vi.stubGlobal('localStorage', {
    getItem: () => 'expanded',
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  })
}
