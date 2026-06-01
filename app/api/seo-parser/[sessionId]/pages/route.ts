import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(parseInt(sp.get('limit') ?? '50', 10) || 50, 1), 200);
  const offset = Math.max(parseInt(sp.get('offset') ?? '0', 10) || 0, 0);
  const issueType = sp.get('issueType') ?? undefined;
  const sort = sp.get('sort') ?? 'issues';

  const where = {
    sessionId,
    // Match the QUOTED JSON token so 'missing_title' matches the array element
    // "missing_title" and NOT a substring like "missing_title_something".
    ...(issueType ? { issueTypes: { contains: JSON.stringify(issueType) } } : {}),
  };
  const orderBy =
    sort === 'wordCount' ? { wordCount: 'asc' as const }
    : sort === 'crawlDepth' ? { crawlDepth: 'desc' as const }
    : { issueCount: 'desc' as const };

  const [rows, total] = await Promise.all([
    prisma.sessionPage.findMany({ where, orderBy, take: limit, skip: offset }),
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
