// lib/findings/finding-type-sets.ts
//
// CLIENT-SAFE shared home for the on-page/broken-link Finding `type` id sets +
// their display labels. Read-side only — the write-side sources of truth stay
// in the mappers: `onpage-seo-mapper.ts`'s SEVERITY map defines the 7 on-page
// ids, `broken-link-mapper.ts`'s TYPE_OF defines the 3 broken ids. This module
// must never import server-only code (no prisma, no fs, no node crypto) since
// it is imported by client components (OnPageSeoSection, BrokenLinksSection)
// and, from KS-5 on, by the server-side export assembly too.

export const ONPAGE_FINDING_TYPES = [
  'missing_title',
  'duplicate_title',
  'missing_meta_description',
  'duplicate_meta_description',
  'missing_h1',
  'duplicate_h1',
  'thin_content',
] as const

export type OnPageFindingType = (typeof ONPAGE_FINDING_TYPES)[number]

export const ONPAGE_FINDING_TYPE_SET: ReadonlySet<string> = new Set(ONPAGE_FINDING_TYPES)

// Typed as a plain string-keyed record (not Record<OnPageFindingType, string>) so
// callers can index it with an arbitrary `Finding.type: string` without a cast;
// finding-type-sets.test.ts's key-set-equality check is the exhaustiveness guard.
const onpageLabels = {
  missing_title: 'Missing title',
  duplicate_title: 'Duplicate title',
  missing_meta_description: 'Missing meta description',
  duplicate_meta_description: 'Duplicate meta description',
  missing_h1: 'Missing H1',
  duplicate_h1: 'Duplicate H1',
  thin_content: 'Thin content (< 300 words)',
} satisfies Record<OnPageFindingType, string>
export const ONPAGE_FINDING_LABELS: Readonly<Record<string, string>> = onpageLabels

// Broken-link tiers: internal (critical severity — links/images on this site)
// vs external (warning severity — anti-bot-tolerant, off-site targets).
export const BROKEN_INTERNAL_FINDING_TYPES = ['broken_internal_links', 'broken_images'] as const

export type BrokenInternalFindingType = (typeof BROKEN_INTERNAL_FINDING_TYPES)[number]

export const BROKEN_INTERNAL_FINDING_TYPE_SET: ReadonlySet<string> = new Set(BROKEN_INTERNAL_FINDING_TYPES)

export const BROKEN_EXTERNAL_FINDING_TYPE = 'broken_external_links' as const

export type BrokenExternalFindingType = typeof BROKEN_EXTERNAL_FINDING_TYPE

export type BrokenFindingType = BrokenInternalFindingType | BrokenExternalFindingType

export const BROKEN_FINDING_TYPES = [
  ...BROKEN_INTERNAL_FINDING_TYPES,
  BROKEN_EXTERNAL_FINDING_TYPE,
] as const

export const BROKEN_FINDING_TYPE_SET: ReadonlySet<string> = new Set(BROKEN_FINDING_TYPES)

const brokenLabels = {
  broken_internal_links: 'Broken internal links',
  broken_images: 'Broken images',
  broken_external_links: 'Broken external links',
} satisfies Record<BrokenFindingType, string>
export const BROKEN_FINDING_LABELS: Readonly<Record<string, string>> = brokenLabels

export const DEAD_PAGE_FINDING_TYPE = 'dead_page' as const
export const DEAD_PAGE_FINDING_LABEL = 'Dead pages (404/410)'

// Anchor-text findings (live-scan runs only) — parity with the SF anchor parser.
// empty/non-descriptive are per-source-page (unit 'links'); single-variation is
// a run-scope destination-diversity signal (unit 'pages'). Write-side source of
// truth = anchor-text-mapper.ts's SEVERITY map.
export const ANCHOR_FINDING_TYPES = [
  'empty_anchor_text',
  'non_descriptive_anchor_text',
  'single_anchor_variation',
] as const
export type AnchorFindingType = (typeof ANCHOR_FINDING_TYPES)[number]
export const ANCHOR_FINDING_TYPE_SET: ReadonlySet<string> = new Set(ANCHOR_FINDING_TYPES)
const anchorLabels = {
  empty_anchor_text: 'Empty anchor text',
  non_descriptive_anchor_text: 'Non-descriptive anchor text',
  single_anchor_variation: 'Single anchor-text variation',
} satisfies Record<AnchorFindingType, string>
export const ANCHOR_FINDING_LABELS: Readonly<Record<string, string>> = anchorLabels

// ---------------------------------------------------------------------------
// Sweep issue-unit map (the ONE home — sweep-error-triage Bucket 5).
// `IssueUnit` is the sweep snapshot's per-group counting noun. This client-safe
// lookup returns the unit for every KNOWN finding type; `null` means "unknown"
// and the caller (snapshot.ts) logs it + falls back to 'groups'. Keeping the
// type→unit knowledge here prevents the drift bucket 5 was about (validation
// types silently falling through to the fallback).
// ---------------------------------------------------------------------------
export type IssueUnit = 'pages' | 'targets' | 'groups' | 'links'

// Duplicate on-page types count DUPLICATE GROUPS (SF pageTitles.parser semantics);
// missing/thin count PAGES.
const DUPLICATE_ONPAGE_TYPES: ReadonlySet<string> = new Set([
  'duplicate_title',
  'duplicate_meta_description',
  'duplicate_h1',
])
const MISSING_THIN_ONPAGE_TYPES: ReadonlySet<string> = new Set([
  'missing_title',
  'missing_meta_description',
  'missing_h1',
  'thin_content',
])

// Validation types: page-derived (run count = distinct affected pages) vs
// external-unverified notices (run count = distinct external targets).
const VALIDATION_PAGE_TYPES: ReadonlySet<string> = new Set([
  'canonical_broken',
  'canonical_redirect',
  'redirect_chain',
  'redirect_loop',
  'hreflang_broken',
  'hreflang_no_return',
  'hreflang_missing_self',
  'hreflang_missing_x_default',
  'hreflang_invalid_code',
])
const VALIDATION_TARGET_TYPES: ReadonlySet<string> = new Set([
  'canonical_external_unverified',
  'hreflang_external_unverified',
])

export function findingUnit(tool: 'ada-audit' | 'seo-parser', type: string): IssueUnit | null {
  if (tool === 'ada-audit') return 'pages' // all axe rule types are page-scoped
  if (BROKEN_FINDING_TYPE_SET.has(type)) return 'targets'
  if (DUPLICATE_ONPAGE_TYPES.has(type)) return 'groups'
  if (MISSING_THIN_ONPAGE_TYPES.has(type)) return 'pages'
  if (VALIDATION_PAGE_TYPES.has(type)) return 'pages'
  if (VALIDATION_TARGET_TYPES.has(type)) return 'targets'
  if (type === DEAD_PAGE_FINDING_TYPE) return 'pages'
  if (type === 'empty_anchor_text' || type === 'non_descriptive_anchor_text') return 'links'
  if (type === 'single_anchor_variation') return 'pages'
  return null
}
