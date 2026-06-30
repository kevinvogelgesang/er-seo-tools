// lib/services/seo-canonical.ts
//
// Domain-scoped canonical SEO-run selector.
// Decides SF-upload vs native live-scan under a 30-day SF freshness window.
// Rule (spec §4.3):
//   - Candidates: source==='sf-upload' OR (source==='live-scan' AND seoIntent===true)
//   - sf = newest sf-upload candidate; live = newest qualifying live candidate
//   - Fresh SF (ageDays(sf) ≤ window) wins unconditionally
//   - Else newer live supersedes stale/absent SF
//   - Else fall back to SF (stale but present)
//   - Else fall back to live (if SF absent)
//   - Else null

import { normaliseSiteAuditDomain } from '@/lib/ada-audit/site-audit-helpers'
import { prisma } from '@/lib/db'

export const SEO_SF_CANONICAL_WINDOW_DAYS = Number(
  process.env.SEO_SF_CANONICAL_WINDOW_DAYS ?? 30,
)

export interface SeoRunRef {
  id: string
  source: string
  seoIntent: boolean
  domain: string | null
  completedAt: Date | null
  createdAt: Date
  sessionId: string | null
  siteAuditId: string | null
}

export type CanonicalSeo = { run: SeoRunRef; source: 'sf-upload' | 'live-scan' } | null

const ageDays = (r: SeoRunRef, nowMs: number): number =>
  r.completedAt ? (nowMs - r.completedAt.getTime()) / 86_400_000 : Infinity

const newest = (rs: SeoRunRef[], pred: (r: SeoRunRef) => boolean): SeoRunRef | null =>
  rs
    .filter(pred)
    .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))[0] ?? null

/**
 * PURE — operate over already-loaded runs (no DB hit). Safe to use in fleet /
 * dashboard loops without per-row DB queries.
 */
export function pickCanonicalSeo(
  runs: SeoRunRef[],
  nowMs: number,
  windowDays: number = SEO_SF_CANONICAL_WINDOW_DAYS,
): CanonicalSeo {
  const sf = newest(runs, (r) => r.source === 'sf-upload')
  const live = newest(runs, (r) => r.source === 'live-scan' && r.seoIntent)

  // Fresh SF wins unconditionally
  if (sf && ageDays(sf, nowMs) <= windowDays) return { run: sf, source: 'sf-upload' }

  // Stale/absent SF: live supersedes if it is newer
  if (live && (!sf || (live.completedAt?.getTime() ?? 0) > (sf.completedAt?.getTime() ?? 0)))
    return { run: live, source: 'live-scan' }

  // Fall back to stale SF
  if (sf) return { run: sf, source: 'sf-upload' }

  // Last resort: live (even if older than stale SF — already excluded above)
  if (live) return { run: live, source: 'live-scan' }

  return null
}

/**
 * Convenience DB wrapper for single-context callers ONLY (not loops).
 * Queries the DB for seo-parser CrawlRun candidates scoped to the given
 * clientId + normalised domain, then delegates to pickCanonicalSeo.
 */
export async function selectCanonicalSeoRun(args: {
  clientId: number
  domain: string
}): Promise<CanonicalSeo> {
  const normDomain = normaliseSiteAuditDomain(args.domain)

  const rows = await prisma.crawlRun.findMany({
    where: {
      clientId: args.clientId,
      tool: 'seo-parser',
      domain: normDomain,
      OR: [{ source: 'sf-upload' }, { source: 'live-scan', seoIntent: true }],
    },
    select: {
      id: true,
      source: true,
      seoIntent: true,
      domain: true,
      completedAt: true,
      createdAt: true,
      sessionId: true,
      siteAuditId: true,
    },
  })

  return pickCanonicalSeo(rows, Date.now())
}
