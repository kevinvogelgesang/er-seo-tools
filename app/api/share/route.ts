import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { prisma } from '@/lib/db';
import { isValidSessionId } from '@/lib/upload-helpers';

export const dynamic = 'force-dynamic';

interface ShareRequestBody {
  sessionId: string;
}

export async function POST(request: NextRequest) {
  let body: ShareRequestBody;
  try {
    body = (await request.json()) as ShareRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { sessionId } = body;

  if (!sessionId || !isValidSessionId(sessionId)) {
    return NextResponse.json({ error: 'Invalid or missing sessionId' }, { status: 400 });
  }

  const session = await prisma.session.findUnique({ where: { id: sessionId } });

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  if (session.status !== 'complete' || !session.result) {
    return NextResponse.json({ error: 'Session is not complete' }, { status: 400 });
  }

  const token = randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  await prisma.shareLink.create({
    data: {
      sessionId,
      token,
      expiresAt,
    },
  });

  const origin =
    process.env.NEXT_PUBLIC_APP_URL ||
    request.headers.get('origin') ||
    'http://localhost:3000';
  const shareUrl = `${origin}/share/${token}`;

  return NextResponse.json({
    token,
    shareUrl,
    expiresAt: expiresAt.toISOString(),
  });
}
