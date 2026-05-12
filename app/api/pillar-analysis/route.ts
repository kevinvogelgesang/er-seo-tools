// app/api/pillar-analysis/route.ts
import { NextRequest, NextResponse } from 'next/server';
import {
  PillarAnalysisRunError,
  runPillarAnalysisForSession,
} from '@/lib/services/pillarAnalysis/runFromSession';

export async function POST(req: NextRequest) {
  let body: { sessionId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!body.sessionId) {
    return NextResponse.json({ error: 'sessionId_required' }, { status: 400 });
  }

  try {
    return NextResponse.json(await runPillarAnalysisForSession(body.sessionId));
  } catch (err) {
    if (err instanceof PillarAnalysisRunError) {
      return NextResponse.json(
        { error: err.code, message: err.message, ...err.detail },
        { status: err.status },
      );
    }
    const message = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json({ error: 'analysis_failed', message }, { status: 500 });
  }
}
