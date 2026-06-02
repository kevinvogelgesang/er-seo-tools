import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { AUTH_COOKIE_NAME, isValidAuthCookie } from '@/lib/auth';
import { mintKeywordMemoToken, KeywordMemoTokenError } from '@/lib/keyword-memo-token';

export async function POST(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;

  if (!(await isValidAuthCookie(req.cookies.get(AUTH_COOKIE_NAME)?.value))) {
    return NextResponse.json({ error: 'auth_required' }, { status: 401 });
  }

  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (session.status !== 'complete') {
    return NextResponse.json({ error: 'session_not_complete', status: session.status }, { status: 409 });
  }

  // Get-or-create the keywordResearch row (one per session) as 'pending'. Catch ONLY the unique race (P2002).
  let row = await prisma.keywordResearchSession.findUnique({ where: { sessionId } });
  if (!row) {
    // Look up the most recent complete technical session for this client (only when clientId is non-null).
    let technicalSessionId: string | null = null;
    if (session.clientId != null) {
      const technicalSession = await prisma.session.findFirst({
        where: {
          clientId: session.clientId,
          status: 'complete',
          workflow: 'technical',
          id: { not: sessionId },
          keywordResearch: { is: null },
        },
        orderBy: { createdAt: 'desc' },
      });
      technicalSessionId = technicalSession?.id ?? null;
    }

    try {
      row = await prisma.keywordResearchSession.create({
        data: { sessionId, clientId: session.clientId, technicalSessionId },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        row = await prisma.keywordResearchSession.findUnique({ where: { sessionId } });
      } else {
        throw err;
      }
      if (!row) return NextResponse.json({ error: 'memo_unavailable' }, { status: 500 });
    }
  }

  let minted;
  try {
    minted = await mintKeywordMemoToken(row.id);
  } catch (err) {
    if (err instanceof KeywordMemoTokenError) {
      // eslint-disable-next-line no-console
      console.error('[keyword-memo-token] mint failed:', err.message);
      await prisma.keywordResearchSession.update({ where: { id: row.id }, data: { status: 'error', error: 'token_service_unavailable' } });
      return NextResponse.json({ error: 'token_service_unavailable' }, { status: 500 });
    }
    throw err;
  }

  await prisma.keywordResearchSession.update({
    where: { id: row.id },
    data: { status: 'processing', tokenMintedAt: new Date(), error: null },
  });
  return NextResponse.json({ ...minted, memoId: row.id });
}
