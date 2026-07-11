// KS-4 pure page-inventory builder — KS-5's assembly seam (no consumer in
// this repo yet; ships dark). Input rows are CrawlPage scalars the caller
// already loads from the newest seoIntent live-scan run. pageType is
// computed at READ time (classifier improvements apply retroactively;
// KS-3 program-suggest precedent) with a durable-programEntities upgrade
// for the schema signal that read-time classification loses.

import { classifyPageType } from '@/lib/services/pillarAnalysis/pageType'
import type { PageType } from '@/lib/services/pillarAnalysis/types'
import { normalizeFindingUrl } from '@/lib/findings/normalize-url'
import { FAQ_SIGNAL_ORDER } from '@/lib/ada-audit/seo/faq-evidence'

export type FaqEvidenceState = 'present' | 'not-detected' | 'unknown'

export interface InventoryPageInput {
  url: string
  title: string | null
  h1: string | null
  wordCount: number | null
  crawlDepth: number | null
  indexable: boolean | null
  faqEvidence: string | null
}

export interface PageInventoryEntry {
  url: string
  title: string | null
  h1: string | null
  pageType: PageType
  pageTypeConfidence: number
  wordCount: number | null
  faqEvidence: FaqEvidenceState
  faqSignals: string[]
}

/**
 * Strict grammar decode (spec §6, Codex #1): only the exact forms parse —
 * 'not-detected', or 'present:' + a non-empty, duplicate-free,
 * canonically-ordered comma list from the fixed vocabulary. Everything else
 * decodes to 'unknown' — a corrupt stored value must never read as a negative.
 */
export function parseFaqEvidence(raw: string | null): { state: FaqEvidenceState; signals: string[] } {
  if (raw === 'not-detected') return { state: 'not-detected', signals: [] }
  if (raw != null && raw.startsWith('present:')) {
    const sigs = raw.slice('present:'.length).split(',')
    let last = -1
    for (const s of sigs) {
      const i = (FAQ_SIGNAL_ORDER as readonly string[]).indexOf(s)
      if (i === -1 || i <= last) return { state: 'unknown', signals: [] }
      last = i
    }
    if (sigs.length > 0 && sigs[0] !== '') return { state: 'present', signals: sigs }
  }
  return { state: 'unknown', signals: [] }
}

export function buildPageInventory(
  pages: InventoryPageInput[],
  opts?: { programEntityUrls?: string[] },
): PageInventoryEntry[] {
  // Normalize the entity set on OUR side (Codex #5): historical/hand-edited
  // programEntitiesJson can differ by fragment/host case; malformed entries
  // are discarded, never thrown on.
  const entityUrls = new Set<string>()
  for (const u of opts?.programEntityUrls ?? []) {
    try { new URL(u) } catch { continue }
    entityUrls.add(normalizeFindingUrl(u))
  }
  return pages
    .filter((p) => p.indexable === true)
    .sort((a, b) => a.url.localeCompare(b.url))
    .map((p) => {
      let { pageType, pageTypeConfidence } = classifyPageType({ url: p.url, schemaTypes: [], crawlDepth: p.crawlDepth })
      // Upgrade mirrors classifyPageType's own tiebreaker semantics (Codex #4):
      // schema fires only when URL rules yielded nothing definite. With
      // schemaTypes: [] the read-time result is <= 0.4 exactly for the
      // unknown (0.2) and crawl-depth nav fallback (0.4) cases; slug/home
      // classifications (>= 0.85) are never overridden.
      if (pageType !== 'program' && pageTypeConfidence <= 0.4 && entityUrls.has(normalizeFindingUrl(p.url))) {
        pageType = 'program'
        pageTypeConfidence = 0.7 // schema-tier confidence
      }
      const faq = parseFaqEvidence(p.faqEvidence)
      return {
        url: p.url, title: p.title, h1: p.h1, pageType, pageTypeConfidence,
        wordCount: p.wordCount, faqEvidence: faq.state, faqSignals: faq.signals,
      }
    })
}
