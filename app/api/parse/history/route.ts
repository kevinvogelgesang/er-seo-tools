import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/parse/history
 * Return the last 20 parse sessions.
 */
export async function GET() {
  try {
    const sessions = await prisma.session.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        createdAt: true,
        status: true,
        files: true,
      },
    });

    const formatted = sessions.map((s) => ({
      ...s,
      files: JSON.parse(s.files) as string[],
    }));

    return NextResponse.json(formatted);
  } catch (error) {
    console.error('Get history error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
