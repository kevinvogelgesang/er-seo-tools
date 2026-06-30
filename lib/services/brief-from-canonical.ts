// lib/services/brief-from-canonical.ts
//
// Task 12: provider-fed brief (live, degraded keywords/schema).
//
// Pulls canonical page facts via getCanonicalPageFacts, maps each
// CanonicalPageFact to the brief Page shape, then calls the pure
// generateBrief() with empty schemaData + keywords (degraded path —
// live facts carry no SEMrush keywords and no persisted schema data).
//
// No persistence: returns a BriefResult directly.

import { prisma } from '@/lib/db'
import { getCanonicalPageFacts } from './canonical-page-facts'
import type { CanonicalPageFact } from './canonical-page-facts'
import { generateBrief } from './brief.service'

// Re-export the return type so callers don't need a separate import
export type { BriefResult } from './brief.service'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Maps a CanonicalPageFact to the Page shape expected by generateBrief.
 *
 * Mapping rules (from task-12-brief.md):
 *   - indexability: fact.indexability (string) takes priority; if absent,
 *     derive from fact.indexable boolean; default 'Unknown'.
 *   - metaDesc / title / h1: ?? '' (empty string, not undefined)
 *   - wordCount / inlinks: ?? 0
 *     (0 inlinks = orphan — correct semantics for generateBrief's orphan calc)
 *   - statusCode: ?? 0
 *     (0 passes the `< 400` gate in identifyPrograms + indexable count, so
 *     pages with unknown status are treated as non-error — acceptable because
 *     brief uses statusCode only for status grouping, not for display)
 */
function mapFactToPage(fact: CanonicalPageFact): {
  url: string
  title: string
  statusCode: number
  indexability: string
  wordCount: number
  inlinks: number
  h1: string
  metaDesc: string
} {
  const indexability =
    fact.indexability != null
      ? fact.indexability
      : fact.indexable === true
        ? 'Indexable'
        : fact.indexable === false
          ? 'Non-Indexable'
          : 'Unknown'

  return {
    url: fact.url,
    title: fact.title ?? '',
    statusCode: fact.statusCode ?? 0,
    indexability,
    wordCount: fact.wordCount ?? 0,
    inlinks: fact.inlinks ?? 0,
    h1: fact.h1 ?? '',
    metaDesc: fact.metaDescription ?? '',
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds an SEO brief from the canonical live-scan (or SF-upload) run for the
 * given client + domain.  Returns null if no qualifying canonical run exists.
 *
 * Schema and keyword sections are deliberately degraded (empty arrays) because
 * live-scan facts carry no SEMrush keywords and no structured-data export.
 * generateBrief renders "*No structured data export provided*" and
 * "*No keyword data provided*" gracefully for those sections.
 */
export async function buildBriefFromCanonical(args: {
  clientId: number
  domain: string
}): Promise<ReturnType<typeof generateBrief> | null> {
  const canonicalFacts = await getCanonicalPageFacts(args)
  if (!canonicalFacts) return null

  // Fetch the client name for the brief heading
  const client = await prisma.client.findUnique({
    where: { id: args.clientId },
    select: { name: true },
  })
  const clientName = client?.name ?? args.domain

  const pages = canonicalFacts.pages.map(mapFactToPage)

  // Degraded: pass empty schemaData + keywords — live facts carry neither
  return generateBrief(clientName, pages, [], [])
}
