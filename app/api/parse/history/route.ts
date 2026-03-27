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
        siteName: true,
        result: true,
      },
    });

    const formatted = sessions.map((s) => {
      let files: string[] = [];
      try {
        const p = JSON.parse(s.files);
        files = Array.isArray(p) ? p : [];
      } catch {
        files = [];
      }

      // Extract health score from stored result JSON without deserializing the full object
      let healthScore: number | undefined;
      if (s.result) {
        try {
          const r = JSON.parse(s.result) as { metadata?: { health_score?: number } };
          if (typeof r.metadata?.health_score === 'number') {
            healthScore = r.metadata.health_score;
          }
        } catch {
          // ignore
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { result: _result, ...rest } = s;
      return { ...rest, files, healthScore };
    });

    return NextResponse.json(formatted);
  } catch (error) {
    console.error('Get history error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
