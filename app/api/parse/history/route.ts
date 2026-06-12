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
      where: { workflow: 'technical' }, // keep keyword-research uploads out of the technical history + diff picker
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        createdAt: true,
        status: true,
        files: true,
        siteName: true,
        clientId: true,
        client: { select: { id: true, name: true } },
        result: true,
        totalUrls: true,
        crawlRun: { select: { score: true } },
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

      // C5 flip: CrawlRun.score + Session.totalUrls scalars first;
      // the blob parse survives only for pre-A2 sessions (no CrawlRun).
      let healthScore: number | undefined = s.crawlRun?.score ?? undefined;
      let urlCount: number | undefined = s.totalUrls ?? undefined;
      if (!s.crawlRun) {
        try {
          if (s.result) {
            const r = JSON.parse(s.result);
            healthScore = typeof r?.healthScore === 'number' ? r.healthScore :
                          typeof r?.metadata?.health_score === 'number' ? r.metadata.health_score : undefined;
            urlCount = urlCount ??
                       (typeof r?.crawl_summary?.total_urls === 'number' ? r.crawl_summary.total_urls :
                        typeof r?.summary?.totalUrls === 'number' ? r.summary.totalUrls :
                        typeof r?.metadata?.total_urls === 'number' ? r.metadata.total_urls : undefined);
          }
        } catch { /* ignore */ }
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { result: _result, client: _client, crawlRun: _crawlRun, ...rest } = s;
      return {
        ...rest,
        files,
        healthScore,
        urlCount,
        clientId: s.clientId ?? null,
        clientName: s.client?.name ?? null,
      };
    });

    return NextResponse.json(formatted);
  } catch (error) {
    console.error('Get history error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
