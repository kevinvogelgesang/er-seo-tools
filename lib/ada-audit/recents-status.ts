import { prisma } from '@/lib/db'
import { BROKEN_LINK_VERIFY_JOB_TYPE } from '@/lib/jobs/handlers/broken-link-verify'
import { SEO_PHASE_ENQUEUE_GRACE_MS } from './seo-phase'
import { TRANSIENT_SITE_STATUSES, seoSiteHref } from './recents-query'
import type { RecentStatusItem, RecentStatusRef } from './recents-status-shared'

// C17 compact live-status lookup for the unified recents table. Deliberately
// cheap: id-batched selects, CrawlRun.score only (NEVER a legacy blob parse —
// the settle-triggered full refetch owns score fallbacks), one optional job
// query. sf-upload rows are never in-flight and are rejected at parse time.
const transientSite = (s: string) => (TRANSIENT_SITE_STATUSES as readonly string[]).includes(s)

export async function fetchRecentsStatus(refs: RecentStatusRef[]): Promise<RecentStatusItem[]> {
  const pageIds = refs.filter((r) => r.type === 'page').map((r) => r.id)
  const siteIds = refs.filter((r) => r.type === 'site-ada' || r.type === 'site-seo').map((r) => r.id)

  const [pages, sites] = await Promise.all([
    pageIds.length
      ? prisma.adaAudit.findMany({
          where: { id: { in: pageIds }, siteAuditId: null },
          select: {
            id: true, status: true, progress: true, progressMessage: true,
            startedAt: true, completedAt: true,
            crawlRun: { select: { score: true } },
          },
        })
      : Promise.resolve([]),
    siteIds.length
      ? prisma.siteAudit.findMany({
          where: { id: { in: siteIds } },
          select: {
            id: true, seoOnly: true, status: true,
            pagesComplete: true, pagesError: true, pagesTotal: true,
            startedAt: true, completedAt: true,
            crawlRuns: { select: { id: true, score: true, tool: true } },
          },
        })
      : Promise.resolve([]),
  ])

  // seoOnly complete-without-run rows: live while the verify job runs, or (no
  // job yet) within the enqueue grace window (plan Codex fix #1).
  const now = Date.now()
  const withinGrace = (completedAt: Date | null) =>
    completedAt != null && now - completedAt.getTime() < SEO_PHASE_ENQUEUE_GRACE_MS
  const seoPending = sites.filter(
    (s) => s.seoOnly && s.status === 'complete' && !s.crawlRuns.some((r) => r.tool === 'seo-parser'),
  )
  const verifyJobs = seoPending.length
    ? await prisma.job.findMany({
        where: {
          type: BROKEN_LINK_VERIFY_JOB_TYPE,
          groupKey: { in: seoPending.map((s) => `site-audit:${s.id}`) },
          status: { in: ['queued', 'running'] },
        },
        select: { groupKey: true, progress: true, progressMessage: true },
      })
    : []
  const aliveVerify = new Map(verifyJobs.map((j) => [j.groupKey, j]))

  const items: RecentStatusItem[] = []
  for (const p of pages) {
    items.push({
      type: 'page', id: p.id, status: p.status,
      score: p.crawlRun?.score ?? null, href: `/ada-audit/${p.id}`,
      startedAt: p.startedAt?.toISOString() ?? null,
      completedAt: p.completedAt?.toISOString() ?? null,
      inFlight: p.status === 'pending' || p.status === 'running',
      pagesDone: null, pagesTotal: null,
      progressPct: p.progress ?? null,
      phaseLabel: p.progressMessage ?? null,
    })
  }
  for (const s of sites) {
    const pagesDone = s.pagesTotal > 0 ? s.pagesComplete + s.pagesError : null
    const pagesTotal = s.pagesTotal > 0 ? s.pagesTotal : null
    if (s.seoOnly) {
      const run = s.crawlRuns.find((r) => r.tool === 'seo-parser')
      const job = aliveVerify.get(`site-audit:${s.id}`)
      const verifying = s.status === 'complete' && !run && (job != null || withinGrace(s.completedAt))
      items.push({
        type: 'site-seo', id: s.id, status: s.status,
        score: run?.score ?? null, href: seoSiteHref(s.id, s.status, run?.id),
        startedAt: s.startedAt?.toISOString() ?? null,
        completedAt: s.completedAt?.toISOString() ?? null,
        inFlight: transientSite(s.status) || verifying,
        pagesDone: transientSite(s.status) ? pagesDone : null,
        pagesTotal: transientSite(s.status) ? pagesTotal : null,
        progressPct: verifying ? job?.progress ?? null : null,
        phaseLabel: verifying ? job?.progressMessage ?? 'Verifying links…' : null,
      })
    } else {
      const run = s.crawlRuns.find((r) => r.tool === 'ada-audit')
      items.push({
        type: 'site-ada', id: s.id, status: s.status,
        score: run?.score ?? null, href: `/ada-audit/site/${s.id}`,
        startedAt: s.startedAt?.toISOString() ?? null,
        completedAt: s.completedAt?.toISOString() ?? null,
        inFlight: transientSite(s.status),
        pagesDone: transientSite(s.status) ? pagesDone : null,
        pagesTotal: transientSite(s.status) ? pagesTotal : null,
        progressPct: null, phaseLabel: null,
      })
    }
  }
  return items
}
