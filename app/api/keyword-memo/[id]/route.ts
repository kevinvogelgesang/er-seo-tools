import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireHandoffToken } from '@/lib/handoff/route-auth';
import { buildKeywordResearchExport } from '@/lib/parsers/keyword-research-export';
import type { AggregatedResult } from '@/lib/types';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const auth = await requireHandoffToken(req, 'krt', id, 'read');
  if (!auth.ok) return auth.response;

  const row = await prisma.keywordResearchSession.findUnique({ where: { id }, include: { session: { include: { crawlRun: { select: { archivePrunedAt: true } } } } } });
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!row.session.result) {
    // C5: keyword signals are blob-only — archived sessions refuse explicitly
    const code = row.session.crawlRun?.archivePrunedAt ? 'session_archived' : 'session_result_missing';
    return NextResponse.json({ error: code }, { status: 409 });
  }

  let result: AggregatedResult;
  try {
    result = JSON.parse(row.session.result) as AggregatedResult;
  } catch {
    return NextResponse.json({ error: 'session_result_invalid' }, { status: 500 });
  }

  return NextResponse.json({
    id: row.id,
    sessionId: row.sessionId,
    technicalSessionId: row.technicalSessionId,
    siteName: row.session.siteName,
    status: row.status,
    keyword: buildKeywordResearchExport(result),
  });
}
