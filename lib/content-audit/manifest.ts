// Server loaders for the cat_ export. The indexable ∧ ¬loginLike filter matches
// the live-scan builder's aggregation set. Read-time expiry: retainUntil null or
// <= now => text unavailable, independent of the sweep cadence.
import { prisma } from '@/lib/db'
import { normalizeFindingUrl } from '@/lib/findings/normalize-url'

export interface ContentAuditEligiblePage { url: string; title: string | null; wordCount: number | null; contentAvailable: boolean }
export interface ContentAuditManifest {
  client: { id: number; name: string } | null
  domain: string | null
  completedAt: Date | null
  textAvailable: boolean
  retainUntil: Date | null
  pages: ContentAuditEligiblePage[]
}

const isIndexable = (r: { statusCode: number | null; isHtml: boolean; robotsNoindex: boolean; xRobotsNoindex: boolean; loginLike: boolean }) =>
  r.statusCode != null && r.statusCode >= 200 && r.statusCode < 300 &&
  r.isHtml && !r.robotsNoindex && !r.xRobotsNoindex && !r.loginLike

export async function loadContentAuditManifest(siteAuditId: string, now: Date): Promise<ContentAuditManifest | null> {
  const audit = await prisma.siteAudit.findUnique({
    where: { id: siteAuditId },
    select: { domain: true, completedAt: true, contentAuditRetainUntil: true, client: { select: { id: true, name: true } } },
  })
  if (!audit) return null
  const windowOpen = audit.contentAuditRetainUntil != null && audit.contentAuditRetainUntil.getTime() > now.getTime()
  const rows = await prisma.harvestedPageSeo.findMany({
    where: { siteAuditId },
    select: { url: true, title: true, wordCount: true, contentText: true, statusCode: true, isHtml: true, robotsNoindex: true, xRobotsNoindex: true, loginLike: true },
    orderBy: { url: 'asc' },
  })
  const pages = rows.filter(isIndexable).map((r) => ({
    url: r.url, title: r.title, wordCount: r.wordCount,
    contentAvailable: windowOpen && r.contentText != null,
  }))
  return {
    client: audit.client, domain: audit.domain, completedAt: audit.completedAt,
    retainUntil: audit.contentAuditRetainUntil,
    textAvailable: windowOpen && pages.some((p) => p.contentAvailable),
    pages,
  }
}

export async function contentAuditEligibleUrls(siteAuditId: string): Promise<Set<string>> {
  const rows = await prisma.harvestedPageSeo.findMany({
    where: { siteAuditId },
    select: { url: true, statusCode: true, isHtml: true, robotsNoindex: true, xRobotsNoindex: true, loginLike: true },
  })
  return new Set(rows.filter(isIndexable).map((r) => normalizeFindingUrl(r.url)))
}

export async function loadContentAuditPageText(
  siteAuditId: string, url: string, now: Date,
): Promise<{ url: string; contentText: string; contentTruncated: boolean } | { status: 404 | 410 }> {
  const audit = await prisma.siteAudit.findUnique({ where: { id: siteAuditId }, select: { contentAuditRetainUntil: true } })
  if (!audit) return { status: 404 }
  const norm = normalizeFindingUrl(url)
  const rows = await prisma.harvestedPageSeo.findMany({
    where: { siteAuditId },
    select: { url: true, contentText: true, contentTruncated: true, statusCode: true, isHtml: true, robotsNoindex: true, xRobotsNoindex: true, loginLike: true },
  })
  const row = rows.filter(isIndexable).find((r) => normalizeFindingUrl(r.url) === norm)
  if (!row) return { status: 404 }
  const windowOpen = audit.contentAuditRetainUntil != null && audit.contentAuditRetainUntil.getTime() > now.getTime()
  if (!windowOpen || row.contentText == null) return { status: 410 }
  return { url: row.url, contentText: row.contentText, contentTruncated: row.contentTruncated }
}
