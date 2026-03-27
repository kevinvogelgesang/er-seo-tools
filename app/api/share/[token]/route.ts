import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { AggregatedResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ token: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { token } = await params;

  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
  }

  const shareLink = await prisma.shareLink.findUnique({
    where: { token },
    include: { session: true },
  });

  if (!shareLink) {
    return NextResponse.json({ error: 'Share link not found' }, { status: 404 });
  }

  if (shareLink.expiresAt < new Date()) {
    return NextResponse.json({ error: 'Share link has expired' }, { status: 410 });
  }

  // Increment access count (fire-and-forget is fine here — non-critical)
  void prisma.shareLink.update({
    where: { token },
    data: { accessCount: { increment: 1 } },
  });

  const { session } = shareLink;

  if (session.status !== 'complete' || !session.result) {
    return NextResponse.json({ error: 'Session result not available' }, { status: 400 });
  }

  let result: AggregatedResult;
  try {
    result = JSON.parse(session.result) as AggregatedResult;
  } catch {
    return NextResponse.json({ error: 'Failed to parse session result' }, { status: 500 });
  }

  return NextResponse.json({
    result,
    expiresAt: shareLink.expiresAt.toISOString(),
    sessionId: session.id,
    siteName: session.siteName ?? null,
  });
}
