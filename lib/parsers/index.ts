import { BaseParser } from './base.parser';
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
  LinksParser,
  ExternalLinksParser,
  SecurityParser,
  InsecureContentParser,
  SitemapsParser,
  OrphanPagesParser,
  AnchorTextParser,
  LinksIssuesParser,
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
} from './performance';

// Structured Data
import { StructuredDataParser } from './structuredData';

// Content
import { SpellingGrammarParser, GrammarParser, ContentReadabilityParser, LowContentParser } from './content';

// Issues
import { IssuesOverviewParser, BestPracticeParser, CarbonParser } from './issues';

// Parser registry - all available parsers
export const PARSERS: Array<typeof BaseParser> = [
  // Core (highest priority)
  InternalParser,

  // Issues Overview (ScreamingFrog pre-computed issues)
  IssuesOverviewParser,

  // SEO Elements
  PageTitlesParser,
  MetaDescriptionParser,
  H1Parser,
  H2Parser,

  // Technical
  ResponseCodesParser,
  CanonicalsParser,
  DirectivesParser,
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
  LinksParser,
  ExternalLinksParser,
  LinksIssuesParser,
  SecurityParser,
  InsecureContentParser,
  SitemapsParser,
  OrphanPagesParser,
  AnchorTextParser,

  // Analytics and Search
  AnalyticsParser,
  SearchConsoleParser,
  CrawlOverviewParser,

  // Performance
  PageSpeedParser,
  ResponseTimeParser,

  // Structured Data
  StructuredDataParser,

  // Content
  SpellingGrammarParser,
  GrammarParser,
  ContentReadabilityParser,
  LowContentParser,

  // Issues
  BestPracticeParser,
  CarbonParser,
];

// Parser map by name for easy lookup
export const PARSER_MAP: Record<string, typeof BaseParser> = {
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
  links: LinksParser,
  externallinks: ExternalLinksParser,
  linksissues: LinksIssuesParser,
  security: SecurityParser,
  insecurecontent: InsecureContentParser,
  sitemaps: SitemapsParser,
  orphanpages: OrphanPagesParser,
  anchortext: AnchorTextParser,
  // Analytics and Search
  analytics: AnalyticsParser,
  searchconsole: SearchConsoleParser,
  crawloverview: CrawlOverviewParser,
  // Performance
  pagespeed: PageSpeedParser,
  responsetime: ResponseTimeParser,
  // Structured Data
  structureddata: StructuredDataParser,
  // Content
  spellinggrammar: SpellingGrammarParser,
  grammar: GrammarParser,
  contentreadability: ContentReadabilityParser,
  lowcontent: LowContentParser,
  // Issues
  bestpractice: BestPracticeParser,
  carbon: CarbonParser,
};

/**
 * Find the appropriate parser for a given filename
 */
export function findParserForFile(filename: string): typeof BaseParser | null {
  for (const ParserClass of PARSERS) {
    if (ParserClass.matchesFile(filename)) {
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
  LinksParser,
  ExternalLinksParser,
  SecurityParser,
  InsecureContentParser,
  SitemapsParser,
  OrphanPagesParser,
  AnchorTextParser,
  LinksIssuesParser,
};
export {
  AnalyticsParser,
  SearchConsoleParser,
  CrawlOverviewParser,
};
export {
  PageSpeedParser,
  ResponseTimeParser,
};
export { StructuredDataParser };
export { SpellingGrammarParser, GrammarParser, ContentReadabilityParser, LowContentParser };
export { IssuesOverviewParser, BestPracticeParser, CarbonParser };
