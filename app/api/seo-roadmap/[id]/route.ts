import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifySeoRoadmapToken, SeoRoadmapTokenError } from '@/lib/seo-roadmap-token';
import { buildTechnicalAuditExport } from '@/lib/parsers/claude-export-builder';
import type { AggregatedResult } from '@/lib/types';

function tokenErrorCode(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('expired')) return 'token_expired';
  if (m.includes('does not match')) return 'token_wrong_roadmap_id';
  if (m.includes('signature')) return 'token_invalid_signature';
  return 'token_invalid';
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const authHeader = req.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: 'auth_missing' }, { status: 401 });
  const match = authHeader.match(/^Bearer\s+(srt_\S+)$/);
  if (!match) return NextResponse.json({ error: 'auth_malformed' }, { status: 401 });

  let payload;
  try {
    payload = await verifySeoRoadmapToken(match[1], id);
  } catch (err) {
    if (err instanceof SeoRoadmapTokenError) return NextResponse.json({ error: tokenErrorCode(err.message) }, { status: 401 });
    return NextResponse.json({ error: 'token_service_unavailable' }, { status: 500 });
  }
  const scopes = Array.isArray(payload.scope) ? (payload.scope as string[]) : [];
  if (!scopes.includes('read')) return NextResponse.json({ error: 'token_missing_scope' }, { status: 401 });

  const roadmap = await prisma.seoRoadmap.findUnique({ where: { id }, include: { session: { include: { client: true, crawlRun: { select: { archivePrunedAt: true } } } } } });
  if (!roadmap) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!roadmap.session.result) {
    // C5: retention-pruned blob → explicit archived refusal (degraded data would mislead the memo)
    const code = roadmap.session.crawlRun?.archivePrunedAt ? 'session_archived' : 'session_result_missing';
    return NextResponse.json({ error: code }, { status: 409 });
  }

  let result: AggregatedResult;
  try {
    result = JSON.parse(roadmap.session.result) as AggregatedResult;
  } catch {
    return NextResponse.json({ error: 'session_result_invalid' }, { status: 500 });
  }

  const client = roadmap.session.client;

  return NextResponse.json({
    id: roadmap.id,
    sessionId: roadmap.sessionId,
    siteName: roadmap.session.siteName,
    status: roadmap.status,
    audit: buildTechnicalAuditExport(result),
    teamwork: {
      tasklistId: client?.teamworkTasklistId ?? null,
      parentTaskName: 'Audit Optimizations',
      taskType: 'subtask',
      rules: { matchParentAssignee: true, addTimeEstimates: false, usePriorityFlags: false },
    },
  });
}
