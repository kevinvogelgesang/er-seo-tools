import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

export class ImagesParser extends BaseParser {
  static parserKey = 'images';
  static filenamePattern = ['images_all', 'images'];

  private static LARGE_IMAGE_SIZE = 100 * 1024; // 100KB
  private static VERY_LARGE_IMAGE_SIZE = 500 * 1024; // 500KB

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const addressCol = this.findColumn(['Address', 'URL']);
    const altTextCol = this.findColumn(['Alt Text', 'Alt']);
    const sizeCol = this.findColumn(['Size (Bytes)', 'Size', 'File Size']);
    const statusCol = this.findColumn(['Status Code', 'Status']);
    const widthCol = this.findColumn(['Width', 'img width', 'Image Width']);
    const heightCol = this.findColumn(['Height', 'img height', 'Image Height']);

    const issues: Issue[] = [];
    const totalImages = this.length;
    const stats: Record<string, number> = {};

    const missingAltUrls: string[] = [];
    const largeUrls: string[] = [];
    const veryLargeUrls: string[] = [];
    const brokenUrls: string[] = [];
    const missingDimsUrls: string[] = [];

    let missingAltCount = 0, imagesWithAlt = 0;
    let largeCount = 0, veryLargeCount = 0;
    let brokenCount = 0;
    let missingDimsCount = 0;

    for (let i = 0; i < this.data.length; i++) {
      const row = this.data[i];
      const addr = addressCol ? toString(row[addressCol]) : '';

      if (altTextCol) {
        const alt = toString(row[altTextCol]);
        if (!alt) {
          missingAltCount++;
          if (addressCol && missingAltUrls.length < 30) missingAltUrls.push(addr);
        } else {
          imagesWithAlt++;
        }
      }

      if (sizeCol) {
        const size = toNumber(row[sizeCol]);
        if (size !== null) {
          if (size > ImagesParser.VERY_LARGE_IMAGE_SIZE) {
            veryLargeCount++;
            if (addressCol && veryLargeUrls.length < 20) veryLargeUrls.push(addr);
          } else if (size > ImagesParser.LARGE_IMAGE_SIZE) {
            largeCount++;
            if (addressCol && largeUrls.length < 30) largeUrls.push(addr);
          }
        }
      }

      if (statusCol) {
        const status = toNumber(row[statusCol]);
        if (status !== null && status >= 400 && status < 600) {
          brokenCount++;
          if (addressCol && brokenUrls.length < 30) brokenUrls.push(addr);
        }
      }

      if (widthCol || heightCol) {
        const width = widthCol ? toString(row[widthCol]) : null;
        const height = heightCol ? toString(row[heightCol]) : null;
        const missingWidth = widthCol && (!width || width === '0');
        const missingHeight = heightCol && (!height || height === '0');
        if (missingWidth || missingHeight) {
          missingDimsCount++;
          if (addressCol && missingDimsUrls.length < 30) missingDimsUrls.push(addr);
        }
      }
    }

    if (altTextCol) {
      const altCoveragePercent = totalImages > 0
        ? Math.round((imagesWithAlt / totalImages) * 1000) / 10
        : 100;
      stats.missing_alt = missingAltCount;
      stats.alt_coverage_percent = altCoveragePercent;
      stats.images_with_alt = imagesWithAlt;

      if (missingAltCount > 0) {
        issues.push({
          type: 'missing_alt_text',
          severity: altCoveragePercent < 80 ? 'warning' : 'notice',
          count: missingAltCount,
          description: `${missingAltCount} images missing alt text (${altCoveragePercent}% coverage)`,
          urls: missingAltUrls,
        });
      }
    }

    if (sizeCol) {
      stats.large_images = largeCount;
      stats.very_large_images = veryLargeCount;

      if (veryLargeCount > 0) {
        issues.push({
          type: 'very_large_images',
          severity: 'critical',
          count: veryLargeCount,
          description: `${veryLargeCount} very large images (> 500KB)`,
          urls: veryLargeUrls,
        });
      }
      if (largeCount > 0) {
        issues.push({
          type: 'large_images',
          severity: 'warning',
          count: largeCount,
          description: `${largeCount} large images (> 100KB)`,
          urls: largeUrls,
        });
      }
    }

    if (statusCol) {
      stats.broken_images = brokenCount;
      if (brokenCount > 0) {
        issues.push({
          type: 'broken_images',
          severity: 'critical',
          count: brokenCount,
          description: `${brokenCount} broken images (4xx/5xx)`,
          urls: brokenUrls,
        });
      }
    }

    if (widthCol || heightCol) {
      stats.missing_dimensions = missingDimsCount;
      if (missingDimsCount > 0) {
        issues.push({
          type: 'images_missing_dimensions',
          severity: 'notice',
          count: missingDimsCount,
          description: `${missingDimsCount} images missing width/height attributes (layout shift risk)`,
          urls: missingDimsUrls,
        });
      }
    }

    return {
      total_images: totalImages,
      stats,
      issues,
    };
  }
}
