import { BaseParser } from './base.parser';
import {
  InternalParserResult,
  StatusCodeData,
  IndexabilityData,
  ContentMetrics,
  SEOElementsSummary,
  CrawlDepthData,
  LinkScoreData, // NEW
  NearDuplicateData, // NEW
  FolderDepthData, // NEW
  GscPageStat,
  Ga4PageStat,
  Issue
} from '../types';
import { toNumber, toString } from '../utils/columnMapper';

/**
 * Parser for the main internal crawl data (internal_all.csv).
 * This is the most critical parser as it contains comprehensive crawl data.
 */
export class InternalParser extends BaseParser {
  static filenamePattern = 'internal_all';

  // Column name mappings for different Screaming Frog versions
  private static COLUMN_MAPPINGS: Record<string, string[]> = {
    address: ['Address', 'URL'],
    status_code: ['Status Code', 'Status'],
    status: ['Status'],
    indexability: ['Indexability'],
    indexability_status: ['Indexability Status'],
    title: ['Title 1', 'Title'],
    title_length: ['Title 1 Length', 'Title Length'],
    meta_description: ['Meta Description 1', 'Meta Description'],
    meta_description_length: ['Meta Description 1 Length', 'Meta Description Length'],
    h1: ['H1-1', 'H1'],
    h2: ['H2-1', 'H2'],
    word_count: ['Word Count', 'Words'],
    link_score: ['Link Score'], // NEW
    folder_depth: ['Folder Depth'], // NEW
    near_duplicate: ['Near Duplicate', 'Near Duplicate Details'], // NEW
    crawl_depth: ['Crawl Depth'],
    inlinks: ['Inlinks'],
    outlinks: ['Outlinks'],
    content_type: ['Content Type'],
    canonical: ['Canonical Link Element 1', 'Canonical'],
  };

  private getColumn(key: string): string | null {
    const possibleNames = InternalParser.COLUMN_MAPPINGS[key] || [key];
    return this.findColumn(possibleNames);
  }

  parse(): InternalParserResult {
    if (this.isEmpty) {
      return this.getEmptyResult();
    }

    const addressCol = this.getColumn('address');
    const urls = addressCol
      ? this.data.map(row => toString(row[addressCol])).filter(Boolean)
      : [];

    const result: InternalParserResult = {
      total_urls: this.length,
      urls,
      status_codes: this.parseStatusCodes(),
      indexability: this.parseIndexability(),
      content_metrics: this.parseContentMetrics(),
      seo_elements_summary: this.parseSeoElements(),
      crawl_depth: this.parseCrawlDepth(),
    };

    // NEW — optionally attach link score, folder depth, near duplicates when columns exist
    const linkScoreData = this.parseLinkScore();
    if (linkScoreData !== null) result.link_score = linkScoreData;

    const folderDepthData = this.parseFolderDepth();
    if (folderDepthData !== null) result.folder_depth = folderDepthData;

    const nearDuplicateData = this.parseNearDuplicates();
    if (nearDuplicateData !== null) result.near_duplicates = nearDuplicateData;

    // GSC and GA4 column extraction
    const gscConnected = this.findColumn(['Impressions']) !== null && this.findColumn(['Position']) !== null;
    const ga4Connected = this.findColumn(['GA4 Sessions']) !== null;

    result.gsc_connected = gscConnected;
    result.ga4_connected = ga4Connected;

    if (gscConnected) {
      const gscPages = this.parseGscPages();
      if (gscPages.length > 0) result.gsc_top_pages = gscPages;
    }

    if (ga4Connected) {
      const ga4Pages = this.parseGa4Pages();
      if (ga4Pages.length > 0) result.ga4_top_pages = ga4Pages;
    }

    return result;
  }

  private getEmptyResult(): InternalParserResult {
    return {
      total_urls: 0,
      urls: [],
      status_codes: {
        distribution: {},
        ok_2xx: 0,
        redirect_3xx: 0,
        client_error_4xx: 0,
        server_error_5xx: 0,
        broken_urls: [],
      },
      indexability: {
        indexable: 0,
        non_indexable: 0,
        non_indexable_reasons: [],
      },
      content_metrics: {
        avg_word_count: 0,
        min_word_count: 0,
        max_word_count: 0,
        thin_content_count: 0,
        thin_content_urls: [],
      },
      seo_elements_summary: {
        html_pages_count: 0,
        indexable_html_count: 0,
      },
      crawl_depth: {
        distribution: {},
        avg_depth: 0,
        max_depth: 0,
      },
    };
  }

  private parseStatusCodes(): StatusCodeData {
    const statusCol = this.getColumn('status_code');
    const addressCol = this.getColumn('address');

    if (!statusCol) {
      return {
        distribution: {},
        ok_2xx: 0,
        redirect_3xx: 0,
        client_error_4xx: 0,
        server_error_5xx: 0,
        broken_urls: [],
      };
    }

    const distribution: Record<string, number> = {};
    let ok_2xx = 0;
    let redirect_3xx = 0;
    let client_error_4xx = 0;
    let server_error_5xx = 0;
    const brokenUrls: string[] = [];

    for (const row of this.data) {
      const code = toNumber(row[statusCol]);
      if (code === null) continue;

      const codeStr = String(code);
      distribution[codeStr] = (distribution[codeStr] || 0) + 1;

      if (code >= 200 && code < 300) {
        ok_2xx++;
      } else if (code >= 300 && code < 400) {
        redirect_3xx++;
      } else if (code >= 400 && code < 500) {
        client_error_4xx++;
        if (addressCol && brokenUrls.length < 50) {
          brokenUrls.push(toString(row[addressCol]));
        }
      } else if (code >= 500 && code < 600) {
        server_error_5xx++;
        if (addressCol && brokenUrls.length < 50) {
          brokenUrls.push(toString(row[addressCol]));
        }
      }
    }

    return {
      distribution,
      ok_2xx,
      redirect_3xx,
      client_error_4xx,
      server_error_5xx,
      broken_urls: brokenUrls,
    };
  }

  private parseIndexability(): IndexabilityData {
    const indexabilityCol = this.getColumn('indexability');
    const addressCol = this.getColumn('address');
    const statusCol = this.getColumn('indexability_status');

    if (!indexabilityCol) {
      return {
        indexable: 0,
        non_indexable: 0,
        non_indexable_reasons: [],
      };
    }

    let indexable = 0;
    let non_indexable = 0;
    const non_indexable_reasons: Array<Record<string, string>> = [];

    for (const row of this.data) {
      const value = toString(row[indexabilityCol]).toLowerCase();
      if (value === 'indexable') {
        indexable++;
      } else if (value === 'non-indexable') {
        non_indexable++;
        if (non_indexable_reasons.length < 50 && addressCol && statusCol) {
          non_indexable_reasons.push({
            Address: toString(row[addressCol]),
            [statusCol]: toString(row[statusCol]),
          });
        }
      }
    }

    return {
      indexable,
      non_indexable,
      non_indexable_reasons,
    };
  }

  private parseContentMetrics(): ContentMetrics {
    const wordCountCol = this.getColumn('word_count');
    const addressCol = this.getColumn('address');

    if (!wordCountCol) {
      return {
        avg_word_count: 0,
        min_word_count: 0,
        max_word_count: 0,
        thin_content_count: 0,
        thin_content_urls: [],
      };
    }

    const indexableMask = this.getIndexableHtmlMask();
    const wordCounts: number[] = [];
    const thinContentUrls: string[] = [];

    for (let i = 0; i < this.data.length; i++) {
      if (!indexableMask[i]) continue;

      const count = toNumber(this.data[i][wordCountCol]);
      if (count !== null && count >= 0) {
        wordCounts.push(count);

        if (count < 300 && count > 0 && thinContentUrls.length < 50 && addressCol) {
          thinContentUrls.push(toString(this.data[i][addressCol]));
        }
      }
    }

    if (wordCounts.length === 0) {
      return {
        avg_word_count: 0,
        min_word_count: 0,
        max_word_count: 0,
        thin_content_count: 0,
        thin_content_urls: [],
      };
    }

    const sum = wordCounts.reduce((a, b) => a + b, 0);
    const avg = sum / wordCounts.length;
    const min = Math.min(...wordCounts);
    const max = Math.max(...wordCounts);

    return {
      avg_word_count: Math.round(avg * 10) / 10,
      min_word_count: min,
      max_word_count: max,
      thin_content_count: thinContentUrls.length,
      thin_content_urls: thinContentUrls,
      pages_under_300_words: thinContentUrls.length, // NEW
    };
  }

  private parseSeoElements(): SEOElementsSummary {
    const addressCol = this.getColumn('address');
    const titleCol = this.getColumn('title');
    const metaCol = this.getColumn('meta_description');
    const h1Col = this.getColumn('h1');

    const htmlMask = this.getHtmlMask();
    const indexableMask = this.getIndexableHtmlMask();

    const result: SEOElementsSummary = {
      html_pages_count: this.countMask(htmlMask),
      indexable_html_count: this.countMask(indexableMask),
    };

    // Single-pass over indexable rows for title, meta, and H1 analysis
    const missingTitleUrls: string[] = [];
    let missingTitleCount = 0;
    const titleCounts: Record<string, number> = {};

    const missingMetaUrls: string[] = [];
    let missingMetaCount = 0;
    const metaCounts: Record<string, number> = {};

    const missingH1Urls: string[] = [];
    let missingH1Count = 0;

    for (let i = 0; i < this.data.length; i++) {
      if (!indexableMask[i]) continue;
      const addr = addressCol ? toString(this.data[i][addressCol]) : '';

      if (titleCol) {
        const title = toString(this.data[i][titleCol]);
        if (!title) {
          missingTitleCount++;
          if (addr && missingTitleUrls.length < 20) missingTitleUrls.push(addr);
        } else {
          titleCounts[title] = (titleCounts[title] || 0) + 1;
        }
      }

      if (metaCol) {
        const meta = toString(this.data[i][metaCol]);
        if (!meta) {
          missingMetaCount++;
          if (addr && missingMetaUrls.length < 20) missingMetaUrls.push(addr);
        } else {
          metaCounts[meta] = (metaCounts[meta] || 0) + 1;
        }
      }

      if (h1Col) {
        const h1 = toString(this.data[i][h1Col]);
        if (!h1) {
          missingH1Count++;
          if (addr && missingH1Urls.length < 20) missingH1Urls.push(addr);
        }
      }
    }

    if (titleCol) {
      result.missing_titles_count = missingTitleCount;
      result.missing_titles_urls = missingTitleUrls;
      result.missing_titles_truncated = missingTitleCount > 20;

      const duplicates = Object.entries(titleCounts)
        .filter(([_, count]) => count > 1)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
      result.duplicate_titles_count = duplicates.length;
      result.duplicate_title_groups = duplicates.map(([title, count]) => ({
        title: title.slice(0, 100),
        count,
      }));
    }

    if (metaCol) {
      result.missing_meta_count = missingMetaCount;
      result.missing_meta_urls = missingMetaUrls;
      result.missing_meta_truncated = missingMetaCount > 20;
      result.duplicate_meta_count = Object.values(metaCounts).filter(c => c > 1).length;
    }

    if (h1Col) {
      result.missing_h1_count = missingH1Count;
      result.missing_h1_urls = missingH1Urls;
      result.missing_h1_truncated = missingH1Count > 20;
    }

    return result;
  }

  private parseCrawlDepth(): CrawlDepthData {
    const depthCol = this.getColumn('crawl_depth');

    if (!depthCol) {
      return {
        distribution: {},
        avg_depth: 0,
        max_depth: 0,
      };
    }

    const depths: number[] = [];
    const distribution: Record<number, number> = {};

    for (const row of this.data) {
      const depth = toNumber(row[depthCol]);
      if (depth !== null && depth >= 0) {
        depths.push(depth);
        distribution[depth] = (distribution[depth] || 0) + 1;
      }
    }

    if (depths.length === 0) {
      return {
        distribution: {},
        avg_depth: 0,
        max_depth: 0,
      };
    }

    const sum = depths.reduce((a, b) => a + b, 0);
    const avg = sum / depths.length;
    const max = Math.max(...depths);

    return {
      distribution,
      avg_depth: Math.round(avg * 100) / 100,
      max_depth: max,
    };
  }

  // NEW — Parse Link Score column (Screaming Frog's internal PageRank-like metric 0–100)
  private parseLinkScore(): LinkScoreData | null {
    const col = this.getColumn('link_score');
    if (!col) return null;

    const scores: number[] = [];
    const distribution: Record<string, number> = {};
    const buckets = ['0-10', '11-25', '26-50', '51-75', '76-100'];

    for (const row of this.data) {
      const score = toNumber(row[col]);
      if (score === null || score < 0) continue;
      scores.push(score);

      let bucket: string;
      if (score <= 10) bucket = '0-10';
      else if (score <= 25) bucket = '11-25';
      else if (score <= 50) bucket = '26-50';
      else if (score <= 75) bucket = '51-75';
      else bucket = '76-100';
      distribution[bucket] = (distribution[bucket] || 0) + 1;
    }

    if (scores.length === 0) return null;

    const sum = scores.reduce((a, b) => a + b, 0);
    return {
      avg_link_score: Math.round((sum / scores.length) * 10) / 10,
      min_link_score: Math.min(...scores),
      max_link_score: Math.max(...scores),
      distribution,
    };
  }

  // NEW — Parse Folder Depth column
  private parseFolderDepth(): FolderDepthData | null {
    const col = this.getColumn('folder_depth');
    if (!col) return null;

    const depths: number[] = [];
    const distribution: Record<number, number> = {};

    for (const row of this.data) {
      const depth = toNumber(row[col]);
      if (depth === null || depth < 0) continue;
      depths.push(depth);
      distribution[depth] = (distribution[depth] || 0) + 1;
    }

    if (depths.length === 0) return null;

    const sum = depths.reduce((a, b) => a + b, 0);
    return {
      distribution,
      avg_folder_depth: Math.round((sum / depths.length) * 100) / 100,
      max_folder_depth: Math.max(...depths),
    };
  }

  // NEW — Parse Near Duplicate column
  private parseNearDuplicates(): NearDuplicateData | null {
    const col = this.getColumn('near_duplicate');
    const addressCol = this.getColumn('address');
    if (!col) return null;

    const nearDuplicateUrls: string[] = [];

    for (let i = 0; i < this.data.length; i++) {
      const value = toString(this.data[i][col]);
      // SF populates this cell with a URL or non-empty string when the page is a near-duplicate
      if (value && value.toLowerCase() !== 'false' && value !== '0') {
        if (addressCol && nearDuplicateUrls.length < 50) {
          nearDuplicateUrls.push(toString(this.data[i][addressCol]));
        }
      }
    }

    return {
      total_near_duplicates: nearDuplicateUrls.length,
      near_duplicate_urls: nearDuplicateUrls,
      truncated: nearDuplicateUrls.length >= 50,
    };
  }

  /**
   * Parse a numeric value that may optionally have a `%` suffix (e.g. "3.5%" → 3.5, "120.5" → 120.5).
   * Handles plain floats (Position, duration) and percent-suffixed strings (CTR, bounce rate).
   * Returns NaN on failure.
   */
  private parseNumeric(raw: string | number | null | undefined): number {
    if (raw === null || raw === undefined) return NaN;
    if (typeof raw === 'number') {
      // SF sometimes stores CTR/engagement as a decimal fraction (0–1)
      // but our column values from PapaParse dynamicTyping may be numeric.
      // If the value looks like a fraction (0–1) and no % suffix, keep as-is scaled to pct.
      // However, the real SF CSV always has "%" suffix for these fields, so after
      // dynamicTyping a string like "3.5%" would be a string. If it's already a number
      // it was a plain decimal — just return as-is (no scaling needed for position/duration).
      return raw;
    }
    const str = String(raw).trim();
    if (str.endsWith('%')) {
      return parseFloat(str.slice(0, -1));
    }
    return parseFloat(str);
  }

  // GSC — extract per-URL data, skip 0-impression rows, sort desc by impressions, cap at 50
  private parseGscPages(): GscPageStat[] {
    const addressCol = this.findColumn(['Address', 'URL']);
    const clicksCol = this.findColumn(['Clicks']);
    const impressionsCol = this.findColumn(['Impressions']);
    const ctrCol = this.findColumn(['CTR']);
    const positionCol = this.findColumn(['Position']);

    if (!addressCol || !clicksCol || !impressionsCol) return [];

    const pages: GscPageStat[] = [];

    for (const row of this.data) {
      const url = toString(row[addressCol]);
      if (!url) continue;

      const impressions = toNumber(row[impressionsCol]) ?? 0;
      if (impressions === 0) continue;

      const clicks = toNumber(row[clicksCol]) ?? 0;
      const ctr_pct = ctrCol ? this.parseNumeric(row[ctrCol] as string | number | null) : 0;
      const average_position = positionCol ? this.parseNumeric(row[positionCol] as string | number | null) : 0;

      pages.push({
        url,
        clicks: Math.round(clicks),
        impressions: Math.round(impressions),
        ctr_pct: isNaN(ctr_pct) ? 0 : ctr_pct,
        average_position: isNaN(average_position) ? 0 : average_position,
      });
    }

    pages.sort((a, b) => b.impressions - a.impressions);
    return pages.slice(0, 50);
  }

  // GA4 — extract per-URL data, skip 0-session rows, sort desc by sessions, cap at 50
  private parseGa4Pages(): Ga4PageStat[] {
    const addressCol = this.findColumn(['Address', 'URL']);
    const sessionsCol = this.findColumn(['GA4 Sessions']);
    const viewsCol = this.findColumn(['GA4 Views']);
    const engagedCol = this.findColumn(['GA4 Engaged sessions']);
    const bounceCol = this.findColumn(['GA4 Bounce rate']);
    const durationCol = this.findColumn(['GA4 Average session duration']);

    if (!addressCol || !sessionsCol) return [];

    const pages: Ga4PageStat[] = [];

    for (const row of this.data) {
      const url = toString(row[addressCol]);
      if (!url) continue;

      const sessions = toNumber(row[sessionsCol]) ?? 0;
      if (sessions === 0) continue;

      const views = viewsCol ? (toNumber(row[viewsCol]) ?? 0) : 0;
      const engaged_sessions = engagedCol ? (toNumber(row[engagedCol]) ?? 0) : 0;
      const bounce_rate_pct = bounceCol ? this.parseNumeric(row[bounceCol] as string | number | null) : 0;
      // TODO: GA4 Engagement rate column exists but is not extracted (not in Ga4PageStat interface)
      const average_session_duration_seconds = durationCol ? this.parseNumeric(row[durationCol] as string | number | null) : 0;

      pages.push({
        url,
        sessions: Math.round(sessions),
        views: Math.round(views),
        engaged_sessions: Math.round(engaged_sessions),
        bounce_rate_pct: isNaN(bounce_rate_pct) ? 0 : bounce_rate_pct,
        average_session_duration_seconds: isNaN(average_session_duration_seconds) ? 0 : average_session_duration_seconds,
      });
    }

    pages.sort((a, b) => b.sessions - a.sessions);
    return pages.slice(0, 50);
  }

  /**
   * Per-URL extraction for pillar analysis. Returns one entry per HTML row
   * with title/H1/meta/word-count/depth/inlinks/outlinks/indexable plus an
   * optional first-paragraph custom column. `schemaTypes` is always [] here;
   * structured-data parsing happens via a separate parser and is joined later.
   *
   * Does NOT modify or call the existing `parse()` method.
   */
  parsePerUrlForPillar(): Array<{
    url: string;
    title: string | null;
    h1: string | null;
    metaDescription: string | null;
    firstParagraph: string | null;
    wordCount: number | null;
    crawlDepth: number | null;
    inlinks: number | null;
    outlinks: number | null;
    indexable: boolean;
    schemaTypes: string[];
  }> {
    if (this.isEmpty) return [];

    const addressCol = this.getColumn('address');
    const titleCol = this.getColumn('title');
    const h1Col = this.getColumn('h1');
    const metaCol = this.getColumn('meta_description');
    const wordCountCol = this.getColumn('word_count');
    const crawlDepthCol = this.getColumn('crawl_depth');
    const inlinksCol = this.getColumn('inlinks');
    const outlinksCol = this.getColumn('outlinks');
    const indexabilityCol = this.getColumn('indexability');
    const firstParagraphCol = this.findColumn([
      'First Paragraph',
      'first_paragraph',
      'Intro Text',
    ]);

    const htmlMask = this.getHtmlMask();

    const cleanString = (raw: unknown): string | null => {
      const s = toString(raw).trim();
      return s.length > 0 ? s : null;
    };

    const result: Array<{
      url: string;
      title: string | null;
      h1: string | null;
      metaDescription: string | null;
      firstParagraph: string | null;
      wordCount: number | null;
      crawlDepth: number | null;
      inlinks: number | null;
      outlinks: number | null;
      indexable: boolean;
      schemaTypes: string[];
    }> = [];

    for (let i = 0; i < this.data.length; i++) {
      if (!htmlMask[i]) continue;

      const row = this.data[i];

      const url = addressCol ? toString(row[addressCol]).trim() : '';
      if (!url) continue;

      const indexableValue = indexabilityCol
        ? toString(row[indexabilityCol]).trim().toLowerCase()
        : '';
      const indexable = indexableValue === 'indexable';

      result.push({
        url,
        title: titleCol ? cleanString(row[titleCol]) : null,
        h1: h1Col ? cleanString(row[h1Col]) : null,
        metaDescription: metaCol ? cleanString(row[metaCol]) : null,
        firstParagraph: firstParagraphCol ? cleanString(row[firstParagraphCol]) : null,
        wordCount: wordCountCol ? toNumber(row[wordCountCol]) : null,
        crawlDepth: crawlDepthCol ? toNumber(row[crawlDepthCol]) : null,
        inlinks: inlinksCol ? toNumber(row[inlinksCol]) : null,
        outlinks: outlinksCol ? toNumber(row[outlinksCol]) : null,
        indexable,
        schemaTypes: [],
      });
    }

    return result;
  }
}
