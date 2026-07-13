import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireHandoffToken } from '@/lib/handoff/route-auth';
import { buildTechnicalAuditExport } from '@/lib/parsers/claude-export-builder';
import type { AggregatedResult } from '@/lib/types';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const auth = await requireHandoffToken(req, 'srt', id, 'read');
  if (!auth.ok) return auth.response;

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
