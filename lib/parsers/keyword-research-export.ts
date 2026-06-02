import type { AggregatedResult, KeywordSignals, DuplicateContent } from '@/lib/types';

export interface KeywordResearchExport {
  site_name?: string;
  crawl_summary: { total_urls: number; indexable_urls?: number };
  keyword_signals?: KeywordSignals;            // incl. gap_keywords
  duplicate_titles?: DuplicateContent['duplicate_titles']; // cannibalization context only
}

// Cap gap_keywords in the payload (real SEMRush Keyword Gap exports can be huge); keep the
// highest-volume opportunities, which is what the memo prioritizes anyway.
const MAX_GAP_KEYWORDS = 500;

export function buildKeywordResearchExport(result: AggregatedResult): KeywordResearchExport {
  let keyword_signals = result.keyword_signals;
  if (keyword_signals?.gap_keywords && keyword_signals.gap_keywords.length > MAX_GAP_KEYWORDS) {
    const topGaps = [...keyword_signals.gap_keywords]
      .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
      .slice(0, MAX_GAP_KEYWORDS);
    keyword_signals = { ...keyword_signals, gap_keywords: topGaps };
  }
  return {
    site_name: result.metadata?.site_name,
    crawl_summary: {
      total_urls: result.crawl_summary?.total_urls ?? 0,
      indexable_urls: (result.crawl_summary as { indexable_urls?: number } | undefined)?.indexable_urls,
    },
    keyword_signals,
    duplicate_titles: result.duplicate_content?.duplicate_titles,
  };
}
