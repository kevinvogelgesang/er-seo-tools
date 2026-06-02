import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { AUTH_COOKIE_NAME, isValidAuthCookie } from '@/lib/auth';
import { mintSeoRoadmapToken, SeoRoadmapTokenError } from '@/lib/seo-roadmap-token';

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

  // Get-or-create the roadmap row (one per session) as 'pending'. Catch ONLY the unique race (P2002).
  let roadmap = await prisma.seoRoadmap.findUnique({ where: { sessionId } });
  if (!roadmap) {
    try {
      roadmap = await prisma.seoRoadmap.create({ data: { sessionId } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        roadmap = await prisma.seoRoadmap.findUnique({ where: { sessionId } });
      } else {
        throw err;
      }
      if (!roadmap) return NextResponse.json({ error: 'roadmap_unavailable' }, { status: 500 });
    }
  }

  let minted;
  try {
    minted = await mintSeoRoadmapToken(roadmap.id);
  } catch (err) {
    if (err instanceof SeoRoadmapTokenError) {
      // eslint-disable-next-line no-console
      console.error('[seo-roadmap-token] mint failed:', err.message);
      await prisma.seoRoadmap.update({ where: { id: roadmap.id }, data: { status: 'error', error: 'token_service_unavailable' } });
      return NextResponse.json({ error: 'token_service_unavailable' }, { status: 500 });
    }
    throw err;
  }

  await prisma.seoRoadmap.update({
    where: { id: roadmap.id },
    data: { status: 'processing', tokenMintedAt: new Date(), error: null },
  });
  return NextResponse.json({ ...minted, roadmapId: roadmap.id });
}
