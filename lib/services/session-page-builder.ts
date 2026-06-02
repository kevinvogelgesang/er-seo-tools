import type { AggregatedResult } from '@/lib/types';
import { rehydrate } from './url-registry';
import { normalizeHost } from './normalize-host';

export interface SessionPageScalars {
  siteHost: string | null;
  totalUrls: number;
  criticalCount: number;
  warningCount: number;
  noticeCount: number;
}

export interface SessionPageRow {
  sessionId: string;
  url: string;
  title: string | null;
  h1: string | null;
  metaDescription: string | null;
  wordCount: number | null;
  crawlDepth: number | null;
  indexable: boolean;
  issueTypes: string;
  issueCount: number;
}

export function buildSessionPages(
  sessionId: string,
  result: AggregatedResult,
): { pages: SessionPageRow[]; scalars: SessionPageScalars } {
  const reg = result.url_registry;
  const pageIndex = result.page_index ?? [];

  const pages: SessionPageRow[] = reg
    ? pageIndex.map((p) => {
        const issueTypes = p.issueTypes ?? [];
        return {
          sessionId,
          url: rehydrate(reg, p.ref),
          title: p.title,
          h1: p.h1,
          metaDescription: p.metaDescription,
          wordCount: p.wordCount,
          crawlDepth: p.crawlDepth,
          indexable: p.indexable,
          issueTypes: JSON.stringify(issueTypes),
          issueCount: issueTypes.length,
        };
      })
    : [];

  const scalars: SessionPageScalars = {
    siteHost: normalizeHost(result.metadata.site_name ?? reg?.sessionOrigin.host ?? null),
    totalUrls: result.crawl_summary?.total_urls ?? pageIndex.length,
    criticalCount: result.issues.critical.length,
    warningCount: result.issues.warnings.length,
    noticeCount: result.issues.notices.length,
  };

  return { pages, scalars };
}
