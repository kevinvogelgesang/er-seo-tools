import type { AggregatedResult, KeywordSignals, DuplicateContent } from '@/lib/types';

export interface KeywordResearchExport {
  site_name?: string;
  crawl_summary: { total_urls: number; indexable_urls?: number };
  keyword_signals?: KeywordSignals;            // incl. gap_keywords
  duplicate_titles?: DuplicateContent['duplicate_titles']; // cannibalization context only
}

export function buildKeywordResearchExport(result: AggregatedResult): KeywordResearchExport {
  return {
    site_name: result.metadata?.site_name,
    crawl_summary: {
      total_urls: result.crawl_summary?.total_urls ?? 0,
      indexable_urls: (result.crawl_summary as { indexable_urls?: number } | undefined)?.indexable_urls,
    },
    keyword_signals: result.keyword_signals,
    duplicate_titles: result.duplicate_content?.duplicate_titles,
  };
}
