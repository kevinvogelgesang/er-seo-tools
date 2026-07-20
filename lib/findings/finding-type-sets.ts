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
