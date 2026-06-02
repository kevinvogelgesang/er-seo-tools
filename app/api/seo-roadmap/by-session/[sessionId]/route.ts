import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const rm = await prisma.seoRoadmap.findUnique({ where: { sessionId } });
  if (!rm) return NextResponse.json({ seoRoadmap: null });
  return NextResponse.json({
    seoRoadmap: {
      id: rm.id,
      sessionId: rm.sessionId,
      status: rm.status,
      error: rm.error,
      roadmapMarkdown: rm.roadmapMarkdown,
      roadmapUpdatedAt: rm.roadmapUpdatedAt,
      createdAt: rm.createdAt,
      updatedAt: rm.updatedAt,
    },
  });
}
