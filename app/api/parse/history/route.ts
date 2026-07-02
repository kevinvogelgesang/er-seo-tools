import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/parse/history
 * Return the last 50 parse sessions/runs merged and source-labeled.
 * SF sessions: kind='session', source='sf-upload'
 * Live-scan runs (seoIntent=true): kind='run', source='live-scan'
 */
export async function GET() {
  try {
    const [sessions, liveRuns] = await Promise.all([
      prisma.session.findMany({
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
      }),
      prisma.crawlRun.findMany({
        where: { tool: 'seo-parser', source: 'live-scan', seoIntent: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          createdAt: true,
          score: true,
          domain: true,
          pagesTotal: true,
          clientId: true,
          client: { select: { id: true, name: true } },
        },
      }),
    ]);

    const sessionEntries = sessions.map((s) => {
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

      return {
        id: s.id,
        kind: 'session' as const,
        source: 'sf-upload' as const,
        createdAt: s.createdAt,
        status: s.status,
        files,
        siteName: s.siteName ?? null,
        clientId: s.clientId ?? null,
        clientName: s.client?.name ?? null,
        healthScore,
        urlCount,
      };
    });

    const runEntries = liveRuns.map((r) => ({
      id: r.id,
      kind: 'run' as const,
      source: 'live-scan' as const,
      createdAt: r.createdAt,
      status: 'complete' as const,
      files: [] as string[],
      siteName: r.domain ?? null,
      clientId: r.clientId ?? null,
      clientName: r.client?.name ?? null,
      healthScore: r.score ?? undefined,
      urlCount: r.pagesTotal,
    }));

    // Merge, sort newest-first, cap at 50
    const merged = [...sessionEntries, ...runEntries]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 50);

    return NextResponse.json(merged);
  } catch (error) {
    console.error('Get history error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
