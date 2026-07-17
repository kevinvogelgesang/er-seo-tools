// Shared anchor builders (PR7 Task 8) — the ONE home so the TOC/search index
// (toc-index.ts) and the section-rendering DOM ids (Task 9) can never drift
// (Codex fix 6). Client-safe, pure string builders only.
import type { SectionKey } from './theme'

export const sectionAnchor = (k: SectionKey): string => `#${k}`
export const categoryAnchor = (cat: string): string => `#vb-cat-${cat}`
export const fieldAnchor = (id: number): string => `#vb-field-${id}`
export const milestoneAnchor = (id: number): string => `#vb-milestone-${id}`
export const materialAnchor = (id: number): string => `#vb-material-${id}`
export const docAnchor = (filename: string): string => `#vb-doc-${filename}`
