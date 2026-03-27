// Core types for SEO Parser

export interface Issue {
  type: string;
  severity: 'critical' | 'warning' | 'notice';
  count: number;
  description: string;
  urls?: string[];
  groups?: Array<{ title?: string; h1?: string; count: number }>;
  total_affected?: number;
  truncated?: boolean;
  source?: string;
  threshold?: string;
}

export interface ParsedData {
  [key: string]: unknown;
}

export interface CrawlSummary {
  total_urls: number;
  indexable_urls?: number;
  non_indexable_urls?: number;
  ok_responses?: number;
  redirects?: number;
  client_errors?: number;
  server_errors?: number;
  avg_word_count?: number;
  avg_crawl_depth?: number;
  max_crawl_depth?: number;
}

export interface IssuesResult {
  critical: Issue[];
  warnings: Issue[];
  notices: Issue[];
}

export interface SiteStructure {
  crawl_depth_distribution?: Record<number, number>;
  internal_link_distribution?: Record<string, number>;
  non_indexable_reasons?: Array<Record<string, string>>;
  hreflang_languages?: Record<string, number>;
}

export interface ResourcesSummary {
  images?: { total: number; stats?: Record<string, number> };
  javascript?: { total: number; stats?: Record<string, number> };
  css?: { total: number; stats?: Record<string, number> };
  pdfs?: { total: number };
}

export interface TechnicalSummary {
  structured_data?: { pages_with_schema: number; schema_types: Record<string, number> };
  security?: Record<string, number>;
  robots_directives?: Record<string, number>;
  canonicals?: { total_pages: number };
  sitemaps?: { urls_in_sitemap: number; stats: Record<string, number> };
}

export interface PerformanceSummary {
  core_web_vitals?: Record<string, number>;
  stats?: Record<string, number>;
  server_response?: Record<string, number>;
  ga4_traffic?: Record<string, number>;
  search_console?: Record<string, number>;
}

export interface AggregatedResult {
  crawl_summary: CrawlSummary;
  issues: IssuesResult;
  site_structure: SiteStructure;
  resources: ResourcesSummary;
  technical_seo: TechnicalSummary;
  performance: PerformanceSummary;
  recommendations: string[];
  metadata: {
    files_processed: string[];
    parsers_used: string[];
    total_parsers_available: number;
    site_name?: string;
    health_score?: number;
  };
}

export interface Session {
  id: string;
  files: string[];
  createdAt: Date;
  status: 'pending' | 'parsing' | 'complete' | 'error';
  result?: AggregatedResult;
  error?: string;
}

export interface StatusCodeData {
  distribution: Record<string, number>;
  ok_2xx: number;
  redirect_3xx: number;
  client_error_4xx: number;
  server_error_5xx: number;
  broken_urls: string[];
}

export interface IndexabilityData {
  indexable: number;
  non_indexable: number;
  non_indexable_reasons: Array<Record<string, string>>;
}

export interface ContentMetrics {
  avg_word_count: number;
  min_word_count: number;
  max_word_count: number;
  thin_content_count: number;
  thin_content_urls: string[];
}

export interface SEOElementsSummary {
  html_pages_count: number;
  indexable_html_count: number;
  missing_titles_count?: number;
  missing_titles_urls?: string[];
  missing_titles_truncated?: boolean;
  duplicate_titles_count?: number;
  duplicate_title_groups?: Array<{ title: string; count: number }>;
  missing_meta_count?: number;
  missing_meta_urls?: string[];
  missing_meta_truncated?: boolean;
  duplicate_meta_count?: number;
  missing_h1_count?: number;
  missing_h1_urls?: string[];
  missing_h1_truncated?: boolean;
}

export interface CrawlDepthData {
  distribution: Record<number, number>;
  avg_depth: number;
  max_depth: number;
}

export interface InternalParserResult extends ParsedData {
  total_urls: number;
  urls: string[];
  status_codes: StatusCodeData;
  indexability: IndexabilityData;
  content_metrics: ContentMetrics;
  seo_elements_summary: SEOElementsSummary;
  crawl_depth: CrawlDepthData;
}

// Parser type definitions
export type CSVRow = Record<string, string | number | null | undefined>;
export type CSVData = CSVRow[];
