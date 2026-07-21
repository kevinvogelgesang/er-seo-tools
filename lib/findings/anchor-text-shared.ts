// lib/findings/anchor-text-shared.ts
//
// CLIENT-SAFE single source of truth for anchor-text normalization + the
// non-descriptive list, shared by the SF parser (anchorText.parser.ts) and the
// live-scan builder/mapper so the live rule never drifts from SF. No server imports.

export const ANCHOR_TEXT_MAX = 2048

// Trim only + a size guard (SF trims only; the cap bounds pathological DOM text
// and is effectively never hit — see spec §6 fix-6). NOT a whitespace collapse.
export function normalizeAnchorText(raw: string): string {
  return raw.trim().slice(0, ANCHOR_TEXT_MAX)
}

export const NON_DESCRIPTIVE_ANCHORS: readonly string[] = [
  'click here', 'read more', 'learn more', 'more', 'here', 'link', 'this',
  'page', 'click', 'go', 'see more', 'view more', 'continue', 'details', 'info',
]
const NON_DESCRIPTIVE_SET = new Set(NON_DESCRIPTIVE_ANCHORS)

export function isNonDescriptiveAnchor(text: string): boolean {
  return NON_DESCRIPTIVE_SET.has(text.trim().toLowerCase())
}
