import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isValidSessionId } from '@/lib/upload-helpers';
import { diffCrawls } from '@/lib/services/diff.service';
import { AggregatedResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/diff
 * Body: { sessionAId: string; sessionBId: string }
 * Compares two completed parse sessions and returns a CrawlDiff.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { sessionAId, sessionBId } = body as { sessionAId?: string; sessionBId?: string };

  if (!sessionAId || !isValidSessionId(sessionAId)) {
    return NextResponse.json({ error: 'Invalid sessionAId' }, { status: 400 });
  }
  if (!sessionBId || !isValidSessionId(sessionBId)) {
    return NextResponse.json({ error: 'Invalid sessionBId' }, { status: 400 });
  }

  try {
    const [sessionA, sessionB] = await Promise.all([
      prisma.session.findUnique({ where: { id: sessionAId }, include: { crawlRun: { select: { archivePrunedAt: true } } } }),
      prisma.session.findUnique({ where: { id: sessionBId }, include: { crawlRun: { select: { archivePrunedAt: true } } } }),
    ]);

    if (!sessionA) {
      return NextResponse.json({ error: 'Session A not found' }, { status: 404 });
    }
    if (!sessionB) {
      return NextResponse.json({ error: 'Session B not found' }, { status: 404 });
    }
    if (sessionA.status !== 'complete') {
      return NextResponse.json(
        { error: `Session A is not complete (status: ${sessionA.status})` },
        { status: 400 }
      );
    }
    if (sessionB.status !== 'complete') {
      return NextResponse.json(
        { error: `Session B is not complete (status: ${sessionB.status})` },
        { status: 400 }
      );
    }

    // C5: degraded diffs are refused — diffCrawls coalesces missing numerics
    // with ?? 0, so a full-vs-degraded diff would fabricate false deltas.
    const aPruned = !sessionA.result && !!sessionA.crawlRun?.archivePrunedAt;
    const bPruned = !sessionB.result && !!sessionB.crawlRun?.archivePrunedAt;
    if (aPruned || bPruned) {
      return NextResponse.json({ error: 'session_archived' }, { status: 409 });
    }

    let resultA: AggregatedResult;
    let resultB: AggregatedResult;

    try {
      resultA = JSON.parse(sessionA.result ?? '') as AggregatedResult;
    } catch {
      return NextResponse.json({ error: 'Failed to parse Session A result' }, { status: 500 });
    }

    try {
      resultB = JSON.parse(sessionB.result ?? '') as AggregatedResult;
    } catch {
      return NextResponse.json({ error: 'Failed to parse Session B result' }, { status: 500 });
    }

    const diff = diffCrawls(
      sessionAId,
      resultA,
      sessionBId,
      resultB,
      sessionA.createdAt.toISOString(),
      sessionB.createdAt.toISOString()
    );

    return NextResponse.json(diff);
  } catch (error) {
    console.error('Diff error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
