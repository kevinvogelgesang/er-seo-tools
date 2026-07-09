import { prisma } from '@/lib/db'
import { computeScore, computeScoreFromCounts } from '@/lib/ada-audit/scoring'
import type { AxeViolation } from '@/lib/ada-audit/types'

// C16 unified recents: five sources under ONE stable total order
// (createdAt DESC, type ASC, id ASC):
//   - standalone AdaAudits            → 'page'
//   - Sessions (workflow 'technical') → 'sf-upload'
//   - SiteAudits seoOnly=false        → 'site-ada'
//   - SiteAudits seoOnly=true         → 'site-seo'
//   - orphaned live-scan CrawlRuns    → 'site-seo' (parent pruned by
//     scheduled retention — parse-history parity)
// The four RecentType literals sort lexicographically
// ('page' < 'sf-upload' < 'site-ada' < 'site-seo') — the cursor predicates
// below depend on that, so new types must keep the comparator and
// cursorWhere() in sync.
export type RecentType = 'page' | 'sf-upload' | 'site-ada' | 'site-seo'
const RECENT_TYPES: readonly RecentType[] = ['page', 'sf-upload', 'site-ada', 'site-seo']

export interface RecentItem {
  type: RecentType
  id: string
  createdAt: string
  label: string
  href: string
  status: string
  score: number | null
  startedAt: string | null
  completedAt: string | null
  clientName: string | null
  requestedBy: string | null
  deletable: boolean
}

export interface RecentsCursor { createdAt: number; type: RecentType; id: string }

// ids are cuid/uuid — '~' can never appear in them.
export function encodeRecentsCursor(c: RecentsCursor): string {
  return `${c.createdAt}~${c.type}~${c.id}`
}

// Max valid Date epoch-ms magnitude (ECMA-262). A public query param must
// never produce an Invalid Date that reaches Prisma.
const MAX_DATE_MS = 8_640_000_000_000_000

export function decodeRecentsCursor(raw: string | null): RecentsCursor | null {
  if (!raw) return null
  const parts = raw.split('~')
  if (parts.length !== 3 || !parts[2]) return null
  const createdAt = Number(parts[0])
  if (!Number.isSafeInteger(createdAt) || Math.abs(createdAt) > MAX_DATE_MS) return null
  if (!RECENT_TYPES.includes(parts[1] as RecentType)) return null
  return { createdAt, type: parts[1] as RecentType, id: parts[2] }
}

export interface RecentsQueryOptions {
  limit?: number
  operator?: string
  cursor?: RecentsCursor | null
  q?: string
  clientId?: number | 'unassigned' | null
}

export interface RecentsPage { items: RecentItem[]; nextCursor: string | null }

function pageScore(status: string, result: string | null, wcagLevel: string): number | null {
  if (status !== 'complete' || !result) return null
  try {
    const parsed = JSON.parse(result) as { violations?: AxeViolation[] }
    const { score } = computeScore(parsed.violations ?? [], wcagLevel)
    return Number.isFinite(score) ? score : null
  } catch { return null }
}

function siteScore(status: string, summary: string | null, wcagLevel: string): number | null {
  if (status !== 'complete' || !summary) return null
  try {
    const parsed = JSON.parse(summary) as { aggregate?: unknown } | null
    if (!parsed?.aggregate) return null
    const { score } = computeScoreFromCounts(parsed.aggregate as never, wcagLevel)
    return Number.isFinite(score) ? score : null
  } catch { return null }
}

// NO Session.result blob read here: the recents list must not become a new
// hot-path blob reader. Session score = CrawlRun.score only; pre-A2 sessions
// (no CrawlRun) render "—", same as pruned rows.

function firstFile(files: string): string {
  try {
    const arr = JSON.parse(files) as string[]
    return arr[0] ?? 'SF upload'
  } catch { return 'SF upload' }
}

// Position-after-cursor predicate for a source that emits rows of `type`.
// Total order: createdAt DESC, type ASC, id ASC. At the cursor timestamp,
// a source of an EARLIER type is exhausted; the SAME type resumes after the
// cursor id; a LATER type includes the whole timestamp. TWO sources emit
// 'site-seo' (seoOnly SiteAudits + orphaned live-scan CrawlRuns) — that stays
// correct because each query applies the same-type predicate to its OWN ids,
// and cuids are unique across both tables.
function cursorWhere(cursor: RecentsCursor | null, type: RecentType): Record<string, unknown> {
  if (!cursor) return {}
  const cd = new Date(cursor.createdAt)
  if (type < cursor.type) return { createdAt: { lt: cd } }
  if (type === cursor.type) {
    return { OR: [{ createdAt: { lt: cd } }, { AND: [{ createdAt: cd }, { id: { gt: cursor.id } }] }] }
  }
  return { createdAt: { lte: cd } }
}

function compareItems(a: RecentItem, b: RecentItem): number {
  const t = b.createdAt.localeCompare(a.createdAt)
  if (t !== 0) return t
  if (a.type !== b.type) return a.type < b.type ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export async function fetchAllRecents(opts: RecentsQueryOptions = {}): Promise<RecentsPage> {
  const limit = opts.limit ?? 100
  const take = limit + 1
  const cursor = opts.cursor ?? null
  const q = opts.q?.trim() || null
  const mine = opts.operator ? { requestedBy: opts.operator } : {}
  const clientWhere =
    opts.clientId === 'unassigned' ? { clientId: null }
    : typeof opts.clientId === 'number' ? { clientId: opts.clientId }
    : {}
  const order = [{ createdAt: 'desc' as const }, { id: 'asc' as const }]

  // Orphaned live-scan runs (parent SiteAudit pruned → SetNull). CrawlRun has
  // no requestedBy — a Mine scope excludes this source entirely, matching
  // "legacy rows never match Mine".
  const orphanRunsPromise = opts.operator
    ? Promise.resolve([] as { id: string; createdAt: Date; status: string; domain: string | null; score: number | null; client: { name: string } | null }[])
    : prisma.crawlRun.findMany({
        where: { AND: [{ tool: 'seo-parser', source: 'live-scan', seoIntent: true, siteAuditId: null, ...clientWhere }, ...(q ? [{ domain: { contains: q } }] : []), cursorWhere(cursor, 'site-seo')] },
        orderBy: order, take,
        select: {
          id: true, createdAt: true, status: true, domain: true, score: true,
          client: { select: { name: true } },
        },
      })

  const [pages, sessions, adaSites, seoSites, orphans] = await Promise.all([
    prisma.adaAudit.findMany({
      where: { AND: [{ siteAuditId: null, ...mine, ...clientWhere }, ...(q ? [{ url: { contains: q } }] : []), cursorWhere(cursor, 'page')] },
      orderBy: order, take,
      select: {
        id: true, createdAt: true, url: true, status: true, wcagLevel: true,
        result: true, startedAt: true, completedAt: true, requestedBy: true,
        client: { select: { name: true } },
        crawlRun: { select: { score: true } },
      },
    }),
    prisma.session.findMany({
      where: { AND: [{ workflow: 'technical', ...mine, ...clientWhere }, ...(q ? [{ OR: [{ siteName: { contains: q } }, { files: { contains: q } }] }] : []), cursorWhere(cursor, 'sf-upload')] },
      orderBy: order, take,
      select: {
        id: true, createdAt: true, status: true, siteName: true, files: true,
        requestedBy: true,
        client: { select: { name: true } },
        crawlRun: { select: { score: true } },
      },
    }),
    prisma.siteAudit.findMany({
      where: { AND: [{ seoOnly: false, ...mine, ...clientWhere }, ...(q ? [{ domain: { contains: q } }] : []), cursorWhere(cursor, 'site-ada')] },
      orderBy: order, take,
      select: {
        id: true, createdAt: true, domain: true, status: true, wcagLevel: true,
        summary: true, startedAt: true, completedAt: true, requestedBy: true,
        client: { select: { name: true } },
        crawlRuns: { where: { tool: 'ada-audit' }, select: { score: true } },
      },
    }),
    prisma.siteAudit.findMany({
      where: { AND: [{ seoOnly: true, ...mine, ...clientWhere }, ...(q ? [{ domain: { contains: q } }] : []), cursorWhere(cursor, 'site-seo')] },
      orderBy: order, take,
      select: {
        id: true, createdAt: true, domain: true, status: true,
        startedAt: true, completedAt: true, requestedBy: true,
        client: { select: { name: true } },
        crawlRuns: { where: { tool: 'seo-parser' }, select: { id: true, score: true } },
      },
    }),
    orphanRunsPromise,
  ])

  const merged: RecentItem[] = [
    ...pages.map((p): RecentItem => ({
      type: 'page', id: p.id, createdAt: p.createdAt.toISOString(),
      label: p.url, href: `/ada-audit/${p.id}`,
      status: p.status, score: p.crawlRun?.score ?? pageScore(p.status, p.result, p.wcagLevel),
      startedAt: p.startedAt?.toISOString() ?? null,
      completedAt: p.completedAt?.toISOString() ?? null,
      clientName: p.client?.name ?? null, requestedBy: p.requestedBy, deletable: false,
    })),
    ...sessions.map((s): RecentItem => ({
      type: 'sf-upload', id: s.id, createdAt: s.createdAt.toISOString(),
      label: s.siteName ?? firstFile(s.files), href: `/seo-audits/results/${s.id}`,
      status: s.status,
      score: s.crawlRun?.score ?? null,
      startedAt: null, completedAt: null,
      clientName: s.client?.name ?? null, requestedBy: s.requestedBy, deletable: true,
    })),
    ...adaSites.map((s): RecentItem => ({
      type: 'site-ada', id: s.id, createdAt: s.createdAt.toISOString(),
      label: s.domain, href: `/ada-audit/site/${s.id}`,
      status: s.status, score: s.crawlRuns[0]?.score ?? siteScore(s.status, s.summary, s.wcagLevel),
      startedAt: s.startedAt?.toISOString() ?? null,
      completedAt: s.completedAt?.toISOString() ?? null,
      clientName: s.client?.name ?? null, requestedBy: s.requestedBy, deletable: false,
    })),
    ...seoSites.map((s): RecentItem => ({
      type: 'site-seo', id: s.id, createdAt: s.createdAt.toISOString(),
      label: s.domain,
      // Complete + run-ready → straight to SEO results (the spec's rule:
      // completed rows with a live-scan run link to the run page); otherwise
      // the site page hosts the poller/banner (C16 seoOnly behavior).
      href: s.status === 'complete' && s.crawlRuns[0]?.id
        ? `/seo-audits/results/run/${s.crawlRuns[0].id}`
        : `/ada-audit/site/${s.id}`,
      status: s.status, score: s.crawlRuns[0]?.score ?? null,
      startedAt: s.startedAt?.toISOString() ?? null,
      completedAt: s.completedAt?.toISOString() ?? null,
      clientName: s.client?.name ?? null, requestedBy: s.requestedBy, deletable: false,
    })),
    ...orphans.map((r): RecentItem => ({
      type: 'site-seo', id: r.id, createdAt: r.createdAt.toISOString(),
      label: r.domain ?? 'SEO scan', href: `/seo-audits/results/run/${r.id}`,
      status: r.status, score: r.score,
      startedAt: null, completedAt: null,
      clientName: r.client?.name ?? null, requestedBy: null, deletable: false,
    })),
  ].sort(compareItems)

  const items = merged.slice(0, limit)
  const last = items[items.length - 1]
  const nextCursor = merged.length > limit && last
    ? encodeRecentsCursor({ createdAt: Date.parse(last.createdAt), type: last.type, id: last.id })
    : null
  return { items, nextCursor }
}
