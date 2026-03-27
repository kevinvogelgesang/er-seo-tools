import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/parse/history
 * Return the last 50 parse sessions.
 */
export async function GET() {
  try {
    const sessions = await prisma.session.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
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

      // Extract health score and URL count from stored result JSON
      let healthScore: number | undefined;
      let urlCount: number | undefined;
      try {
        if (s.result) {
          const r = JSON.parse(s.result);
          healthScore = typeof r?.healthScore === 'number' ? r.healthScore :
                        typeof r?.metadata?.health_score === 'number' ? r.metadata.health_score : undefined;
          urlCount = typeof r?.summary?.totalUrls === 'number' ? r.summary.totalUrls :
                     typeof r?.metadata?.total_urls === 'number' ? r.metadata.total_urls : undefined;
        }
      } catch { /* ignore */ }

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { result: _result, ...rest } = s;
      return { ...rest, files, healthScore, urlCount };
    });

    return NextResponse.json(formatted);
  } catch (error) {
    console.error('Get history error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
