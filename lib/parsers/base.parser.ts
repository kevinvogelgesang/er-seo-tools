import Papa from 'papaparse';
import { CSVData, CSVRow, ParsedData } from '../types';
import { findColumnName, isHtmlContentType, isIndexable, toString } from '../utils/columnMapper';
import { isSeoRelevantUrl } from '../utils/urlFilter';
import { buildHeaderMap, findColumnInMap, mostCommonHostname, filenameMatches } from './header-map';

export abstract class BaseParser {
  protected data: CSVData = [];
  protected headers: string[] = [];
  private headerMap: Map<string, string> = new Map();

  // Subclasses should define this to match their target file
  static filenamePattern: string | string[] = '';

  // Stable key under which this parser's output is stored on the aggregator's
  // parsedData. MUST be an explicit string literal on each subclass — the parse
  // route used to derive it from the class name, which the production build
  // minifies, breaking the aggregator's hardcoded parsedData.<key> lookups.
  static parserKey: string = '';

  constructor(csvContent: string) {
    this.parseCSV(csvContent);
    // Build a case-insensitive lookup map once per parser instantiation (O(n) → O(1) per findColumn call)
    this.headerMap = buildHeaderMap(this.headers);
  }

  private parseCSV(content: string): void {
    const result = Papa.parse<CSVRow>(content, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
    });
    this.data = result.data;
    this.headers = result.meta.fields || [];
  }

  /**
   * Parse the loaded data and return structured results.
   * Must be implemented by subclasses.
   */
  abstract parse(): ParsedData;

  /**
   * Check if a filename matches this parser's pattern
   */
  static matchesFile(filename: string): boolean {
    return filenameMatches(this.filenamePattern, filename);
  }

  /**
   * Check if this parser handles a file by inspecting its header row.
   * Override in parsers that are detected by content rather than filename
   * (e.g. SEMRush exports with dynamic date-stamped filenames).
   * Base implementation always returns false.
   */
  static matchesContent(_headers: string[]): boolean {
    return false;
  }

  /**
   * Check if this parser handles a file by inspecting its raw content (before CSV parsing).
   * Override in parsers that need to detect metadata headers or non-standard formats.
   * Base implementation always returns false.
   */
  static matchesRawContent(_rawContent: string): boolean {
    return false;
  }

  /**
   * Get a column by checking multiple possible names (case-insensitive, O(1) via headerMap)
   */
  protected findColumn(possibleNames: string[]): string | null {
    return findColumnInMap(this.headerMap, possibleNames);
  }

  /**
   * Get values from a specific column across all rows
   */
  protected getColumnValues(columnName: string | null): (string | number | null)[] {
    if (!columnName) return this.data.map(() => null);
    return this.data.map(row => row[columnName] ?? null);
  }

  /**
   * Get a boolean mask for SEO-relevant URLs
   */
  protected getSeoRelevantMask(addressCol: string | null): boolean[] {
    if (!addressCol) {
      return this.data.map(() => true);
    }
    return this.data.map(row => isSeoRelevantUrl(toString(row[addressCol])));
  }

  /**
   * Get a boolean mask for HTML pages
   */
  protected getHtmlMask(): boolean[] {
    const contentTypeCol = this.findColumn(['Content Type', 'content type', 'Content']);
    if (!contentTypeCol) {
      return this.data.map(() => true);
    }
    return this.data.map(row => isHtmlContentType(toString(row[contentTypeCol])));
  }

  /**
   * Get a boolean mask for indexable pages
   */
  protected getIndexableMask(): boolean[] {
    const indexabilityCol = this.findColumn(['Indexability', 'indexability', 'Indexable']);
    if (!indexabilityCol) {
      return this.data.map(() => true);
    }
    return this.data.map(row => isIndexable(toString(row[indexabilityCol])));
  }

  /**
   * Get a boolean mask for indexable HTML pages
   */
  protected getIndexableHtmlMask(): boolean[] {
    const htmlMask = this.getHtmlMask();
    const indexableMask = this.getIndexableMask();
    const urlMask = this.getSeoRelevantMask(this.findColumn(['Address', 'URL']));

    return this.data.map((_, i) => htmlMask[i] && indexableMask[i] && urlMask[i]);
  }

  /**
   * Filter data by a boolean mask
   */
  protected filterByMask(mask: boolean[]): CSVData {
    return this.data.filter((_, i) => mask[i]);
  }

  /**
   * Count true values in a mask
   */
  protected countMask(mask: boolean[]): number {
    return mask.filter(Boolean).length;
  }

  /**
   * Get URLs where mask is true
   */
  protected getUrlsWhereMask(mask: boolean[], limit: number = Number.MAX_SAFE_INTEGER): string[] {
    const addressCol = this.findColumn(['Address', 'URL']);
    if (!addressCol) return [];

    const urls: string[] = [];
    for (let i = 0; i < this.data.length && urls.length < limit; i++) {
      if (mask[i]) {
        const url = toString(this.data[i][addressCol]);
        if (url) urls.push(url);
      }
    }
    return urls;
  }

  /**
   * Scan the Address/URL column across all rows and return the most common hostname.
   * Used by the parse route to reliably identify which site was crawled.
   */
  public getPrimaryDomain(): string | null {
    const addressCol = this.findColumn(['Address', 'URL']);
    if (!addressCol) return null;

    const counts = new Map<string, number>();
    for (const row of this.data) {
      const val = row[addressCol];
      if (typeof val === 'string' && val.startsWith('http')) {
        try {
          const { hostname } = new URL(val);
          if (hostname) counts.set(hostname, (counts.get(hostname) ?? 0) + 1);
        } catch {
          // skip non-URL values
        }
      }
    }

    return mostCommonHostname(counts);
  }

  /**
   * Get data length
   */
  protected get length(): number {
    return this.data.length;
  }

  /**
   * Check if data is empty
   */
  protected get isEmpty(): boolean {
    return this.data.length === 0;
  }
}
