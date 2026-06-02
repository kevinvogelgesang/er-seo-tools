import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const row = await prisma.keywordResearchSession.findUnique({ where: { sessionId } });
  if (!row) return NextResponse.json({ keywordResearch: null });
  return NextResponse.json({
    keywordResearch: {
      id: row.id,
      sessionId: row.sessionId,
      status: row.status,
      error: row.error,
      memoMarkdown: row.memoMarkdown,
      memoUpdatedAt: row.memoUpdatedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
  });
}
