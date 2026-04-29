// app/api/pillar-analysis/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pa = await prisma.pillarAnalysis.findUnique({ where: { id } });
  if (!pa) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json({
    id: pa.id,
    sessionId: pa.sessionId,
    status: pa.status,
    error: pa.error,
    score: pa.score,
    subscores: pa.subscores ? safeJSON(pa.subscores) : null,
    subscorePresence: pa.subscorePresence ? safeJSON(pa.subscorePresence) : null,
    dataCompleteness: pa.dataCompleteness,
    hubRecommendation: pa.hubRecommendation ? safeJSON(pa.hubRecommendation) : null,
    pillarTopics: pa.pillarTopics ? safeJSON(pa.pillarTopics) : null,
    urlVerdicts: pa.urlVerdicts ? safeJSON(pa.urlVerdicts) : null,
    createdAt: pa.createdAt,
    updatedAt: pa.updatedAt,
  });
}

function safeJSON(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}
