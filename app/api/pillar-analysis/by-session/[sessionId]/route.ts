// app/api/pillar-analysis/by-session/[sessionId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const pa = await prisma.pillarAnalysis.findFirst({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
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
      status: pa.status,
      error: pa.error,
      score: pa.score,
      dataCompleteness: pa.dataCompleteness,
      hubRecommendation, // parsed
      createdAt: pa.createdAt,
      updatedAt: pa.updatedAt,
      aiNarrative: pa.aiNarrative,
      narrativeUpdatedAt: pa.narrativeUpdatedAt,
    },
  });
}
