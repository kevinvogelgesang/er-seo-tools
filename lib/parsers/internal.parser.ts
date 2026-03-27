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
}
