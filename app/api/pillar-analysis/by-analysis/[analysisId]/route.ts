// app/api/pillar-analysis/by-analysis/[analysisId]/route.ts
//
// Analysis-id keyed poll path for run-keyed (live-scan) pillar analyses.
// Returns the same lightweight snapshot shape as by-session, but finds by
// PillarAnalysis.id instead of sessionId. Used by MemoPoller when sessionId
// is null (no SF Session) so the memo-polling cycle works for live analyses.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ analysisId: string }> },
) {
  const { analysisId } = await params;
  const pa = await prisma.pillarAnalysis.findUnique({
    where: { id: analysisId },
  });

  if (!pa) {
    return NextResponse.json({ pillarAnalysis: null });
  }

  let hubRecommendation: unknown = null;
  try {
    if (pa.hubRecommendation) hubRecommendation = JSON.parse(pa.hubRecommendation);
  } catch { /* ignore */ }

  return NextResponse.json({
    pillarAnalysis: {
      id: pa.id,
      sessionId: pa.sessionId,
      crawlRunId: pa.crawlRunId,
      status: pa.status,
      error: pa.error,
      score: pa.score,
      dataCompleteness: pa.dataCompleteness,
      hubRecommendation,
      createdAt: pa.createdAt,
      updatedAt: pa.updatedAt,
      aiNarrative: pa.aiNarrative,
      narrativeUpdatedAt: pa.narrativeUpdatedAt,
    },
  });
}
