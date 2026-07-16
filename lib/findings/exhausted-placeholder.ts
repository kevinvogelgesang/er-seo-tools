// lib/findings/exhausted-placeholder.ts
//
// Codex #1/#2 (verifier memory/loop fix spec §3): the durable terminality
// marker for an exhausted broken-link verifier. A minimal CrawlRun with the
// distinct 'live-scan-placeholder' source breaks recoverBrokenLinkVerifies'
// predicate (which only requires tool:'seo-parser') so a repeatedly-dying
// verifier can never re-enqueue, while staying invisible to canonical
// selection (source !== 'live-scan', seoIntent false) and honest on read
// surfaces (consumers check the source and render "SEO analysis unavailable").
// Direct create, NOT writeFindingsRun — its delete-and-recreate would clobber
// a real run racing in; the @@unique([siteAuditId, tool]) P2002 is the fence.
// NEVER throws (called from onExhausted and the recovery sweep).
import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'

export const LIVE_SCAN_PLACEHOLDER_SOURCE = 'live-scan-placeholder'

/** Codex plan-fix #3: the ONE placeholder predicate. Every read surface uses
 * this — never an inline source comparison. */
export function isPlaceholderRun(run: { source: string }): boolean {
  return run.source === LIVE_SCAN_PLACEHOLDER_SOURCE
}

export type PlaceholderOutcome = 'created' | 'exists' | 'skipped' | 'failed'

export async function ensureExhaustedPlaceholder(siteAuditId: string): Promise<PlaceholderOutcome> {
  try {
    const site = await prisma.siteAudit.findUnique({
      where: { id: siteAuditId },
      select: { id: true, domain: true, clientId: true },
    })
    if (!site) return 'skipped' // deleted audit — nothing to mark terminal
    const now = new Date()
    await prisma.crawlRun.create({ data: {
      tool: 'seo-parser', source: LIVE_SCAN_PLACEHOLDER_SOURCE, status: 'partial',
      siteAuditId: site.id, domain: site.domain, clientId: site.clientId,
      seoIntent: false, pagesTotal: 0, startedAt: now, completedAt: now,
    } })
    console.warn(`[broken-link-verify] wrote exhausted placeholder run for ${siteAuditId}`)
    return 'created'
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return 'exists'
    console.error('[broken-link-verify] placeholder write failed for', siteAuditId, err)
    return 'failed'
  }
}
