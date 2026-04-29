import { prisma } from '@/lib/db';
import { PillarAnalysisCardClient, type PillarAnalysisCardData } from './PillarAnalysisCardClient';

interface Props {
  sessionId: string;
}

/**
 * Server-component wrapper. Fetches initial pillar analysis state from Prisma
 * (so the first paint isn't a loading flash) and hands off to the client
 * component which polls for updates.
 */
export default async function PillarAnalysisCard({ sessionId }: Props) {
  const pa = await prisma.pillarAnalysis.findFirst({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
  });

  let initialPa: PillarAnalysisCardData | null = null;
  if (pa) {
    let hubRecommendation: unknown = null;
    try {
      if (pa.hubRecommendation) hubRecommendation = JSON.parse(pa.hubRecommendation);
    } catch { /* ignore */ }
    initialPa = {
      id: pa.id,
      status: pa.status,
      error: pa.error,
      score: pa.score,
      dataCompleteness: pa.dataCompleteness,
      hubRecommendation,
    };
  }

  return <PillarAnalysisCardClient sessionId={sessionId} initialPa={initialPa} />;
}
