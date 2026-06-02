import { ParsedData, AggregatedResult, Issue, IssuesResult, CrawlSummary, DuplicateContent, KeywordSignals, GapKeyword, PageIndexEntry, PerUrlRecord } from '../types';
import { PARSERS } from '../parsers';
import { UrlRegistryBuilder } from './url-registry';
import { urlJoinKey } from './url-normalize';
import { computeCompleteness } from './completeness';
import { dropSupersededSfIssues } from './sf-issue-dedup';
import { buildAffectedRefs, deriveIssueTypesForPage } from './issue-membership';
import { ISSUE_RECOMMENDATIONS } from '@/lib/constants/issue-recommendations';
import { buildStructuredRecommendations } from './recommendation-builder';

function deriveOrigin(sampleUrl: string | undefined, siteName?: string): { scheme: string; host: string } {
  const src = sampleUrl ?? (siteName ? `https://${siteName}` : 'https://localhost');
  try { const u = new URL(src); return { scheme: u.protocol.replace(/:$/, ''), host: u.host }; }
  catch { return { scheme: 'https', host: siteName ?? 'localhost' }; }
}

/**
 * Issue deduplication and merging
 */
function dedupeIssues(issues: Issue[]): Issue[] {
  const seen: Record<string, Issue> = {};

  for (const issue of issues) {
    const issueType = issue.type;
    if (!issueType) continue;

    if (!seen[issueType]) {
      seen[issueType] = { ...issue };
    } else {
      const existing = seen[issueType];

      // Merge URL lists
      const existingUrls = existing.urls || [];
      const newUrls = issue.urls || [];
      if (existingUrls.length > 0 || newUrls.length > 0) {
        existing.urls = Array.from(new Set([...existingUrls, ...newUrls]));
      }

      // Keep higher count
      if ((issue.count || 0) > (existing.count || 0)) {
        existing.count = issue.count;
        existing.description = issue.description || existing.description;
      }

      // Merge groups
      if (issue.groups && existing.groups) {
        const existingTitles = new Set(existing.groups.map(g => g.title || g.h1 || g.meta_description));
        for (const g of issue.groups) {
          const title = g.title || g.h1 || g.meta_description;
          if (title && !existingTitles.has(title)) {
            existing.groups.push(g);
          }
        }
        existing.groups = existing.groups.slice(0, 10); // groups are heavy objects; cap intentional
      }
    }
  }

  return Object.values(seen);
}

export class AggregatorService {
  private parsedData: Record<string, ParsedData> = {};
  private filesProcessed: string[] = [];

  addParserResult(parserName: string, data: ParsedData, filename: string): void {
    this.parsedData[parserName.toLowerCase()] = this.mergeParserData(
      this.parsedData[parserName.toLowerCase()] || {},
      data
    );
    if (!this.filesProcessed.includes(filename)) {
      this.filesProcessed.push(filename);
    }
  }

  private mergeParserData(existing: ParsedData, newData: ParsedData): ParsedData {
    if (!existing || Object.keys(existing).length === 0) return newData;
    if (!newData || Object.keys(newData).length === 0) return existing;

    const merged = { ...existing };

    for (const [key, value] of Object.entries(newData)) {
      if (!(key in merged)) {
        merged[key] = value;
      } else if (key === 'issues' && Array.isArray(value)) {
        merged[key] = [...(merged[key] as Issue[] || []), ...value];
      } else if (key === 'per_url_index' && Array.isArray(merged[key]) && Array.isArray(value)) {
        // Object arrays can't dedupe via includes() (object identity); key by url, latest-wins.
        const byUrl = new Map<string, unknown>();
        for (const row of [...(merged[key] as { url: string }[]), ...(value as { url: string }[])]) {
          byUrl.set(row.url, row);
        }
        merged[key] = [...byUrl.values()];
      } else if (Array.isArray(value)) {
        const existingList = merged[key] as unknown[];
        const uniqueItems = value.filter(item => !existingList.includes(item));
        merged[key] = [...existingList, ...uniqueItems];
      } else if (typeof value === 'object' && value !== null) {
        merged[key] = this.mergeParserData(
          merged[key] as ParsedData || {},
          value as ParsedData
        );
      } else if (typeof value === 'number' && key.startsWith('total')) {
        merged[key] = ((merged[key] as number) || 0) + value;
      } else if (value) {
        merged[key] = value;
      }
    }

    return merged;
  }

  aggregate(): AggregatedResult {
    const issues = this.buildIssues();
    const result: AggregatedResult = {
      crawl_summary: this.buildCrawlSummary(),
      issues,
      site_structure: this.buildSiteStructure(),
      resources: this.buildResourcesSummary(),
      technical_seo: this.buildTechnicalSummary(),
      performance: this.buildPerformanceSummary(),
      recommendations: this.buildRecommendations(issues),
      metadata: {
        files_processed: this.filesProcessed,
        parsers_used: Object.keys(this.parsedData),
        total_parsers_available: PARSERS.length,
      },
    };

    // Populate keyword_signals connection flags from internal parser data
    const internal = this.parsedData.internal || {};
    const gscConnected = !!(internal.gsc_connected);
    const ga4Connected = !!(internal.ga4_connected);
    const semrushConnected = !!(this.parsedData.semrushorganicpositions || this.parsedData.semrushorganicpages || this.parsedData.semrushkeywordgap);

    if (gscConnected || ga4Connected || semrushConnected) {
      const baseKeywordSignals: KeywordSignals = {
        semrush_connected: semrushConnected,
        gsc_connected: gscConnected,
        ga4_connected: ga4Connected,
        total_ranking_keywords: 0,
        keyword_cannibalization: [],
        optimization_gaps: [],
        quick_wins: [],
        top_pages_by_organic_traffic: [],
      };
      result.keyword_signals = { ...baseKeywordSignals, ...this.computeKeywordSignals() };
    }

    // Duplicate content analysis
    result.duplicate_content = this.computeDuplicateContent();

    // Build the URL registry + page index, then resolve complete affected-URL
    // sets for each issue. Page-index issueTypes are derived INDEPENDENTLY from
    // page attributes (not from capped issue.urls) so capped lists for the
    // derivable types recover their full membership.
    const internalParser = this.parsedData.internal as Record<string, unknown> | undefined;
    const rawPerUrl = (internalParser?.per_url_index as PerUrlRecord[]) ?? [];
    const origin = deriveOrigin(rawPerUrl[0]?.url, result.metadata.site_name);
    const builder = new UrlRegistryBuilder(origin);
    const pageIndex: PageIndexEntry[] = rawPerUrl.map((p) => ({
      ref: builder.intern(p.url, 'page'),
      title: p.title, h1: p.h1, metaDescription: p.metaDescription,
      wordCount: p.wordCount, crawlDepth: p.crawlDepth, indexable: p.indexable,
      issueTypes: deriveIssueTypesForPage(p),
    }));
    for (const list of [result.issues.critical, result.issues.warnings, result.issues.notices]) {
      for (const issue of list) {
        const { refs, complete, source } = buildAffectedRefs(issue, pageIndex, builder);
        issue.affectedUrlRefs = refs;
        issue.affectedUrlRefsComplete = complete;
        issue.affectedUrlSource = source;
      }
    }
    result.page_index = pageIndex;
    result.url_registry = builder.build();

    result.structured_recommendations = buildStructuredRecommendations(result);

    // Post-parse completeness verdict (depends on page_index + issues above).
    result.completeness = computeCompleteness(result);

    return result;
  }

  private buildCrawlSummary(): CrawlSummary {
    const internal = this.parsedData.internal || {};

    const summary: CrawlSummary = {
      total_urls: (internal.total_urls as number) || 0,
    };

    // Indexability
    const indexability = internal.indexability as Record<string, number> | undefined;
    if (indexability) {
      summary.indexable_urls = indexability.indexable || 0;
      summary.non_indexable_urls = indexability.non_indexable || 0;
    }

    // Status codes
    const status = internal.status_codes as Record<string, number> | undefined;
    if (status) {
      summary.ok_responses = status.ok_2xx || 0;
      summary.redirects = status.redirect_3xx || 0;
      summary.client_errors = status.client_error_4xx || 0;
      summary.server_errors = status.server_error_5xx || 0;
    }

    // Content metrics
    const content = internal.content_metrics as Record<string, number> | undefined;
    if (content) {
      summary.avg_word_count = content.avg_word_count || 0;
    }

    // Crawl depth
    const depth = internal.crawl_depth as Record<string, number> | undefined;
    if (depth) {
      summary.avg_crawl_depth = depth.avg_depth || 0;
      summary.max_crawl_depth = depth.max_depth || 0;
    }

    // NEW — Link Score average (if column was present in the crawl)
    const linkScore = internal.link_score as Record<string, number> | undefined;
    if (linkScore) {
      summary.avg_link_score = linkScore.avg_link_score || 0;
    }

    // NEW — pages under 300 words (surfaced from content_metrics)
    if (content) {
      summary.pages_under_300_words = (content.thin_content_count as number) || 0;
    }

    return summary;
  }

  private buildIssues(): IssuesResult {
    const critical: Issue[] = [];
    const warnings: Issue[] = [];
    const notices: Issue[] = [];

    // First, check for Issues Overview parser data (ScreamingFrog pre-computed issues)
    const issuesOverview = this.parsedData.issuesoverview as Record<string, unknown> | undefined;
    if (issuesOverview?.issues) {
      const sfIssues = issuesOverview.issues as Issue[];
      for (const issue of sfIssues) {
        // Issues from ScreamingFrog's overview are already well-categorized
        if (issue.severity === 'critical') {
          critical.push(issue);
        } else if (issue.severity === 'warning') {
          warnings.push(issue);
        } else {
          notices.push(issue);
        }
      }
    }

    // Collect issues from all other parsers
    for (const [parserName, parserData] of Object.entries(this.parsedData)) {
      if (!parserData || typeof parserData !== 'object') continue;
      // Skip issuesoverview as we already processed it
      if (parserName === 'issuesoverview') continue;

      const issues = parserData.issues as Issue[] | undefined;
      if (issues) {
        for (const issue of issues) {
          const issueWithSource = { ...issue, source: parserName };
          if (issue.severity === 'critical') {
            critical.push(issueWithSource);
          } else if (issue.severity === 'warning') {
            warnings.push(issueWithSource);
          } else {
            notices.push(issueWithSource);
          }
        }
      }
    }

    // Extract issues from internal parser data
    const internal = this.parsedData.internal || {};

    // Broken pages
    const status = internal.status_codes as Record<string, unknown> | undefined;
    if (status) {
      const brokenCount = ((status.client_error_4xx as number) || 0) + ((status.server_error_5xx as number) || 0);
      if (brokenCount > 0) {
        critical.push({
          type: 'broken_pages',
          severity: 'critical',
          count: brokenCount,
          description: `${brokenCount} pages returning 4xx/5xx errors`,
          urls: status.broken_urls as string[],
          source: 'internal',
        });
      }
    }

    // SEO elements
    const seo = internal.seo_elements_summary as Record<string, unknown> | undefined;
    if (seo) {
      const missingTitles = (seo.missing_titles_count as number) || 0;
      if (missingTitles > 0) {
        critical.push({
          type: 'missing_title',
          severity: 'critical',
          count: missingTitles,
          description: `${missingTitles} pages missing title tags`,
          urls: seo.missing_titles_urls as string[],
          source: 'internal',
        });
      }

      const missingMeta = (seo.missing_meta_count as number) || 0;
      if (missingMeta > 0) {
        warnings.push({
          type: 'missing_meta_description',
          severity: 'warning',
          count: missingMeta,
          description: `${missingMeta} pages missing meta descriptions`,
          urls: seo.missing_meta_urls as string[],
          source: 'internal',
        });
      }

      const missingH1 = (seo.missing_h1_count as number) || 0;
      if (missingH1 > 0) {
        warnings.push({
          type: 'missing_h1',
          severity: 'warning',
          count: missingH1,
          description: `${missingH1} pages missing H1 headings`,
          urls: seo.missing_h1_urls as string[],
          source: 'internal',
        });
      }

      const dupTitles = (seo.duplicate_titles_count as number) || 0;
      if (dupTitles > 0) {
        warnings.push({
          type: 'duplicate_titles',
          severity: 'warning',
          count: dupTitles,
          description: `${dupTitles} duplicate title tag groups`,
          groups: seo.duplicate_title_groups as Issue['groups'],
          source: 'internal',
        });
      }
    }

    // Thin content
    const content = internal.content_metrics as Record<string, unknown> | undefined;
    if (content) {
      const thinCount = (content.thin_content_count as number) || 0;
      if (thinCount > 0) {
        warnings.push({
          type: 'thin_content',
          severity: 'warning',
          count: thinCount,
          description: `${thinCount} pages with less than 300 words`,
          urls: content.thin_content_urls as string[],
          source: 'internal',
        });
      }
    }

    // NEW — Accessibility: critical errors surfaced separately from generic issue pass
    const accessibilityData = this.parsedData.accessibility as Record<string, unknown> | undefined;
    if (accessibilityData) {
      const pagesWithErrors = (accessibilityData.pagesWithErrors as number) || 0;
      if (pagesWithErrors > 0) {
        critical.push({
          type: 'accessibility_errors',
          severity: 'critical',
          count: pagesWithErrors,
          description: `${pagesWithErrors} pages have critical WCAG accessibility errors`,
          source: 'accessibility',
        });
      }
    }

    // NEW — Alt text coverage warning (< 80%)
    const imagesData = this.parsedData.images as Record<string, unknown> | undefined;
    if (imagesData) {
      const stats = imagesData.stats as Record<string, number> | undefined;
      if (stats) {
        const altCoverage = stats.alt_coverage_percent;
        if (altCoverage !== undefined && altCoverage < 80) {
          const missingAlt = stats.missing_alt || 0;
          warnings.push({
            type: 'missing_alt_text',
            severity: 'warning',
            count: missingAlt,
            description: `Alt text coverage is ${altCoverage}% — ${missingAlt} images missing alt text`,
            source: 'images',
          });
        }

        // NEW — Missing image dimensions as a notice
        const missingDims = stats.missing_dimensions;
        if (missingDims !== undefined && missingDims > 0) {
          notices.push({
            type: 'images_missing_dimensions',
            severity: 'notice',
            count: missingDims,
            description: `${missingDims} images missing width/height attributes (layout shift risk)`,
            source: 'images',
          });
        }
      }
    }

    // NEW — Exact duplicate pages
    const exactDupData = this.parsedData.exactduplicates as Record<string, unknown> | undefined;
    if (exactDupData?.exact_duplicates) {
      const exactDups = exactDupData.exact_duplicates as unknown[];
      if (exactDups.length > 0) {
        warnings.push({
          type: 'exact_duplicate_pages',
          severity: 'warning',
          count: exactDups.length,
          description: `${exactDups.length} exact duplicate pages detected`,
          source: 'exactduplicates',
        });
      }
    }

    // NEW — Near duplicate pages
    const nearDupData = this.parsedData.nearduplicates as Record<string, unknown> | undefined;
    if (nearDupData?.near_duplicates) {
      const nearDups = nearDupData.near_duplicates as unknown[];
      if (nearDups.length > 0) {
        warnings.push({
          type: 'near_duplicate_pages',
          severity: 'warning',
          count: nearDups.length,
          description: `${nearDups.length} near-duplicate pages detected`,
          source: 'nearduplicates',
        });
      }
    }

    // NEW — Duplicate title tags (from PageTitlesParser)
    const titlesIssueData = this.parsedData.pagetitles as Record<string, unknown> | undefined;
    if (titlesIssueData?.issues) {
      const dupTitleIssue = (titlesIssueData.issues as Issue[]).find(i => i.type === 'duplicate_title');
      if (dupTitleIssue && dupTitleIssue.count > 0) {
        warnings.push({
          type: 'duplicate_title_tags',
          severity: 'warning',
          count: dupTitleIssue.count,
          description: `${dupTitleIssue.count} groups of pages share the same title tag`,
          groups: dupTitleIssue.groups,
          source: 'pagetitles',
        });
      }
    }

    // NEW — Duplicate meta descriptions (from MetaDescriptionParser)
    const metaIssueData = this.parsedData.metadescription as Record<string, unknown> | undefined;
    if (metaIssueData?.issues) {
      const dupMetaIssue = (metaIssueData.issues as Issue[]).find(i => i.type === 'duplicate_meta_description');
      if (dupMetaIssue && dupMetaIssue.count > 0) {
        notices.push({
          type: 'duplicate_meta_descriptions',
          severity: 'notice',
          count: dupMetaIssue.count,
          description: `${dupMetaIssue.count} groups of pages share the same meta description`,
          source: 'metadescription',
        });
      }
    }

    // NEW — Duplicate H1s (from H1Parser)
    const h1IssueData = this.parsedData.h1 as Record<string, unknown> | undefined;
    if (h1IssueData?.issues) {
      const dupH1Issue = (h1IssueData.issues as Issue[]).find(i => i.type === 'duplicate_h1');
      if (dupH1Issue && dupH1Issue.count > 0) {
        notices.push({
          type: 'duplicate_h1_tags',
          severity: 'notice',
          count: dupH1Issue.count,
          description: `${dupH1Issue.count} groups of pages share the same H1 heading`,
          groups: dupH1Issue.groups,
          source: 'h1',
        });
      }
    }

    // NEW — Keyword cannibalization (from SemrushOrganicPositionsParser)
    const semrushPositionsData = this.parsedData.semrushorganicpositions as Record<string, unknown> | undefined;
    if (semrushPositionsData?.keyword_cannibalization) {
      const cannibalizations = semrushPositionsData.keyword_cannibalization as unknown[];
      if (cannibalizations.length > 0) {
        warnings.push({
          type: 'keyword_cannibalization',
          severity: 'warning',
          count: cannibalizations.length,
          description: `${cannibalizations.length} keywords are competing across multiple pages`,
          source: 'semrushorganicpositions',
        });
      }
    }

    // Drop count-only sf_* passthrough issues that a richer, URL-bearing
    // curated issue already covers (prevents duplicate Teamwork tasks and an
    // inflated no-URL ratio). Runs after by-type dedupe so the present-set is final.
    return dropSupersededSfIssues({
      critical: dedupeIssues(critical),
      warnings: dedupeIssues(warnings),
      notices: dedupeIssues(notices),
    });
  }

  private buildSiteStructure() {
    const internal = this.parsedData.internal || {};
    const structure: Record<string, unknown> = {};

    const depth = internal.crawl_depth as Record<string, unknown> | undefined;
    if (depth?.distribution) {
      structure.crawl_depth_distribution = depth.distribution;
    }

    const indexability = internal.indexability as Record<string, unknown> | undefined;
    if (indexability?.non_indexable_reasons) {
      const reasons = indexability.non_indexable_reasons as unknown[];
      structure.non_indexable_reasons = reasons.slice(0, 10);
    }

    // Hreflang languages
    const hreflang = this.parsedData.hreflang as Record<string, unknown> | undefined;
    if (hreflang?.languages) {
      structure.hreflang_languages = hreflang.languages;
    }

    return structure;
  }

  private buildResourcesSummary() {
    const resources: Record<string, unknown> = {};

    // Images
    const images = this.parsedData.images as Record<string, unknown> | undefined;
    if (images) {
      resources.images = {
        total: images.total_images || 0,
        stats: images.stats || {},
      };
    }

    // JavaScript
    const js = this.parsedData.javascript as Record<string, unknown> | undefined;
    if (js) {
      resources.javascript = {
        total: js.total_js_files || 0,
        stats: js.stats || {},
      };
    }

    // CSS
    const css = this.parsedData.css as Record<string, unknown> | undefined;
    if (css) {
      resources.css = {
        total: css.total_css_files || 0,
        stats: css.stats || {},
      };
    }

    // PDFs
    const pdf = this.parsedData.pdf as Record<string, unknown> | undefined;
    if (pdf) {
      resources.pdfs = {
        total: pdf.total_pdfs || 0,
      };
    }

    // Links
    const links = this.parsedData.links as Record<string, unknown> | undefined;
    if (links) {
      resources.internal_links = {
        total: links.total_links || 0,
        stats: links.stats || {},
      };
    }

    // External links
    const externalLinks = this.parsedData.externallinks as Record<string, unknown> | undefined;
    if (externalLinks) {
      resources.external_links = {
        total: externalLinks.total_external_links || 0,
        stats: externalLinks.stats || {},
      };
    }

    // Sitemaps
    const sitemaps = this.parsedData.sitemaps as Record<string, unknown> | undefined;
    if (sitemaps) {
      resources.sitemaps = {
        urls_in_sitemap: sitemaps.total_sitemap_urls || 0,
        stats: sitemaps.stats || {},
      };
    }

    // Anchor Text Analysis
    const anchorText = this.parsedData.anchortext as Record<string, unknown> | undefined;
    if (anchorText) {
      resources.anchor_text = {
        total_hyperlinks: anchorText.total_hyperlinks || 0,
        unique_anchors: anchorText.unique_anchors || 0,
        top_anchors: anchorText.top_anchors || [],
        link_positions: anchorText.link_positions || {},
        stats: anchorText.stats || {},
      };
    }

    // NEW — Accessibility summary
    const accessibility = this.parsedData.accessibility as Record<string, unknown> | undefined;
    if (accessibility) {
      resources.accessibility = {
        total_pages: (accessibility.totalPages as number) || 0,
        pages_with_errors: (accessibility.pagesWithErrors as number) || 0,
        pages_with_alerts: (accessibility.pagesWithAlerts as number) || 0,
        error_rate: (accessibility.errorRate as number) || 0,
      };
    }

    return resources;
  }

  private buildTechnicalSummary() {
    const technical: Record<string, unknown> = {};

    // Directives
    const directives = this.parsedData.directives as Record<string, unknown> | undefined;
    if (directives?.stats) {
      technical.robots_directives = directives.stats;
    }

    // Canonicals — NEW: include self-referencing, non-self, and missing counts
    const canonicals = this.parsedData.canonicals as Record<string, unknown> | undefined;
    if (canonicals) {
      technical.canonicals = {
        total_pages: (canonicals.total_pages as number) || 0,
        self_referencing: (canonicals.self_referencing_count as number) || undefined, // NEW
        non_self_canonical: (canonicals.non_self_canonical_count as number) || undefined, // NEW
        missing_canonical: (canonicals.missing_canonical_count as number) || undefined, // NEW
      };
    }

    // Response codes distribution
    const responseCodes = this.parsedData.responsecodes as Record<string, unknown> | undefined;
    if (responseCodes?.distribution) {
      technical.response_code_distribution = responseCodes.distribution;
    }

    // Redirects
    const redirects = this.parsedData.redirects as Record<string, unknown> | undefined;
    if (redirects?.types) {
      technical.redirect_types = redirects.types;
    }

    // Hreflang
    const hreflang = this.parsedData.hreflang as Record<string, unknown> | undefined;
    if (hreflang) {
      technical.hreflang = {
        total_entries: hreflang.total_entries || 0,
        languages: hreflang.languages || {},
      };
    }

    // Structured data
    const structuredData = this.parsedData.structureddata as Record<string, unknown> | undefined;
    if (structuredData) {
      technical.structured_data = {
        pages_with_schema: structuredData.total_pages_with_schema || 0,
        pages_with_rich_results: structuredData.pages_with_rich_results || 0,
        schema_types: structuredData.schema_types || {},
      };
    }

    return technical;
  }

  private buildPerformanceSummary() {
    const performance: Record<string, unknown> = {};

    // GA4 Analytics traffic metrics
    const analytics = this.parsedData.analytics as Record<string, unknown> | undefined;
    if (analytics?.stats) {
      performance.ga4_traffic = analytics.stats;
    }

    // Google Search Console metrics
    const searchConsole = this.parsedData.searchconsole as Record<string, unknown> | undefined;
    if (searchConsole?.stats) {
      performance.search_console = searchConsole.stats;
    }

    // Page speed / Core Web Vitals
    const pagespeed = this.parsedData.pagespeed as Record<string, unknown> | undefined;
    if (pagespeed) {
      if (pagespeed.core_web_vitals) {
        performance.core_web_vitals = pagespeed.core_web_vitals;
      }
      if (pagespeed.stats) {
        performance.stats = pagespeed.stats;
      }
    }

    // Response time / TTFB
    const responseTime = this.parsedData.responsetime as Record<string, unknown> | undefined;
    if (responseTime?.stats) {
      performance.server_response = responseTime.stats;
    }

    // GSC and GA4 top pages extracted from internal_all.csv
    const internal = this.parsedData.internal || {};
    if (internal.gsc_top_pages) {
      performance.gsc_top_pages = internal.gsc_top_pages;
    }
    if (internal.ga4_top_pages) {
      performance.ga4_top_pages = internal.ga4_top_pages;
    }

    return performance;
  }

  private buildRecommendations(issues: IssuesResult): string[] {
    const recommendations: string[] = [];

    // Generate recommendations from critical and warning issues
    for (const severity of ['critical', 'warnings'] as const) {
      for (const issue of issues[severity]) {
        const template = ISSUE_RECOMMENDATIONS[issue.type];
        if (template && issue.count > 0) {
          const rec = template.replace('{count}', String(issue.count));
          if (!recommendations.includes(rec)) {
            recommendations.push(rec);
          }
        }
      }
    }

    // Add structure recommendation if needed
    const internal = this.parsedData.internal || {};
    const depth = internal.crawl_depth as Record<string, number> | undefined;
    if (depth && depth.max_depth > 4 && recommendations.length < 15) {
      recommendations.push(
        `Consider flattening site structure. Max crawl depth is ${depth.max_depth}; ideally important pages should be within 3 clicks of the homepage.`
      );
    }

    return recommendations.slice(0, 15);
  }

  private computeDuplicateContent(): DuplicateContent {
    // Exact duplicates from ExactDuplicatesParser
    const exactData = this.parsedData.exactduplicates as Record<string, unknown> | undefined;
    const exact_duplicates = (exactData?.exact_duplicates as DuplicateContent['exact_duplicates']) ?? [];
    const exact_duplicates_count = (exactData?.exact_duplicates_count as number | undefined) ?? exact_duplicates.length;

    // Near duplicates from NearDuplicatesParser
    const nearData = this.parsedData.nearduplicates as Record<string, unknown> | undefined;
    const near_duplicates = (nearData?.near_duplicates as DuplicateContent['near_duplicates']) ?? [];
    const near_duplicates_count = (nearData?.near_duplicates_count as number | undefined) ?? near_duplicates.length;

    // Duplicate titles — extract from PageTitlesParser issues
    const duplicate_titles: DuplicateContent['duplicate_titles'] = [];
    let duplicate_titles_count = 0;
    const titlesData = this.parsedData.pagetitles as Record<string, unknown> | undefined;
    if (titlesData?.issues) {
      const titleIssues = titlesData.issues as Issue[];
      const dupTitleIssue = titleIssues.find(i => i.type === 'duplicate_title');
      duplicate_titles_count = dupTitleIssue?.count ?? 0;
      if (dupTitleIssue?.groups) {
        for (const g of dupTitleIssue.groups) {
          if (g.title) {
            duplicate_titles.push({ title: g.title, affected_urls: g.urls ?? [], count: g.count });
          }
        }
      }
    }

    // Duplicate meta descriptions — extract from MetaDescriptionParser issues
    const duplicate_meta_descriptions: DuplicateContent['duplicate_meta_descriptions'] = [];
    let duplicate_meta_descriptions_count = 0;
    const metaData = this.parsedData.metadescription as Record<string, unknown> | undefined;
    if (metaData?.issues) {
      const metaIssues = metaData.issues as Issue[];
      const dupMetaIssue = metaIssues.find(i => i.type === 'duplicate_meta_description');
      duplicate_meta_descriptions_count = dupMetaIssue?.count ?? 0;
      if (dupMetaIssue?.groups) {
        for (const g of dupMetaIssue.groups) {
          if (g.meta_description) {
            duplicate_meta_descriptions.push({ meta_description: g.meta_description, affected_urls: g.urls ?? [], count: g.count });
          }
        }
      }
    }

    // Duplicate H1s — extract from H1Parser issues
    const duplicate_h1s: DuplicateContent['duplicate_h1s'] = [];
    let duplicate_h1s_count = 0;
    const h1Data = this.parsedData.h1 as Record<string, unknown> | undefined;
    if (h1Data?.issues) {
      const h1Issues = h1Data.issues as Issue[];
      const dupH1Issue = h1Issues.find(i => i.type === 'duplicate_h1');
      duplicate_h1s_count = dupH1Issue?.count ?? 0;
      if (dupH1Issue?.groups) {
        for (const g of dupH1Issue.groups) {
          if (g.h1) {
            duplicate_h1s.push({ h1: g.h1, affected_urls: g.urls ?? [], count: g.count });
          }
        }
      }
    }

    return {
      exact_duplicates,
      near_duplicates,
      duplicate_titles,
      duplicate_meta_descriptions,
      duplicate_h1s,
      exact_duplicates_count,
      near_duplicates_count,
      duplicate_titles_count,
      duplicate_meta_descriptions_count,
      duplicate_h1s_count,
    };
  }

  private computeKeywordSignals(): Partial<KeywordSignals> {
    const positionsData = this.parsedData.semrushorganicpositions as Record<string, unknown> | undefined;
    const pagesData = this.parsedData.semrushorganicpages as Record<string, unknown> | undefined;
    const gapData = this.parsedData.semrushkeywordgap as Record<string, unknown> | undefined;

    if (!positionsData && !pagesData && !gapData) return {};

    const total_ranking_keywords = (positionsData?.total_ranking_keywords as number) ?? 0;
    const keyword_cannibalization = (positionsData?.keyword_cannibalization as KeywordSignals['keyword_cannibalization']) ?? [];
    const quick_wins = (positionsData?.quick_wins as KeywordSignals['quick_wins']) ?? [];
    const top_pages_by_organic_traffic = (pagesData?.top_pages_by_organic_traffic as KeywordSignals['top_pages_by_organic_traffic']) ?? [];

    // Compute optimization gaps from per_url_keyword_data
    // per_url_keyword_data is Array<{ url: string; keywords: Array<{keyword, position, search_volume}> }>
    const perUrlData = (positionsData?.per_url_keyword_data as Array<{ url: string; keywords: Array<{ keyword: string; position: number; search_volume: number }> }>) ?? [];
    const optimization_gaps: KeywordSignals['optimization_gaps'] = [];

    // Build title/H1 lookup from internal per_url_index (populated by Task 4)
    const internal = this.parsedData.internal as Record<string, unknown> | undefined;
    const perUrlIndex = (internal?.per_url_index as Array<{ url: string; title: string | null; h1: string | null }>) ?? [];
    // Key on a canonical join key so Screaming Frog vs SEMRush URL formatting differences
    // (scheme, trailing slash, UTM params) don't leave title/H1 blank.
    const metaByUrl = new Map(perUrlIndex.map((p) => [urlJoinKey(p.url), { title: p.title ?? '', h1: p.h1 ?? '' }]));

    {
      // Collect URLs sorted by estimated traffic (total search_volume of top keywords)
      const urlEntries = perUrlData.map(({ url, keywords }) => {
        const estimatedTraffic = keywords.reduce((sum, k) => sum + k.search_volume, 0);
        return { url, keywords, estimatedTraffic };
      });

      urlEntries.sort((a, b) => b.estimatedTraffic - a.estimatedTraffic);

      for (const { url, keywords } of urlEntries.slice(0, 50)) {
        const meta = metaByUrl.get(urlJoinKey(url)) ?? { title: '', h1: '' };
        optimization_gaps.push({
          url,
          title: meta.title,
          h1: meta.h1,
          top_ranking_keywords: keywords,
        });
      }
    }

    return {
      semrush_connected: true,
      total_ranking_keywords,
      keyword_cannibalization,
      quick_wins,
      top_pages_by_organic_traffic,
      optimization_gaps,
      gap_keywords: (gapData?.gap_keywords as GapKeyword[]) ?? [],
    };
  }

}
