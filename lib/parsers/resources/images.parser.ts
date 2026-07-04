import { StreamingParser } from '../streaming-parser.base';
import { ParsedData, Issue, CSVRow } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

export class ImagesParser extends StreamingParser {
  static parserKey = 'images';
  static filenamePattern = ['images_all', 'images'];

  private static LARGE_IMAGE_SIZE = 100 * 1024;
  private static VERY_LARGE_IMAGE_SIZE = 500 * 1024;

  private addressCol: string | null = null;
  private altTextCol: string | null = null;
  private sizeCol: string | null = null;
  private statusCol: string | null = null;
  private widthCol: string | null = null;
  private heightCol: string | null = null;

  private missingAltUrls: string[] = [];
  private largeUrls: string[] = [];
  private veryLargeUrls: string[] = [];
  private brokenUrls: string[] = [];
  private missingDimsUrls: string[] = [];
  private missingAltCount = 0; private imagesWithAlt = 0;
  private largeCount = 0; private veryLargeCount = 0;
  private brokenCount = 0; private missingDimsCount = 0;

  protected onHeaders(): void {
    this.addressCol = this.findColumn(['Address', 'URL']);
    this.altTextCol = this.findColumn(['Alt Text', 'Alt']);
    this.sizeCol = this.findColumn(['Size (Bytes)', 'Size', 'File Size']);
    this.statusCol = this.findColumn(['Status Code', 'Status']);
    this.widthCol = this.findColumn(['Width', 'img width', 'Image Width']);
    this.heightCol = this.findColumn(['Height', 'img height', 'Image Height']);
  }

  protected consumeRow(row: CSVRow): void {
    const addr = this.addressCol ? toString(row[this.addressCol]) : '';
    if (this.altTextCol) {
      const alt = toString(row[this.altTextCol]);
      if (!alt) { this.missingAltCount++; if (this.addressCol && this.missingAltUrls.length < 30) this.missingAltUrls.push(addr); }
      else this.imagesWithAlt++;
    }
    if (this.sizeCol) {
      const size = toNumber(row[this.sizeCol]);
      if (size !== null) {
        if (size > ImagesParser.VERY_LARGE_IMAGE_SIZE) { this.veryLargeCount++; if (this.addressCol && this.veryLargeUrls.length < 20) this.veryLargeUrls.push(addr); }
        else if (size > ImagesParser.LARGE_IMAGE_SIZE) { this.largeCount++; if (this.addressCol && this.largeUrls.length < 30) this.largeUrls.push(addr); }
      }
    }
    if (this.statusCol) {
      const status = toNumber(row[this.statusCol]);
      if (status !== null && status >= 400 && status < 600) { this.brokenCount++; if (this.addressCol && this.brokenUrls.length < 30) this.brokenUrls.push(addr); }
    }
    if (this.widthCol || this.heightCol) {
      const width = this.widthCol ? toString(row[this.widthCol]) : null;
      const height = this.heightCol ? toString(row[this.heightCol]) : null;
      const missingWidth = this.widthCol && (!width || width === '0');
      const missingHeight = this.heightCol && (!height || height === '0');
      if (missingWidth || missingHeight) { this.missingDimsCount++; if (this.addressCol && this.missingDimsUrls.length < 30) this.missingDimsUrls.push(addr); }
    }
  }

  finalize(): ParsedData {
    if (this.isEmpty) return {};
    const issues: Issue[] = [];
    const totalImages = this.length;
    const stats: Record<string, number> = {};

    if (this.altTextCol) {
      const altCoveragePercent = totalImages > 0 ? Math.round((this.imagesWithAlt / totalImages) * 1000) / 10 : 100;
      stats.missing_alt = this.missingAltCount;
      stats.alt_coverage_percent = altCoveragePercent;
      stats.images_with_alt = this.imagesWithAlt;
      if (this.missingAltCount > 0) issues.push({
        type: 'missing_alt_text', severity: altCoveragePercent < 80 ? 'warning' : 'notice', count: this.missingAltCount,
        description: `${this.missingAltCount} images missing alt text (${altCoveragePercent}% coverage)`, urls: this.missingAltUrls,
      });
    }
    if (this.sizeCol) {
      stats.large_images = this.largeCount;
      stats.very_large_images = this.veryLargeCount;
      if (this.veryLargeCount > 0) issues.push({ type: 'very_large_images', severity: 'critical', count: this.veryLargeCount, description: `${this.veryLargeCount} very large images (> 500KB)`, urls: this.veryLargeUrls });
      if (this.largeCount > 0) issues.push({ type: 'large_images', severity: 'warning', count: this.largeCount, description: `${this.largeCount} large images (> 100KB)`, urls: this.largeUrls });
    }
    if (this.statusCol) {
      stats.broken_images = this.brokenCount;
      if (this.brokenCount > 0) issues.push({ type: 'broken_images', severity: 'critical', count: this.brokenCount, description: `${this.brokenCount} broken images (4xx/5xx)`, urls: this.brokenUrls });
    }
    if (this.widthCol || this.heightCol) {
      stats.missing_dimensions = this.missingDimsCount;
      if (this.missingDimsCount > 0) issues.push({ type: 'images_missing_dimensions', severity: 'notice', count: this.missingDimsCount, description: `${this.missingDimsCount} images missing width/height attributes (layout shift risk)`, urls: this.missingDimsUrls });
    }
    return { total_images: totalImages, stats, issues };
  }
}
