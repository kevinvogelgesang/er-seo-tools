import { CSVRow, ParsedData } from '../types';
import { buildHeaderMap, findColumnInMap, mostCommonHostname, filenameMatches } from './header-map';

/**
 * Streaming sibling of BaseParser. Rows arrive one at a time via consume(); the
 * subclass folds each into instance accumulators (consumeRow) and emits output
 * once at the end (finalize). Never retains the full row array — bounds peak
 * memory for the big-file parsers. Column names are resolved once, before the
 * first row folds, in onHeaders() (several parsers need a column to decide
 * whether to count a row).
 *
 * parserKey MUST be an explicit literal on each subclass (prod minifies class
 * names). The base declares '' and is never registered.
 */
export abstract class StreamingParser {
  static filenamePattern: string | string[] = '';
  static parserKey = '';
  static streaming = true;

  static matchesFile(filename: string): boolean {
    return filenameMatches(this.filenamePattern, filename);
  }
  static matchesContent(_headers: string[]): boolean { return false; }
  static matchesRawContent(_rawContent: string): boolean { return false; }

  protected headers: string[] = [];
  private headerMap = new Map<string, string>();
  private headersResolved = false;
  private rowCount = 0;
  private domainCounts = new Map<string, number>();

  /** Route stream driver calls this once per data row. */
  consume(row: CSVRow): void {
    if (!this.headersResolved) {
      this.headers = Object.keys(row);
      this.headerMap = buildHeaderMap(this.headers);
      this.headersResolved = true;
      this.onHeaders();
    }
    this.rowCount++;
    this.trackDomain(row);
    this.consumeRow(row);
  }

  /** Resolve + cache column names into fields. Runs once, before any consumeRow. */
  protected onHeaders(): void {}

  protected abstract consumeRow(row: CSVRow): void;
  abstract finalize(): ParsedData;

  protected get length(): number { return this.rowCount; }
  protected get isEmpty(): boolean { return this.rowCount === 0; }

  protected findColumn(possibleNames: string[]): string | null {
    return findColumnInMap(this.headerMap, possibleNames);
  }

  getPrimaryDomain(): string | null {
    return mostCommonHostname(this.domainCounts);
  }

  private trackDomain(row: CSVRow): void {
    const addressCol = this.findColumn(['Address', 'URL']);
    if (!addressCol) return;
    const val = row[addressCol];
    if (typeof val === 'string' && val.startsWith('http')) {
      try {
        const { hostname } = new URL(val);
        if (hostname) this.domainCounts.set(hostname, (this.domainCounts.get(hostname) ?? 0) + 1);
      } catch { /* skip non-URL */ }
    }
  }
}
