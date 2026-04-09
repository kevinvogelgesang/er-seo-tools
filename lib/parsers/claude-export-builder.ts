import type {
  AggregatedResult,
  CrawlSummary,
  IssuesResult,
  ResourcesSummary,
  TechnicalSummary,
  DuplicateContent,
  PageSpeedOpportunity,
} from '@/lib/types';

export interface TechnicalAuditSiteStructure {
  crawl_depth_distribution?: Record<number, number>;
  non_indexable_reasons?: Array<Record<string, string>>;
  hreflang_languages?: Record<string, number>;
}

export interface GscSummary {
  total_clicks: number;
  total_impressions: number;
  avg_position: number;
}

export interface Ga4Summary {
  total_sessions: number;
  avg_bounce_rate?: number;
}

export interface TechnicalAuditPerformance {
  core_web_vitals?: Record<string, number>;
  server_response?: Record<string, number>;
  pagespeed_opportunities?: PageSpeedOpportunity[];
  gsc_summary?: GscSummary;
  ga4_summary?: Ga4Summary;
}

export interface TechnicalAuditExport {
  crawl_summary: CrawlSummary;
  issues: IssuesResult;
  site_structure: TechnicalAuditSiteStructure;
  resources: ResourcesSummary;
  technical_seo: TechnicalSummary;
  performance: TechnicalAuditPerformance;
  duplicate_content?: DuplicateContent;
  recommendations: string[];
  metadata: AggregatedResult['metadata'];
}

export function buildTechnicalAuditExport(result: AggregatedResult): TechnicalAuditExport {
  const { site_structure, performance } = result;

  const technicalSiteStructure: TechnicalAuditSiteStructure = {
    crawl_depth_distribution: site_structure.crawl_depth_distribution,
    hreflang_languages: site_structure.hreflang_languages,
    non_indexable_reasons: site_structure.non_indexable_reasons,
  };

  // performance.stats (raw pagespeed aggregate bucket) intentionally excluded — not actionable for Claude context
  const technicalPerformance: TechnicalAuditPerformance = {
    core_web_vitals: performance.core_web_vitals,
    server_response: performance.server_response,
    pagespeed_opportunities: performance.pagespeed_opportunities,
  };

  // total_clicks is the canonical presence indicator for GSC data — always set first by SearchConsoleParser
  if (performance.search_console && performance.search_console['total_clicks'] !== undefined) {
    const sc = performance.search_console;
    technicalPerformance.gsc_summary = {
      total_clicks: sc['total_clicks'] ?? 0,
      total_impressions: sc['total_impressions'] ?? 0,
      avg_position: sc['avg_position'] ?? 0,
    };
  }

  if (performance.ga4_traffic) {
    const ga4 = performance.ga4_traffic;
    if (ga4.total_sessions !== undefined) {
      technicalPerformance.ga4_summary = {
        total_sessions: ga4.total_sessions,
        avg_bounce_rate: ga4.avg_bounce_rate,
      };
    }
  }

  return {
    crawl_summary: result.crawl_summary,
    issues: result.issues,
    site_structure: technicalSiteStructure,
    resources: result.resources,
    technical_seo: result.technical_seo,
    performance: technicalPerformance,
    duplicate_content: result.duplicate_content,
    recommendations: result.recommendations,
    metadata: result.metadata,
  };
}
