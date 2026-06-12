import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyKeywordMemoToken, KeywordMemoTokenError } from '@/lib/keyword-memo-token';
import { buildKeywordResearchExport } from '@/lib/parsers/keyword-research-export';
import type { AggregatedResult } from '@/lib/types';

function tokenErrorCode(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('expired')) return 'token_expired';
  if (m.includes('does not match')) return 'token_wrong_memo_id';
  if (m.includes('signature')) return 'token_invalid_signature';
  return 'token_invalid';
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const authHeader = req.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: 'auth_missing' }, { status: 401 });
  const match = authHeader.match(/^Bearer\s+(krt_\S+)$/);
  if (!match) return NextResponse.json({ error: 'auth_malformed' }, { status: 401 });

  let payload;
  try {
    payload = await verifyKeywordMemoToken(match[1], id);
  } catch (err) {
    if (err instanceof KeywordMemoTokenError) return NextResponse.json({ error: tokenErrorCode(err.message) }, { status: 401 });
    return NextResponse.json({ error: 'token_service_unavailable' }, { status: 500 });
  }
  const scopes = Array.isArray(payload.scope) ? (payload.scope as string[]) : [];
  if (!scopes.includes('read')) return NextResponse.json({ error: 'token_missing_scope' }, { status: 401 });

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
