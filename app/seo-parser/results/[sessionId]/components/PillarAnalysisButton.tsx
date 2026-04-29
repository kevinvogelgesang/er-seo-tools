import { prisma } from '@/lib/db';
import { PillarAnalysisButtonClient, type ButtonInitialState } from './PillarAnalysisButtonClient';

interface Props {
  sessionId: string;
}

/**
 * Server-component wrapper. Fetches initial pillar analysis state from Prisma
 * (so the first paint isn't a loading flash) and hands off to the client
 * component which polls for updates.
 */
export default async function PillarAnalysisButton({ sessionId }: Props) {
  const pa = await prisma.pillarAnalysis.findFirst({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
  });

  const initial: ButtonInitialState = pa
    ? { id: pa.id, status: pa.status, error: pa.error }
    : null;

  return <PillarAnalysisButtonClient sessionId={sessionId} initial={initial} />;
}
