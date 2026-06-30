// lib/services/canonical-page-facts.ts
//
// D2 canonical page-facts provider.
// Resolves the canonical SEO CrawlRun for a client+domain (via Task 5
// selectCanonicalSeoRun) and returns per-URL facts from the normalized
// CrawlPage rows.  Fields that the source cannot supply are OMITTED — never
// faked. schemaTypes is not a CrawlPage scalar and is omitted on both branches.

import { prisma } from '@/lib/db'
import { selectCanonicalSeoRun } from './seo-canonical'

export interface CanonicalPageFact {
  url: string
  title?: string | null
  h1?: string | null
  metaDescription?: string | null
  wordCount?: number | null
  crawlDepth?: number | null
  inlinks?: number | null
  outlinks?: number | null
  indexable?: boolean | null
  schemaTypes?: string[]
  statusCode?: number | null
  indexability?: string | null
}

export interface CanonicalPageFacts {
  source: 'sf-upload' | 'live-scan'
  pages: CanonicalPageFact[]
}

/**
 * Returns per-URL facts from the canonical SEO run for the given
 * client+domain, or null if no qualifying run exists.
 */
export async function getCanonicalPageFacts(args: {
  clientId: number
  domain: string
}): Promise<CanonicalPageFacts | null> {
  const canonical = await selectCanonicalSeoRun(args)
  if (!canonical) return null

  const dbPages = await prisma.crawlPage.findMany({
    where: { runId: canonical.run.id },
    select: {
      url: true,
      title: true,
      h1: true,
      metaDescription: true,
      wordCount: true,
      crawlDepth: true,
      inlinks: true,
      outlinks: true,
      indexable: true,
      statusCode: true,
    },
  })

  const source = canonical.source

  const pages: CanonicalPageFact[] = dbPages.map((p) => {
    if (source === 'sf-upload') {
      // SF-upload runs: CrawlPage carries title/h1/meta/wordCount/crawlDepth/
      // inlinks/outlinks/indexable. statusCode is null (SF CSV path doesn't
      // persist it via this seam).
      const fact: CanonicalPageFact = { url: p.url }
      if (p.title !== null) fact.title = p.title
      if (p.h1 !== null) fact.h1 = p.h1
      if (p.metaDescription !== null) fact.metaDescription = p.metaDescription
      if (p.wordCount !== null) fact.wordCount = p.wordCount
      if (p.crawlDepth !== null) fact.crawlDepth = p.crawlDepth
      if (p.inlinks !== null) fact.inlinks = p.inlinks
      if (p.outlinks !== null) fact.outlinks = p.outlinks
      if (p.indexable !== null) fact.indexable = p.indexable
      return fact
    } else {
      // live-scan runs: CrawlPage carries statusCode/indexable/crawlDepth/
      // inlinks/outlinks via on-page extraction. title/h1/meta/wordCount
      // may also be present (HarvestedPageSeo scalars).
      const fact: CanonicalPageFact = { url: p.url }
      if (p.title !== null) fact.title = p.title
      if (p.h1 !== null) fact.h1 = p.h1
      if (p.metaDescription !== null) fact.metaDescription = p.metaDescription
      if (p.wordCount !== null) fact.wordCount = p.wordCount
      if (p.crawlDepth !== null) fact.crawlDepth = p.crawlDepth
      if (p.inlinks !== null) fact.inlinks = p.inlinks
      if (p.outlinks !== null) fact.outlinks = p.outlinks
      if (p.indexable !== null) fact.indexable = p.indexable
      if (p.statusCode !== null) fact.statusCode = p.statusCode
      // schemaTypes: not a CrawlPage scalar — omitted on live branch
      return fact
    }
  })

  return { source, pages }
}
