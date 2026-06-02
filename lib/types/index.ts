// Core types for SEO Parser

// --- URL Registry / Page Index (SEO Audit Overhaul Phase 1) ---

export type UrlKind = 'page' | 'resource' | 'external' | 'redirect-target' | 'sitemap' | 'hreflang';

export interface UrlRegistryEntry {
  id: number;          // UrlRef target = index in UrlRegistry.urls
  kind: UrlKind;
  hostId: number;      // index into UrlRegistry.hosts
  scheme: string;      // per-entry scheme (external links may differ from sessionOrigin)
  path: string;        // path (+ optional query); host omitted only for sessionOrigin host
  query?: string;
  originalUrl?: string; // fallback when canonical reconstruction is unsafe
}

export interface UrlRegistry {
  sessionOrigin: { scheme: string; host: string };
  hosts: string[];
  urls: UrlRegistryEntry[];
}

export type UrlRef = number; // index into UrlRegistry.urls

export interface PageIndexEntry {
  ref: UrlRef;
  title: string | null;
  h1: string | null;
  metaDescription: string | null;
  wordCount: number | null;
  crawlDepth: number | null;
  indexable: boolean;
  issueTypes: string[];
}

export interface SupplementalData {
  dataforseo?: Record<string, unknown>;
  liveChecks?: Record<string, unknown>;
}

export interface PerUrlRecord {
  url: string;
  title: string | null;
  h1: string | null;
  metaDescription: string | null;
  wordCount: number | null;
  crawlDepth: number | null;
  indexable: boolean;
}

// --- End URL Registry / Page Index ---

export interface Issue {
  type: string;
  severity: 'critical' | 'warning' | 'notice';
  count: number;
  description: string;
  urls?: string[];         // display/sample/back-compat only — not the full affected set
  affectedUrlRefs?: UrlRef[];      // best-available set (see flags below)
  affectedUrlRefsComplete?: boolean;  // true only when the full affected set is known
  affectedUrlSource?: 'derived-page-index' | 'parser-complete' | 'parser-sample';
  groups?: Array<{ title?: string; h1?: string; meta_description?: string; count: number; urls?: string[] }>;
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
  avg_link_score?: number; // NEW
  pages_under_300_words?: number; // NEW
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
  accessibility?: { // NEW
    total_pages: number;
    pages_with_errors: number;
    pages_with_alerts: number;
    error_rate: number;
  };
}

export interface TechnicalSummary {
  structured_data?: { pages_with_schema: number; schema_types: Record<string, number> };
  security?: Record<string, number>;
  robots_directives?: Record<string, number>;
  canonicals?: { // NEW — expanded
    total_pages: number;
    self_referencing?: number;
    non_self_canonical?: number;
    missing_canonical?: number;
  };
  sitemaps?: { urls_in_sitemap: number; stats: Record<string, number> };
}

export interface PerformanceSummary {
  core_web_vitals?: Record<string, number>;
  stats?: Record<string, number>;
  server_response?: Record<string, number>;
  ga4_traffic?: Record<string, number>;
  search_console?: Record<string, number>;
  pagespeed_opportunities?: PageSpeedOpportunity[];
  gsc_top_pages?: GscPageStat[];
  ga4_top_pages?: Ga4PageStat[];
}

export interface GscPageStat {
  url: string;
  clicks: number;
  impressions: number;
  ctr_pct: number;
  average_position: number;
}

export interface Ga4PageStat {
  url: string;
  sessions: number;
  views: number;
  engaged_sessions: number;
  bounce_rate_pct: number;
  average_session_duration_seconds: number;
}

export interface PageSpeedOpportunity {
  opportunity: string;
  urls_affected: number;
  total_savings_ms: number;
  average_savings_ms: number;
  total_savings_size_bytes: number;
}


export interface GapKeyword { keyword: string; volume: number; difficulty?: number; intent?: string; }

export interface CannibalizedKeyword {
  keyword: string;
  search_volume: number;
  intent: string;
  competing_urls: Array<{ url: string; position: number; estimated_traffic: number }>;
}

export interface OptimizationGap {
  url: string;
  title: string;
  h1: string;
  top_ranking_keywords: Array<{ keyword: string; position: number; search_volume: number }>;
}

export interface QuickWin {
  keyword: string;
  position: number;
  search_volume: number;
  intent: string;
  url: string;
}

export interface TopOrganicPage {
  url: string;
  estimated_monthly_traffic: number;
  keyword_count: number;
  traffic_share_pct: number;
  dominant_intent: string;
}

export interface KeywordSignals {
  semrush_connected: boolean;
  gsc_connected: boolean;
  ga4_connected: boolean;
  total_ranking_keywords: number;
  keyword_cannibalization: CannibalizedKeyword[];
  optimization_gaps: OptimizationGap[];
  quick_wins: QuickWin[];
  top_pages_by_organic_traffic: TopOrganicPage[];
  gap_keywords?: GapKeyword[];
}

export interface ExactDuplicatePair {
  address: string;
  duplicate_of: string;
  similarity_pct: number;
  indexability: 'Indexable' | 'Non-Indexable' | string; // SF vocabulary; string fallback for unexpected values
}

export interface NearDuplicateEntry {
  address: string;
  closest_match: string;
  near_duplicate_count: number;
  indexability: 'Indexable' | 'Non-Indexable' | string;
}

export interface DuplicateContent {
  exact_duplicates: ExactDuplicatePair[];
  near_duplicates: NearDuplicateEntry[];
  duplicate_titles: Array<{ title: string; affected_urls: string[]; count?: number }>;
  duplicate_meta_descriptions: Array<{ meta_description: string; affected_urls: string[]; count?: number }>;
  duplicate_h1s: Array<{ h1: string; affected_urls: string[]; count?: number }>;
  exact_duplicates_count?: number;
  near_duplicates_count?: number;
  duplicate_titles_count?: number;
  duplicate_meta_descriptions_count?: number;
  duplicate_h1s_count?: number;
}

export interface Recommendation {
  issueType: string;
  severity: 'critical' | 'warning' | 'notice';
  count: number;
  effort: 'low' | 'medium' | 'high';
  fixGuidance: string;
  affectedUrlRefs: UrlRef[];
  affectedUrlCount: number;
  affectedUrlComplete: boolean;
  affectedUrlSource?: 'derived-page-index' | 'parser-complete' | 'parser-sample';
  affectedSetHash: string;
  groups?: Issue['groups'];
  sampleUrls?: string[];
}

export interface AggregatedResult {
  crawl_summary: CrawlSummary;
  issues: IssuesResult;
  site_structure: SiteStructure;
  resources: ResourcesSummary;
  technical_seo: TechnicalSummary;
  performance: PerformanceSummary;
  duplicate_content?: DuplicateContent;
  keyword_signals?: KeywordSignals;
  recommendations: string[];
  structured_recommendations?: Recommendation[];
  metadata: {
    files_processed: string[];
    parsers_used: string[];
    total_parsers_available: number;
    site_name?: string;
    health_score?: number;
  };
  url_registry?: UrlRegistry;
  page_index?: PageIndexEntry[];
  supplemental_data?: SupplementalData;
  completeness?: Completeness;
}

/**
 * Post-parse verdict on whether the uploaded crawl is rich enough to act on.
 * The webapp is the source of truth; the export carries this so the handoff
 * skill can surface a factual scope caveat without re-deriving thresholds.
 */
export interface Completeness {
  verdict: 'complete' | 'partial' | 'thin';
  pageIndexCount: number;        // crawled pages with per-URL data (0 ⇒ no internal crawl)
  totalIssues: number;
  noUrlIssues: number;           // issues with neither affectedUrlRefs nor sample urls
  noUrlIssueRatio: number;       // noUrlIssues / totalIssues (0 when no issues)
  hasInternalCrawl: boolean;     // pageIndexCount > 0
  missingInputs: string[];       // human-readable inputs that would complete the audit
  message: string;               // short banner copy; '' when verdict === 'complete'
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
  pages_under_300_words?: number; // NEW — alias for thin_content_count for clarity
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
  link_score?: LinkScoreData; // NEW
  near_duplicates?: NearDuplicateData; // NEW
  folder_depth?: FolderDepthData; // NEW
  gsc_connected?: boolean; // GSC columns present in CSV
  ga4_connected?: boolean; // GA4 columns present in CSV
  gsc_top_pages?: GscPageStat[]; // top 50 pages by impressions
  ga4_top_pages?: Ga4PageStat[]; // top 50 pages by sessions
  per_url_index?: PerUrlRecord[]; // full per-URL record set for registry/export
}

// NEW — Link Score (SF internal PageRank-like metric 0–100)
export interface LinkScoreData {
  avg_link_score: number;
  min_link_score: number;
  max_link_score: number;
  distribution: Record<string, number>; // bucketed: "0-10", "11-25", etc.
}

// NEW — Near Duplicate pages detected by Screaming Frog
export interface NearDuplicateData {
  total_near_duplicates: number;
  near_duplicate_urls: string[];
  truncated: boolean;
}

// NEW — Folder Depth distribution
export interface FolderDepthData {
  distribution: Record<number, number>;
  avg_folder_depth: number;
  max_folder_depth: number;
}

// NEW — Accessibility parser result
export interface AccessibilityResult extends ParsedData {
  totalPages: number;
  pagesWithErrors: number;
  pagesWithAlerts: number;
  totalErrors: number;
  totalAlerts: number;
  errorRate: number; // pagesWithErrors / totalPages
  issues: Issue[];
}

// Parser type definitions
export type CSVRow = Record<string, string | number | null | undefined>;
export type CSVData = CSVRow[];
