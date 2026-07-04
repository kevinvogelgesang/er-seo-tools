import { BaseParser } from './base.parser';
import type { ParserClass } from './header-map';
import { InternalParser } from './internal.parser';

// SEO Elements
import {
  PageTitlesParser,
  MetaDescriptionParser,
  H1Parser,
  H2Parser,
} from './seoElements';

// Technical
import {
  ResponseCodesParser,
  CanonicalsParser,
  DirectivesParser,
  RedirectChainsParser,
  HreflangParser,
  RedirectsParser,
  PaginationParser,
  UrlIssuesParser,
} from './technical';

// Resources
import {
  ImagesParser,
  JavaScriptParser,
  CSSParser,
  PDFParser,
  ExternalLinksParser,
  SecurityParser,
  InsecureContentParser,
  SitemapsParser,
  OrphanPagesParser,
  AnchorTextParser,
  LinksIssuesParser,
  AccessibilityParser, // NEW
} from './resources';

// Analytics and Search
import {
  AnalyticsParser,
  SearchConsoleParser,
  CrawlOverviewParser,
} from './analytics';

// Performance
import {
  PageSpeedParser,
  ResponseTimeParser,
  PageSpeedOpportunitiesParser,
} from './performance';

// Structured Data
import { StructuredDataParser } from './structuredData';

// Content
import { SpellingGrammarParser, GrammarParser, ContentReadabilityParser, LowContentParser, ExactDuplicatesParser, NearDuplicatesParser } from './content';

// SEMRush
import { SemrushOrganicPositionsParser, SemrushOrganicPagesParser, SemrushPositionTrackingParser, SemrushKeywordGapParser } from './semrush';

// Issues
import { IssuesOverviewParser, BestPracticeParser, CarbonParser } from './issues';

// Parser registry - all available parsers
export const PARSERS: ParserClass[] = [
  // Core (highest priority)
  InternalParser,

  // Issues Overview (ScreamingFrog pre-computed issues)
  IssuesOverviewParser,

  // SEO Elements
  PageTitlesParser,
  MetaDescriptionParser,
  H1Parser,
  H2Parser,

  // Must precede UrlIssuesParser (url_) and SecurityParser (security): both bare
  // substring patterns would swallow security_*_insecure.csv first.
  InsecureContentParser,

  // Technical
  ResponseCodesParser,
  CanonicalsParser,
  DirectivesParser,
  // NOTE: Screaming Frog ships redirect data inside the response_codes_* exports (e.g. response_codes_internal_redirect_chain.csv, response_codes_redirection_(3xx).csv), which match ResponseCodesParser first. These two parsers are retained but match no standalone SF export today.
  RedirectChainsParser,
  HreflangParser,
  RedirectsParser,
  PaginationParser,
  UrlIssuesParser,

  // Resources
  ImagesParser,
  JavaScriptParser,
  CSSParser,
  PDFParser,
  ExternalLinksParser,
  LinksIssuesParser,
  SecurityParser,
  SitemapsParser,
  OrphanPagesParser,
  AnchorTextParser,
  AccessibilityParser, // NEW

  // Analytics and Search
  AnalyticsParser,
  SearchConsoleParser,
  CrawlOverviewParser,

  // Performance — PageSpeedOpportunitiesParser must come before PageSpeedParser
  // because 'pagespeed_opportunities_summary' contains 'pagespeed' as a substring
  PageSpeedOpportunitiesParser,
  PageSpeedParser,
  // NOTE: latent — SF has no standalone response_time export (response time is a column in internal_all). Retained because aggregator/export-builder still read parsedData.responsetime when present.
  ResponseTimeParser,

  // Structured Data
  StructuredDataParser,

  // Content
  SpellingGrammarParser,
  GrammarParser,
  ContentReadabilityParser,
  LowContentParser,
  ExactDuplicatesParser,
  NearDuplicatesParser,

  // Issues
  BestPracticeParser,
  CarbonParser,

  // SEMRush (content-based detection — must be after all filename-based parsers)
  // Order: PositionTracking (raw-content) → OrganicPositions → KeywordGap → OrganicPages
  // KeywordGap must come after OrganicPositions so the negative-header check (URL, Position, etc.)
  // disambiguates them cleanly.  OrganicPages is last because its REQUIRED_HEADERS
  // (Number of Keywords, Adwords Positions) are unique enough to not conflict.
  SemrushPositionTrackingParser,
  SemrushOrganicPositionsParser,
  SemrushKeywordGapParser,
  SemrushOrganicPagesParser,
];

// Parser map by name for easy lookup
export const PARSER_MAP: Record<string, ParserClass> = {
  internal: InternalParser,
  // Issues Overview
  issuesoverview: IssuesOverviewParser,
  // SEO Elements
  pagetitles: PageTitlesParser,
  metadescription: MetaDescriptionParser,
  h1: H1Parser,
  h2: H2Parser,
  // Technical
  responsecodes: ResponseCodesParser,
  canonicals: CanonicalsParser,
  directives: DirectivesParser,
  redirectchains: RedirectChainsParser,
  hreflang: HreflangParser,
  redirects: RedirectsParser,
  pagination: PaginationParser,
  urlissues: UrlIssuesParser,
  // Resources
  images: ImagesParser,
  javascript: JavaScriptParser,
  css: CSSParser,
  pdf: PDFParser,
  externallinks: ExternalLinksParser,
  linksissues: LinksIssuesParser,
  security: SecurityParser,
  insecurecontent: InsecureContentParser,
  sitemaps: SitemapsParser,
  orphanpages: OrphanPagesParser,
  anchortext: AnchorTextParser,
  accessibility: AccessibilityParser, // NEW
  // Analytics and Search
  analytics: AnalyticsParser,
  searchconsole: SearchConsoleParser,
  crawloverview: CrawlOverviewParser,
  // Performance
  pagespeed: PageSpeedParser,
  responsetime: ResponseTimeParser,
  pagespeedopportunities: PageSpeedOpportunitiesParser,
  // Structured Data
  structureddata: StructuredDataParser,
  // Content
  spellinggrammar: SpellingGrammarParser,
  grammar: GrammarParser,
  contentreadability: ContentReadabilityParser,
  lowcontent: LowContentParser,
  exactduplicates: ExactDuplicatesParser,
  nearduplicates: NearDuplicatesParser,
  // Issues
  bestpractice: BestPracticeParser,
  carbon: CarbonParser,
  // SEMRush
  semrushorganicpositions: SemrushOrganicPositionsParser,
  semrushorganicpages: SemrushOrganicPagesParser,
  semrushpositiontracking: SemrushPositionTrackingParser,
  semrushkeywordgap: SemrushKeywordGapParser,
};

/**
 * Find the appropriate parser for a given filename.
 * Falls back to content-based detection when no filename match is found.
 *
 * Detection order:
 * 1. Filename-based (all SF parsers) — fast path
 * 2. Raw content detection — for files with metadata headers (e.g. Position Tracking)
 * 3. Header-based detection — for clean CSV files with dynamic filenames (e.g. SEMRush Organic)
 */
export function findParserForFile(
  filename: string,
  rawContent?: string
): ParserClass | null {
  // 1. Filename-based detection (fast path, covers all SF parsers)
  for (const ParserClass of PARSERS) {
    if (ParserClass.matchesFile(filename)) {
      return ParserClass;
    }
  }

  if (!rawContent) return null;

  // 2. Raw content detection (for files with metadata headers, e.g. Position Tracking)
  for (const ParserClass of PARSERS) {
    if (ParserClass.matchesRawContent(rawContent)) {
      return ParserClass;
    }
  }

  // 3. Header-based detection (for clean CSV files with dynamic filenames, e.g. SEMRush Organic)
  const firstLine = rawContent.replace(/^\uFEFF/, '').split('\n')[0] ?? '';
  const headers = firstLine.split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  for (const ParserClass of PARSERS) {
    if (ParserClass.matchesContent(headers)) {
      return ParserClass;
    }
  }

  return null;
}

/**
 * Get all parser names
 */
export function getParserNames(): string[] {
  return Object.keys(PARSER_MAP);
}

// Re-export all parsers
export { BaseParser, InternalParser };
export {
  PageTitlesParser,
  MetaDescriptionParser,
  H1Parser,
  H2Parser,
};
export {
  ResponseCodesParser,
  CanonicalsParser,
  DirectivesParser,
  RedirectChainsParser,
  HreflangParser,
  RedirectsParser,
  PaginationParser,
  UrlIssuesParser,
};
export {
  ImagesParser,
  JavaScriptParser,
  CSSParser,
  PDFParser,
  ExternalLinksParser,
  SecurityParser,
  InsecureContentParser,
  SitemapsParser,
  OrphanPagesParser,
  AnchorTextParser,
  LinksIssuesParser,
  AccessibilityParser, // NEW
};
export {
  AnalyticsParser,
  SearchConsoleParser,
  CrawlOverviewParser,
};
export {
  PageSpeedParser,
  ResponseTimeParser,
  PageSpeedOpportunitiesParser,
};
export { StructuredDataParser };
export { SpellingGrammarParser, GrammarParser, ContentReadabilityParser, LowContentParser, ExactDuplicatesParser, NearDuplicatesParser };
export { IssuesOverviewParser, BestPracticeParser, CarbonParser };
export { SemrushOrganicPositionsParser, SemrushOrganicPagesParser, SemrushPositionTrackingParser, SemrushKeywordGapParser };
