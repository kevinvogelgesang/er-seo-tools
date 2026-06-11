import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

// Reader flip (A2 Phase 3): CrawlRun-backed sessions read CrawlPage + page-level
// Finding rows; sessions without a CrawlRun (pre-A2) fall back to SessionPage.
// Response shape is identical in both paths.

interface Query {
  limit: number;
  offset: number;
  issueType?: string;
  sort: string;
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, notice: 2 };

export async function GET(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const sp = req.nextUrl.searchParams;
  const q: Query = {
    limit: Math.min(Math.max(parseInt(sp.get('limit') ?? '50', 10) || 50, 1), 200),
    offset: Math.max(parseInt(sp.get('offset') ?? '0', 10) || 0, 0),
    issueType: sp.get('issueType') ?? undefined,
    sort: sp.get('sort') ?? 'issues',
  };

  const run = await prisma.crawlRun.findUnique({ where: { sessionId }, select: { id: true } });
  if (!run) return legacySessionPages(sessionId, q);

  const where = {
    runId: run.id,
    ...(q.issueType ? { findings: { some: { type: q.issueType } } } : {}),
  };
  const orderBy =
    q.sort === 'wordCount' ? [{ wordCount: 'asc' as const }, { url: 'asc' as const }]
    : q.sort === 'crawlDepth' ? [{ crawlDepth: 'desc' as const }, { url: 'asc' as const }]
    : [{ findings: { _count: 'desc' as const } }, { url: 'asc' as const }];

  const [rows, total] = await Promise.all([
    prisma.crawlPage.findMany({
      where,
      orderBy,
      take: q.limit,
      skip: q.offset,
      // Findings are NOT narrowed by the filter: issueTypes/issueCount always
      // describe the whole page, matching the old denormalized columns.
      include: { findings: { select: { type: true, severity: true } } },
    }),
    prisma.crawlPage.count({ where }),
  ]);

  return NextResponse.json({
    pages: rows.map((r) => ({
      id: r.id,
      sessionId,
      url: r.url,
      title: r.title,
      h1: r.h1,
      metaDescription: r.metaDescription,
      wordCount: r.wordCount,
      crawlDepth: r.crawlDepth,
      indexable: r.indexable ?? true,
      issueTypes: orderedIssueTypes(r.findings),
      issueCount: r.findings.length,
    })),
    total,
  });
}

/** Page findings are unique per type (dedupKey is scope+type+url), so the
 *  types list needs no dedupe — just a stable, severity-first presentation
 *  order for the UI chips. */
function orderedIssueTypes(findings: { type: string; severity: string }[]): string[] {
  return [...findings]
    .sort(
      (a, b) =>
        (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) ||
        a.type.localeCompare(b.type),
    )
    .map((f) => f.type);
}

async function legacySessionPages(sessionId: string, q: Query) {
  const where = {
    sessionId,
    // Match the QUOTED JSON token so 'missing_title' matches the array element
    // "missing_title" and NOT a substring like "missing_title_something".
    ...(q.issueType ? { issueTypes: { contains: JSON.stringify(q.issueType) } } : {}),
  };
  // Secondary `url` sort is a deterministic tiebreaker: ordering by a single
  // non-unique column lets offset pagination duplicate/skip rows across pages
  // when many rows tie. `url` is unique per session, so it fully orders the set.
  const orderBy =
    q.sort === 'wordCount' ? [{ wordCount: 'asc' as const }, { url: 'asc' as const }]
    : q.sort === 'crawlDepth' ? [{ crawlDepth: 'desc' as const }, { url: 'asc' as const }]
    : [{ issueCount: 'desc' as const }, { url: 'asc' as const }];

  const [rows, total] = await Promise.all([
    prisma.sessionPage.findMany({ where, orderBy, take: q.limit, skip: q.offset }),
    prisma.sessionPage.count({ where }),
  ]);

  return NextResponse.json({
    pages: rows.map((r) => ({ ...r, issueTypes: safeParse(r.issueTypes) })),
    total,
  });
}

function safeParse(s: string): string[] {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}
