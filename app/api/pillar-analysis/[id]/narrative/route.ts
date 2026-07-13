// app/api/pillar-analysis/[id]/narrative/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireHandoffToken } from '@/lib/handoff/route-auth';
import { publishInvalidation } from '@/lib/events/bus';
import { memoTopic } from '@/lib/events/topics';

const REQUIRED_SCOPE = 'narrative-write';
const MAX_NARRATIVE_CHARS = 50_000;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // 1. Parse + validate body shape (do this before auth so a malformed
  //    request gets a specific 400 instead of a generic 401)
  let body: { narrative?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body.narrative !== 'string' || body.narrative.length === 0) {
    return NextResponse.json({ error: 'narrative_required' }, { status: 400 });
  }
  if (body.narrative.length > MAX_NARRATIVE_CHARS) {
    return NextResponse.json({ error: 'narrative_too_long' }, { status: 400 });
  }
  const narrative = body.narrative;

  // 2. Auth
  const auth = await requireHandoffToken(req, 'pat', id, REQUIRED_SCOPE);
  if (!auth.ok) return auth.response;

  // 5. Find analysis
  const pa = await prisma.pillarAnalysis.findUnique({ where: { id } });
  if (!pa) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // 6. Update + respond
  const now = new Date();
  const updated = await prisma.pillarAnalysis.update({
    where: { id },
    data: {
      aiNarrative: narrative,
      narrativeUpdatedAt: now,
    },
  });

  // A5 Task 24: MemoPoller polls by Session.id when present, else falls back
  // to PillarAnalysis.id (analysisId) for live-scan/crawlRun-keyed analyses
  // that have no session — mirror that same fallback here so the topic
  // always matches what MemoPoller subscribed to. Deliberately does NOT
  // also emit pillarAnalysisTopic: PillarAnalysisButtonClient only tracks
  // id/status/error and stops polling once status is complete/error, and a
  // narrative write always happens after the analysis is already complete —
  // that subscriber has nothing to react to here. Emitted AFTER the awaited
  // update resolves (a resolved update() always succeeded — P2025 on a
  // missing row throws first, never reaching here).
  publishInvalidation(memoTopic(updated.sessionId ?? id));

  return NextResponse.json({
    ok: true,
    updatedAt: (updated.narrativeUpdatedAt ?? now).toISOString(),
  });
}
