// app/api/parse/pillar-analysis-trigger.ts
// Fire-and-forget pillar analysis after a seo-parser session transitions to
// 'complete'. Failures are logged but never thrown.

import { runPillarAnalysisForSession } from '@/lib/services/pillarAnalysis/runFromSession';

export async function triggerPillarAnalysis(sessionId: string): Promise<void> {
  try {
    await runPillarAnalysisForSession(sessionId);
  } catch (err) {
    console.error('[pillar-analysis] trigger error', err);
  }
}
