// Client-safe. Validation mirrors the pre-hydration script in app/layout.tsx —
// keep the two in sync (Codex fix 3: only the literal 'collapsed' is honored).
export const SIDEBAR_STORAGE_KEY = 'er-sidebar'

export type SidebarPref = 'collapsed' | 'expanded'

export function readSidebarPref(raw: string | null): SidebarPref {
  return raw === 'collapsed' ? 'collapsed' : 'expanded'
}
