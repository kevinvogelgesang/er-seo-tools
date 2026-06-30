import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

// Run-keyed pages endpoint for live-scan CrawlRun results (Task 6).
// Mirrors the CrawlRun path in /api/seo-parser/[sessionId]/pages but keyed
// directly by runId — used by the /seo-parser/results/run/[runId] page.

const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, notice: 2 };

export async function GET(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(parseInt(sp.get('limit') ?? '50', 10) || 50, 1), 200);
  const offset = Math.max(parseInt(sp.get('offset') ?? '0', 10) || 0, 0);
  const issueType = sp.get('issueType') ?? undefined;
  const sort = sp.get('sort') ?? 'issues';

  // Only serve seo-parser runs — ada-audit runs have no page-level SEO data.
  const run = await prisma.crawlRun.findUnique({ where: { id: runId }, select: { id: true, tool: true } });
  if (!run || run.tool !== 'seo-parser') {
    return NextResponse.json({ pages: [], total: 0 });
  }

  const where = {
    runId,
    ...(issueType ? { findings: { some: { type: issueType } } } : {}),
  };
  const orderBy =
    sort === 'wordCount' ? [{ wordCount: 'asc' as const }, { url: 'asc' as const }]
    : sort === 'crawlDepth' ? [{ crawlDepth: 'desc' as const }, { url: 'asc' as const }]
    : [{ findings: { _count: 'desc' as const } }, { url: 'asc' as const }];

  const [rows, total] = await Promise.all([
    prisma.crawlPage.findMany({
      where,
      orderBy,
      take: limit,
      skip: offset,
      include: { findings: { select: { type: true, severity: true } } },
    }),
    prisma.crawlPage.count({ where }),
  ]);

  return NextResponse.json({
    pages: rows.map((r) => ({
      id: r.id,
      runId,
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

function orderedIssueTypes(findings: { type: string; severity: string }[]): string[] {
  return [...findings]
    .sort(
      (a, b) =>
        (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) ||
        a.type.localeCompare(b.type),
    )
    .map((f) => f.type);
}
